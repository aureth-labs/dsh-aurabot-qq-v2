import { createOutbox } from '../../modules/chat-bridge/qq/delivery/outbox.ts'
import { groupOf, isGroupRoom, isPrivateRoom, roomKey } from '../../../src/core/bot/room.ts'
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
      const hub = getHub()
      if (!hub) return
      const r = await hub.flushOutbox(
        (item) =>
          !item.incomingReply ||
          !isGroupRoom(item.chatId) ||
          groupResponseMode(getConfig(), groupOf(item.chatId)) === 'chat',
        (item, result) => {
          if (item.proactive) {
            try {
              hub.noteProactive(item.chatId, item.message || [], {
                proactiveCause: item.proactive,
              })
            } catch (error) {
              logger.child('outbox').warn('补发后补记主动发言失败：', error.message)
            }
          }
          if (!isPrivateRoom(item.chatId) || (item.deliveryScope as any)?.botQQ !== onebot.login.uin || (result as any)?.queued) return
          const sent = Array.isArray(result) ? result[0] : (result as any)?.message_id ?? (result as any)?.id
          personaMemoryRuntime.confirmDelivery(item.chatId, sent, item.deliveryScope)
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
    const live = session instanceof Session && registry.get(session.bot.id, session.bot.platform) === session.bot
    const hub = getHub()
    if (live && hub) {
      if (session.sentLog?.length) {
        const chatId = roomKey(session.target)
        for (const item of session.sentLog.splice(0)) {
          try {
            hub.noteSaid?.(chatId, item.text)
          } catch (error) {
            log.warn('出站回写失败：', String((error as Error)?.message ?? error))
          }
        }
      }
      return { result: hub.onMessage(session, Boolean(session.quote?.deletedAt)) }
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
      if (event === 'onebot' && primary(bot)) {
        const ev = payload as { post_type?: string; notice_type?: string; tag?: string; message?: string }
        if (ev?.post_type === 'notice' && ev.notice_type === 'bot_offline')
          log.warn(`QQ 账号离线${ev.tag ? '（' + String(ev.tag).slice(0, 100) + '）' : ''}${ev.message ? '：' + String(ev.message).slice(0, 300) : ''}`)
      }
      if (event === 'chat-notice') {
        const notice = payload as { type: 'private' | 'group'; channelId: string; userId: string; action: string }
        if ((notice.action === 'poke' || notice.action === 'file') && !directory.authority({ platform: bot.platform, botId: bot.id },
          { userId: String(notice.userId), type: notice.type, channelId: String(notice.channelId) })) return false
        getHub()?.onNotice(bot, notice)?.catch?.((error) => log.debug('处理通知出错：', error.message))
      }
      if (event === 'message-deleted') {
        const row = payload as { type: 'private' | 'group'; channelId: string; messageId: string }
        getHub()?.recallQuote(roomKey({ platform: bot.platform, botId: bot.id, type: row.type, id: row.channelId }), row.messageId)
      }
    },
  }
}
