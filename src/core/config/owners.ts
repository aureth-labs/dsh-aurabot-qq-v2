import { isObj } from './state/shared.ts'
import { isLegacyScope, roomKey, roomOf } from '../bot/room.ts'

export interface Owner {
  platform: string
  userId: string
  botId?: string
  note?: string
}

type OwnerSession = { platform: string; userId: string; bot: { id: string } }
type OwnerInput = { owners?: unknown; ownerQQ?: unknown; ownerIds?: unknown }

const identifier = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const digits = (value: unknown) => identifier(value).replace(/\D/g, '')

function legacyOwners(input: OwnerInput): Owner[] {
  const extra = Array.isArray(input.ownerIds) ? input.ownerIds : String(input.ownerIds || '').split(/[\s,，;；]+/)
  return [...new Set([input.ownerQQ, ...extra].map(digits).filter(Boolean))].map(userId => ({ platform: 'qq', userId }))
}

function readOwners(value: unknown): Owner[] {
  const seen = new Set<string>()
  const rows: Owner[] = []
  for (const row of Array.isArray(value) ? value : []) {
    if (!isObj(row)) continue
    const platform = typeof row.platform === 'string' ? row.platform.trim() : ''
    const userId = identifier(row.userId)
    const botId = identifier(row.botId)
    if (!platform || !userId || (row.botId != null && row.botId !== '' && !botId)) continue
    const key = JSON.stringify([platform, userId, botId])
    if (seen.has(key)) continue
    seen.add(key)
    const note = typeof row.note === 'string' ? row.note.trim() : ''
    rows.push({ platform, userId, ...(botId && { botId }), ...(note && { note }) })
  }
  return rows
}

export function ownersOf(input: OwnerInput): Owner[] {
  return Object.hasOwn(input, 'owners') ? readOwners(input.owners) : legacyOwners(input)
}

export function isOwnerOf(cfg: { owners?: Owner[] }, source: OwnerSession | string | number, platform?: string, botId?: string): boolean {
  const session = source && typeof source === 'object' ? source : undefined
  const origin = session?.platform ?? platform
  const user = identifier(session?.userId ?? source)
  const bot = session?.bot?.id ?? botId
  return Boolean(origin && user && cfg.owners?.some(row => row.platform === origin && row.userId === user && (!row.botId || row.botId === bot)))
}

export function primaryOwner(cfg: { owners?: Owner[] }): Owner | undefined {
  return cfg.owners?.find(row => isLegacyScope(row.platform, row.botId ?? (row.platform === 'qq' ? 'adapter-qq-onebot-v11' : undefined))) ?? cfg.owners?.[0]
}

export function ownerId(cfg: { owners?: Owner[] }): string {
  return primaryOwner(cfg)?.userId ?? ''
}

export function ownerRoom(cfg: { owners?: Owner[] }): string {
  const owner = primaryOwner(cfg)
  if (!owner) return ''
  const botId = owner.botId ?? (owner.platform === 'qq' ? 'adapter-qq-onebot-v11' : '')
  return botId ? roomKey({ platform: owner.platform, botId, type: 'private', id: owner.userId }) : ''
}

export function isOwnerRoom(cfg: { owners?: Owner[] }, key: unknown): boolean {
  const room = roomOf(key)
  if (room?.kind !== 'private') return false
  if (!room.platform) return isOwnerOf(cfg, room.id, 'qq', 'adapter-qq-onebot-v11')
  return isOwnerOf(cfg, room.id, room.platform, room.botId)
}

export function ownersOn(cfg: { owners?: Owner[] }, platform: string, botId: string): string[] {
  return (cfg.owners ?? []).filter(row => row.platform === platform && (!row.botId || row.botId === botId)).map(row => row.userId)
}
