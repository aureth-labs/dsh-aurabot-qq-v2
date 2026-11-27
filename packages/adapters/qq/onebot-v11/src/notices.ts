import { recalledMessage } from './inbound.ts'

export interface ChatNotice {
  type: 'private' | 'group'
  channelId: string
  userId: string
  action: string
  operatorId?: string
  targetId?: string
  messageId?: string
  value?: string
  amount?: number
  faces?: string[]
  file?: { name: string; size: number; id: string; busid: number }
}

const str = (value: unknown) => value == null ? undefined : String(value)

export function chatNotice(payload: unknown): ChatNotice | undefined {
  if (!payload || typeof payload !== 'object') return
  const ev = payload as Record<string, any>
  if (ev.post_type !== 'notice') return
  const groupId = str(ev.group_id)
  const userId = str(ev.user_id) ?? ''
  const base = groupId ? { type: 'group' as const, channelId: groupId, userId } : { type: 'private' as const, channelId: userId, userId }
  const operatorId = str(ev.operator_id)
  const sub = ev.sub_type
  switch (ev.notice_type) {
    case 'group_recall': return { ...base, action: 'recall', operatorId, messageId: str(ev.message_id) }
    case 'friend_recall': return { ...base, action: 'recall', messageId: str(ev.message_id) }
    case 'group_ban': return { ...base, action: sub === 'lift_ban' ? 'unmute' : 'mute', operatorId, amount: Number(ev.duration) || 0 }
    case 'group_increase': return { ...base, action: 'join' }
    case 'group_decrease': return { ...base, action: sub === 'leave' ? 'leave' : 'kick', operatorId }
    case 'group_admin': return { ...base, action: sub === 'set' ? 'admin-set' : 'admin-unset' }
    case 'essence': return { ...base, userId: str(ev.sender_id) ?? userId, action: sub === 'add' ? 'essence-add' : 'essence-remove', operatorId }
    case 'group_card': return { ...base, action: 'rename', value: String(ev.card_new || '') }
    case 'group_msg_emoji_like': {
      const added = typeof ev.is_add === 'boolean' ? ev.is_add : sub === 'add'
      if (!added) return
      return { ...base, action: 'reaction', messageId: str(ev.message_id), faces: (Array.isArray(ev.likes) ? ev.likes : []).map(x => String(x?.emoji_id ?? '')).filter(Boolean) }
    }
    case 'friend_add': return { ...base, action: 'friend' }
    case 'group_upload': return ev.file?.name ? { ...base, action: 'file', file: { name: String(ev.file.name), size: Number(ev.file.size) || 0, id: String(ev.file.id ?? ''), busid: Number(ev.file.busid) || 0 } } : undefined
    case 'notify':
      if (sub === 'poke') {
        const poker = groupId ? userId : str(ev.sender_id) ?? userId
        return { ...base, userId: poker, channelId: groupId || poker, action: 'poke', targetId: str(ev.target_id), value: ev.action ? String(ev.action) + String(ev.suffix || '') : '' }
      }
      if (sub === 'title') return { ...base, action: 'title', value: String(ev.title || '') }
      if (sub === 'group_name') return { ...base, action: 'group-name', value: String(ev.name_new || '') }
      return
  }
}

export function oneBotNotice(payload: unknown, sn: number) {
  if (!payload || typeof payload !== 'object') return
  const event = payload as Record<string, unknown>
  const id = (key: string) => event[key] == null ? undefined : String(event[key])
  const userId = id('user_id')
  const groupId = id('group_id')
  const user = userId ? { id: userId } : undefined
  const guild = groupId ? { id: groupId } : undefined
  const common = {
    sn, timestamp: Number(event.time) * 1000 || Date.now(), user, guild,
    operator: event.operator_id == null ? undefined : { id: id('operator_id') },
  }
  const recall = recalledMessage(event)
  if (recall) return {
    ...common, type: 'message-deleted', channel: { id: recall.channelId, type: recall.type === 'private' ? 1 : 0 },
    message: { id: recall.messageId },
  }
  if (event.post_type === 'request' && event.flag != null) {
    const message = { id: String(event.flag), content: String(event.comment ?? '') }
    if (event.request_type === 'friend' && user) return { ...common, type: 'friend-request', message }
    if (event.request_type === 'group' && guild && user) return {
      ...common, type: event.sub_type === 'invite' ? 'guild-request' : 'guild-member-request', member: { user }, message,
    }
  }
  if (event.post_type !== 'notice' || !guild || !user) return
  const self = user.id === id('self_id')
  switch (event.notice_type) {
    case 'group_increase': return { ...common, type: self ? 'guild-added' : 'guild-member-added', member: { user } }
    case 'group_decrease': return { ...common, type: self ? 'guild-removed' : 'guild-member-removed', member: { user } }
    case 'group_card': return { ...common, type: 'guild-member-updated', member: { user, nick: String(event.card_new ?? '') } }
  }
}
