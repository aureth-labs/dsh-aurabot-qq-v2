import type { InboundMessage } from '../../../../../src/types/adapter/adapter.ts'
import type { Session } from '../../../../../src/core/pipeline/session.ts'
import { h, toText } from '../../../../../src/core/message/element/element.ts'
import { fromOneBot, toOneBot } from './element.ts'

interface MessageEvent {
  message_type: 'group' | 'private'
  user_id: string | number
  group_id?: string | number
  message: unknown
  message_id?: string | number
  time?: number
  sender?: { card?: string; nickname?: string }
}

export function isMessageEvent(event: unknown): event is MessageEvent {
  if (!event || typeof event !== 'object') return false
  const value = event as Record<string, unknown>
  return value.post_type === 'message' && value.user_id != null && (
    value.message_type === 'private' || (value.message_type === 'group' && value.group_id != null)
  )
}

export function inboundOf(event: MessageEvent): InboundMessage {
  const userId = String(event.user_id)
  const groupId = event.message_type === 'group' ? String(event.group_id) : undefined
  return {
    type: event.message_type,
    userId,
    channelId: groupId ?? userId,
    guildId: groupId,
    userName: event.sender?.card || event.sender?.nickname || userId,
    messageId: event.message_id == null ? undefined : String(event.message_id),
    timestamp: event.time ? event.time * 1000 : undefined,
    elements: fromOneBot(event.message),
    raw: event,
  }
}

/** 旧聊天中枢仍消费原生事件。execute 只沿用身份和来源，重建消息段。 */
export function eventForHub(session: Session): unknown {
  if (!session.parent) {
    if (!session.reparsed || !session.raw || typeof session.raw !== 'object') return session.raw
    const elements = session.elements.map(el => {
      const heard = el.type === 'voice' && el.children?.find(child => child.type === 'translateVoice')
      return heard ? h.text('[语音] ' + toText(heard)) : el
    })
    return { ...session.raw, raw_message: session.content, message: toOneBot(elements) }
  }
  const source = session.parent.raw
  if (!source || typeof source !== 'object') return
  return {
    ...source,
    message_id: undefined,
    time: Math.floor(session.timestamp / 1000),
    raw_message: session.content,
    message: toOneBot(session.elements),
  }
}

export function recalledMessage(event: unknown) {
  if (!event || typeof event !== 'object') return
  const e = event as Record<string, unknown>
  if (e.post_type !== 'notice' || e.message_id == null) return
  const type = e.notice_type === 'group_recall' ? 'group' : e.notice_type === 'friend_recall' ? 'private' : undefined
  if (!type) return
  const channel = type === 'group' ? e.group_id : e.user_id
  if (channel != null) return { type, channelId: String(channel), messageId: String(e.message_id) }
}
