import { isObj } from './state/shared.ts'

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
const legacyEligible = (row: Owner) => row.platform === 'qq' && !row.botId && /^\d+$/.test(row.userId)

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

export function ownerFields(input: OwnerInput) {
  const owners = Object.hasOwn(input, 'owners') ? readOwners(input.owners) : legacyOwners(input)
  const eligible = owners.filter(legacyEligible).map(row => row.userId)
  const primary = digits(input.ownerQQ)
  const ownerQQ = eligible.includes(primary) ? primary : ''
  return { owners, ownerQQ, ownerIds: eligible.filter(id => id !== ownerQQ) }
}

export function reconcileOwnerEdit<T extends OwnerInput>(next: T, previous: OwnerInput, explicitOwners = false): T {
  if (explicitOwners || JSON.stringify(next.owners) !== JSON.stringify(previous.owners)) return next
  if (next.ownerQQ === previous.ownerQQ && JSON.stringify(next.ownerIds) === JSON.stringify(previous.ownerIds)) return next
  const old = readOwners(previous.owners)
  const byId = new Map(old.filter(legacyEligible).map(row => [row.userId, row]))
  return { ...next, owners: [...old.filter(row => !legacyEligible(row)), ...legacyOwners(next).map(row => byId.get(row.userId) || row)] }
}

export function isOwnerOf(cfg: { owners?: Owner[] }, source: OwnerSession | string | number, platform?: string, botId?: string): boolean {
  const session = source && typeof source === 'object' ? source : undefined
  const origin = session?.platform ?? platform
  const user = identifier(session?.userId ?? source)
  const bot = session?.bot?.id ?? botId
  return Boolean(origin && user && cfg.owners?.some(row => row.platform === origin && row.userId === user && (!row.botId || row.botId === bot)))
}
