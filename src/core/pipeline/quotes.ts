import type { InboundMessage } from '../../types/adapter/adapter.ts'
import type { BotLike } from '../../types/adapter/bot.ts'
import type { MessageQuote } from '../../types/core/session.ts'
import type { TargetType } from '../../types/core/target.ts'
import { h, toText } from '../message/element/element.ts'
import { openQuoteIndex } from '../store/quote-index.ts'

export interface MessageDeletion {
  type: TargetType
  channelId: string
  messageId: string
}
function roomKey(bot: BotLike, channel: Pick<InboundMessage, 'type' | 'channelId'>) {
  return JSON.stringify([bot.platform, bot.id, bot.selfId, channel.type, channel.channelId])
}

export function createQuoteHistory(file: () => string) {
  let index: ReturnType<typeof openQuoteIndex> | undefined
  let closed = false
  const db = () => (index ??= openQuoteIndex(file()))
  async function resolve(
    bot: BotLike,
    message: InboundMessage,
    room: string,
    id: string,
  ): Promise<MessageQuote> {
    const channelId = message.channelId
    const cached = db().get(room, channelId, id)
    if (cached) return cached
    const ref = { id, channelId }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        bot.getMessage(channelId, id),
        new Promise<undefined>((done) => {
          timer = setTimeout(() => done(undefined), 1500)
        }),
      ])
      if (
        closed ||
        roomKey(bot, message) !== room ||
        !result ||
        result.id !== id ||
        result.channelId !== channelId ||
        (result.channelType && result.channelType !== message.type)
      )
        return ref
      const updated = db().get(room, channelId, id)
      if (updated) return updated
      return {
        ...ref,
        userId: result.userId,
        content: result.content.slice(0, 8192),
        createdAt: result.createdAt,
      }
    } catch {
      return ref
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async receive(bot: BotLike, message: InboundMessage) {
      if (closed) return
      const room = roomKey(bot, message)
      const [quote] = h.select(message.elements || [], 'quote')
      const id = String(quote?.attrs.id || '')
      if (message.messageId && !closed)
        db().record(
          room,
          message.messageId,
          message.userId,
          message.content ?? toText(message.elements || []),
          message.timestamp ?? Date.now(),
        )
      if (id && id !== message.messageId) return resolve(bot, message, room, id)
    },
    recall(bot: BotLike, message: MessageDeletion) {
      if (
        !closed &&
        message?.messageId &&
        message.channelId &&
        ['private', 'group', 'channel'].includes(message.type)
      )
        db().recall(roomKey(bot, message), message.messageId, Date.now())
    },
    close() {
      closed = true
      index?.close()
    },
  }
}
