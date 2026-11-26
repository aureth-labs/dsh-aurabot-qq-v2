import type { InboundMessage } from '../../../../../src/types/adapter/adapter.ts'
import type { Session } from '../../../../../src/core/pipeline/session.ts'
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
  if (!session.parent) return session.raw
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
