import { recalledMessage } from './inbound.ts'

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
