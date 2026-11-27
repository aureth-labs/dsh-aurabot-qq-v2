import type { Target, TargetType } from '../../types/core/target.ts'

export interface Room {
  kind: TargetType
  id: string
  platform?: string
  botId?: string
}

let legacy: { platform: string; botId: string } | undefined

export function useLegacyRooms(platform: string, botId: string) {
  legacy = { platform, botId }
  return () => {
    if (legacy?.platform === platform && legacy.botId === botId) legacy = undefined
  }
}

export const isLegacyScope = (platform?: string, botId?: string) =>
  !platform || (legacy?.platform === platform && legacy.botId === botId)

export function roomKey(target: Pick<Target, 'platform' | 'botId' | 'type' | 'id'>): string {
  const id = String(target.id)
  if (isLegacyScope(target.platform, target.botId)) return target.type + ':' + id
  return `${target.type}:${encodeURIComponent(id)}#${target.platform}/${target.botId}`
}

export function roomOf(key: unknown): Room | null {
  const text = String(key ?? '')
  const match = /^(group|private|channel):([^#]*)(?:#([^/]+)\/(.+))?$/.exec(text)
  if (!match || !match[2]) return null
  const [, kind, raw, platform, botId] = match
  if (!platform) return legacy
    ? { kind: kind as TargetType, id: raw, platform: legacy.platform, botId: legacy.botId }
    : { kind: kind as TargetType, id: raw }
  return { kind: kind as TargetType, id: decodeURIComponent(raw), platform, botId }
}

export const roomId = (key: unknown) => roomOf(key)?.id ?? ''
export const isGroupRoom = (key: unknown) => String(key ?? '').startsWith('group:')
export const isPrivateRoom = (key: unknown) => String(key ?? '').startsWith('private:')
export const groupOf = (key: unknown) => (isGroupRoom(key) ? roomId(key) : '')
export const userOf = (key: unknown) => (isPrivateRoom(key) ? roomId(key) : '')

export function targetOfRoom(key: unknown): Target | null {
  const room = roomOf(key)
  if (!room?.platform || !room.botId) return null
  return { platform: room.platform, botId: room.botId, type: room.kind, id: room.id }
}

export function scopeOfRoom(key: unknown) {
  const room = roomOf(key)
  return room?.platform && room.botId ? { platform: room.platform, botId: room.botId } : null
}
