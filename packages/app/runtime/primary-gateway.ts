import { createOutbox } from '../../adapters/qq/onebot-v11/src/outbox.ts'
import { eventForHub } from '../../adapters/qq/onebot-v11/src/index.ts'
import { Session } from '../../../src/core/pipeline/session.ts'
import { groupResponseMode } from '../../../src/chat/policy/rules/access.ts'
import { toText } from '../../../src/core/message/element/element.ts'
import type { InboundMessage } from '../../../src/types/adapter/adapter.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import { defaultOneBotId } from '../onebot.ts'
import { tcpOpen } from '../support.ts'

const primary = (bot: BotLike) => bot.platform === 'qq' && bot.id === defaultOneBotId
export function createPrimaryGateway({
  ctx,
  onebot, directory,
  logger,
  getConfig,
  getHub,
  claimReply,
  emit,
  endpoint,
  personaMemoryRuntime,
}) {
  const log = logger.child('onebot')
  function claimPrimaryMessage(ev, message: InboundMessage) {
    emit('onebot', ev)
    if (message.type !== 'private') return false
    const text = message.content ?? toText(message.elements)
    const chat = 'private:' + message.userId
    return claimReply(chat, message.userId, text)
  }

  function handleNotice(ev) {
    emit('onebot', ev)
    if (ev.post_type === 'notice' && ev.notice_type === 'bot_offline') {
      log.warn(
        `QQ 账号离线${ev.tag ? '（' + String(ev.tag).slice(0, 100) + '）' : ''}${ev.message ? '：' + String(ev.message).slice(0, 300) : ''}`,
      )
    } else if (ev.post_type === 'notice' && ev.notice_type === 'notify' && ev.sub_type === 'poke') {
      getHub()
        .onPoke(ev)
        .catch((error) => log.error('处理戳一戳出错：', error.message))
    } else if (ev.post_type === 'notice' && ev.notice_type === 'group_upload') {
      getHub()
        .onGroupFile(ev)
        .catch((error) => log.error('处理群文件出错：', error.message))
    } else if (ev.post_type === 'notice') {
      getHub()
        .onNotice(ev)
        .catch((error) => log.debug('处理通知出错：', error.message))
    }
  }
  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  const outbox = createOutbox({ log: logger.child('outbox') })
  // 网关预热：从第一次 connecting 到 connected 之间的时间，用于面板显示「已等 N 秒」而不是干等
  let gatewayWarmSince = 0
  let gatewayLastLogAt = 0
  // 预热阶段：QQ 没开 / 正在登录 / 已登录未接入 / 已接入等 OneBot / OneBot 已监听
  let warmupPhase = { phase: '', label: '' }
  let warmupProbing = false
  function connectionChanged(id: string, s: string, d?: string) {
    if (id !== defaultOneBotId) return
    if (s === 'connected' || s === 'stopped' || s === 'unconfigured') {
      gatewayWarmSince = 0
      warmupPhase = { phase: '', label: '' }
    } else if (!gatewayWarmSince && getConfig().enabled) gatewayWarmSince = Date.now()
    // 预热阶段 connecting/disconnected 会每 3 秒来回刷：首次和每 20 秒记一条 info，其余进 debug
    const line = `QQ 网关：${s}${d ? '（' + d + '）' : ''}`
    const now = Date.now()
    if (s === 'connected' || s === 'stopped' || s === 'unconfigured' || now - gatewayLastLogAt > 20_000) {
      logger.child('onebot').info(line)
      gatewayLastLogAt = now
    } else {
      logger.child('onebot').debug(line)
    }
    emit('onebot/state', s)
  }
  let flushingOutbox = false
  async function flushOutbox() {
    if (flushingOutbox || onebot.state !== 'connected' || !onebot.verified) return
    flushingOutbox = true
    try {
      const r = await outbox.flush(
        (action, params, opts) => onebot.call(action, params, { ...opts, retries: 0 }),
        (item) =>
          !item.incomingReply ||
          item.action !== 'send_group_msg' ||
          groupResponseMode(getConfig(), item.params?.group_id) === 'chat',
        (item, result) => {
          // #327：主动发言入队时带了来路，补发成功后要补回聊天流水与「别处说过」，否则断线恢复后她不记得发过什么。
          if (item.proactive) {
            try {
              getHub().noteProactive(item.chatId, item.params?.message || [], {
                proactiveCause: item.proactive,
              })
            } catch (error) {
              logger.child('outbox').warn('补发后补记主动发言失败：', error.message)
            }
          }
          if (
            item.action !== 'send_private_msg' ||
            item.chatId !== `private:${item.params?.user_id}` ||
            (item.deliveryScope as any)?.botQQ !== onebot.login.uin ||
            (result as any)?.queued
          )
            return
          personaMemoryRuntime.confirmDelivery(item.chatId, (result as any)?.message_id, item.deliveryScope)
        },
      )
      if (r.sent || r.dropped || r.left)
        log.info(`补发队列：成功 ${r.sent}，丢弃 ${r.dropped}，剩余 ${r.left}`)
    } catch (error) {
      logger.child('onebot').warn('补发队列出错：', error.message)
    } finally {
      flushingOutbox = false
    }
  }
  // 连接后漏掉的、或补发中途又断网的，定时再试；没连接时直接返回。
  ctx.effect(
    () =>
      ctx.interval(() => {
        flushOutbox().catch(() => {})
      }, 10_000),
    'aurabot: 补发队列',
  )

  /** 预热阶段变化时记一条 info（同一阶段不重复刷）。 */
  function setWarmupPhase(phase, label) {
    if (warmupPhase.phase === phase) return
    warmupPhase = { phase, label }
    if (gatewayWarmSince) logger.child('onebot').info(`网关预热：${label}`)
  }
  /** 每 2 秒看一次 OneBot 端口有没有起来；只在预热期跑，连上/关掉/超过 5 分钟就停。 */
  async function probeWarmup() {
    if (warmupProbing || !gatewayWarmSince || onebot.state === 'connected') return
    if (!getConfig().enabled) return
    if (Date.now() - gatewayWarmSince > 300_000) return
    warmupProbing = true
    try {
      const ep = endpoint()
      let wsPort = 0
      try {
        wsPort = Number(new URL(ep.wsUrl).port) || 0
      } catch (error) {}
      if (wsPort && (await tcpOpen(wsPort)))
        return setWarmupPhase('onebot-ready', `OneBot 已经在 ${wsPort} 端口监听，正在握手`)
      return setWarmupPhase('onebot-wait', '正在等 OneBot 协议端监听')
    } catch (error) {
      setWarmupPhase('unknown', '正在等网关（' + error.message + '）')
    } finally {
      warmupProbing = false
    }
  }
  ctx.effect(
    () =>
      ctx.interval(() => {
        probeWarmup().catch(() => {})
      }, 2000),
    'aurabot: 网关预热探测',
  )

  function respond(session, registry) {
    const event =
      session instanceof Session &&
      session.bot.platform === 'qq' &&
      session.bot.id === defaultOneBotId &&
      registry.get(defaultOneBotId, 'qq') === session.bot
        ? eventForHub(session)
        : undefined
    const hub = getHub()
    if (event && hub) {
      if (session.sentLog?.length) {
        const chatId = session.type === 'private' ? `private:${session.userId}` : `group:${session.channelId}`
        for (const item of session.sentLog.splice(0)) {
          try {
            hub.noteSaid?.(chatId, item.text)
          } catch (error) {
            log.warn('出站回写失败：', String((error as Error)?.message ?? error))
          }
        }
      }
      return { result: hub.onMessage(event, Boolean(session.quote?.deletedAt)) }
    }
  }
  return {
    outbox,
    connectionChanged,
    flushOutbox,
    respond,
    warmSince: () => gatewayWarmSince,
    warmPhase: () => warmupPhase,
    beforeMessage: (bot: BotLike, message: InboundMessage) =>
      primary(bot) && claimPrimaryMessage(message.raw, message),
    beforeEvent: (event: string, payload: unknown, bot: BotLike) => {
      if (!primary(bot)) return
      if (event === 'onebot') {
        const notice = payload as { group_id?: number; sender_id?: number; user_id?: number; notice_type?: string }
        if (notice?.notice_type === 'group_upload' || notice?.notice_type === 'notify') {
          const userId = String(notice.group_id ? notice.user_id ?? '' : notice.sender_id ?? notice.user_id ?? '')
          const type = notice.group_id ? 'group' : 'private'
          if (userId && !directory.authority({ platform: bot.platform, botId: bot.id },
            { userId, type, channelId: String(notice.group_id || userId) })) return false
        }
        handleNotice(payload)
      }
      if (event === 'message-deleted') {
        const row = payload as { type: string; channelId: string; messageId: string }
        getHub()?.recallQuote(row.type, row.channelId, row.messageId)
      }
    },
  }
}
