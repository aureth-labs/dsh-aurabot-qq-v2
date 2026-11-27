import { createOutbox } from '../../modules/chat-bridge/qq/delivery/outbox.ts'
import { groupOf, isGroupRoom, isPrivateRoom, roomKey } from '../../../src/core/bot/room.ts'
import { Session } from '../../../src/core/pipeline/session.ts'
import { groupResponseMode } from '../../../src/chat/policy/rules/access.ts'
import { toText } from '../../../src/core/message/element/element.ts'
import type { InboundMessage } from '../../../src/types/adapter/adapter.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'

export function createChatGateway({ ctx, directory, logger, getConfig, getHub, primaryBot, claimReply, personaMemoryRuntime }) {
  const log = logger.child('chat')
  const outbox = createOutbox({ log: logger.child('outbox') })

  function claimPrivateReply(message: InboundMessage) {
    if (message.type !== 'private') return false
    const text = message.content ?? toText(message.elements)
    return claimReply('private:' + message.userId, message.userId, text)
  }

  let flushing = false
  async function flushOutbox() {
    const bot: BotLike | undefined = primaryBot()
    const hub = getHub()
    if (flushing || !hub || bot?.status !== 'online') return
    flushing = true
    try {
      const r = await hub.flushOutbox(
        item => !item.incomingReply || !isGroupRoom(item.chatId) || groupResponseMode(getConfig(), groupOf(item.chatId)) === 'chat',
        (item, result) => {
          if (item.proactive) {
            try { hub.noteProactive(item.chatId, item.message || [], { proactiveCause: item.proactive }) }
            catch (error) { logger.child('outbox').warn('补发后补记主动发言失败：', error.message) }
          }
          if (!isPrivateRoom(item.chatId) || item.deliveryScope?.botQQ !== bot.selfId || result?.queued) return
          const sent = Array.isArray(result) ? result[0] : result?.message_id ?? result?.id
          personaMemoryRuntime.confirmDelivery(item.chatId, sent, item.deliveryScope)
        },
      )
      if (r.sent || r.dropped || r.left) log.info(`补发队列：成功 ${r.sent}，丢弃 ${r.dropped}，剩余 ${r.left}`)
    } catch (error) {
      log.warn('补发队列出错：', error.message)
    } finally {
      flushing = false
    }
  }
  ctx.effect(() => ctx.interval(() => { flushOutbox().catch(() => {}) }, 10_000), 'aurabot: 补发队列')

  function respond(session, registry) {
    const live = session instanceof Session && registry.get(session.bot.id, session.bot.platform) === session.bot
    const hub = getHub()
    if (!live || !hub) return
    if (session.sentLog?.length) {
      const chatId = roomKey(session.target)
      for (const item of session.sentLog.splice(0)) {
        try { hub.noteSaid?.(chatId, item.text) }
        catch (error) { log.warn('出站回写失败：', String((error as Error)?.message ?? error)) }
      }
    }
    return { result: hub.onMessage(session, Boolean(session.quote?.deletedAt)) }
  }

  return {
    outbox,
    flushOutbox,
    respond,
    beforeMessage: (bot: BotLike, message: InboundMessage) => bot === primaryBot() && claimPrivateReply(message),
    beforeEvent: (event: string, payload: unknown, bot: BotLike) => {
      if (event === 'chat-notice') {
        const notice = payload as { type: 'private' | 'group'; channelId: string; userId: string; action: string }
        if ((notice.action === 'poke' || notice.action === 'file') && !directory.authority({ platform: bot.platform, botId: bot.id },
          { userId: String(notice.userId), type: notice.type, channelId: String(notice.channelId) })) return false
        getHub()?.onNotice(bot, notice)?.catch?.(error => log.debug('处理通知出错：', error.message))
      }
      if (event === 'message-deleted') {
        const row = payload as { type: 'private' | 'group'; channelId: string; messageId: string }
        getHub()?.recallQuote(roomKey({ platform: bot.platform, botId: bot.id, type: row.type, id: row.channelId }), row.messageId)
      }
    },
  }
}
