import type { BotLike } from '../../types/adapter/bot.ts'

const resourceEvents = new Set([
  'guild-added', 'guild-updated', 'guild-removed', 'guild-request', 'friend-request',
  'guild-member-added', 'guild-member-updated', 'guild-member-removed', 'guild-member-request',
  'guild-role-created', 'guild-role-updated', 'guild-role-deleted', 'message-deleted', 'message-updated',
  'reaction-added', 'reaction-removed',
])
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const id = (resource: unknown) => {
  const value = record(resource).id
  return value == null ? undefined : String(value)
}

export function platformNotice(event: string, payload: unknown, bot: BotLike) {
  if (!resourceEvents.has(event)) return
  const source = record(payload)
  const data = event === 'message-deleted' && source.messageId != null && source.channelId != null
    ? { ...source, message: { id: source.messageId }, channel: { id: source.channelId, type: source.type === 'private' ? 1 : 0 } } : source
  const guildId = id(data.guild)
  const privateChannel = record(data.channel).type === 1 || event === 'friend-request'
  return {
    bot, platform: bot.platform, botId: bot.id, selfId: bot.selfId, event, data,
    type: privateChannel ? 'private' as const : 'group' as const,
    userId: id(data.user), guildId, channelId: id(data.channel), messageId: id(data.message),
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
    sn: typeof data.sn === 'number' ? data.sn : undefined,
  }
}
