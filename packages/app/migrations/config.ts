import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../src/core/store/index.ts'
import { backup, object, read, type Values } from './files.ts'

const adapter = 'adapter-qq-onebot-v11'
const LEGACY = ['botQQ', 'onebot', 'snowluma', 'gateway', 'ownerQQ', 'ownerIds', 'approvalViaQQ']
const ENDPOINT = ['wsUrl', 'httpUrl', 'wsToken', 'httpToken']
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')

function owners(raw: Values) {
  const primary = digits(raw.ownerQQ)
  const extra = Array.isArray(raw.ownerIds) ? raw.ownerIds : String(raw.ownerIds ?? '').split(/[\s,，;；]+/)
  const rows = Array.isArray(raw.owners)
    ? raw.owners.map(object)
    : [...new Set([primary, ...extra.map(digits)].filter(Boolean))].map((userId) => ({ platform: 'qq', userId }))
  const first = rows.findIndex((row) => row.platform === 'qq' && !row.botId && row.userId === primary)
  return first > 0 ? [rows[first], ...rows.filter((_, index) => index !== first)] : rows
}

export function migrateConfig(root = dataDir()) {
  const path = join(root, 'config.json')
  if (!existsSync(path)) return
  const raw = object(read(path))
  if (!LEGACY.some((key) => Object.hasOwn(raw, key))) return
  backup(path, '.before-v2')
  const connection = object(raw.onebot ?? raw.snowluma)
  const selfId = digits(raw.botQQ)
  const ext = object(raw.ext)
  const settings = {
    ...Object.fromEntries(ENDPOINT.map((key) => [key, String(connection[key] ?? '').trim()]).filter(([, value]) => value)),
    ...(selfId && { selfId }),
    ...object(ext[adapter]),
  }
  const next: Values = { ...raw, owners: owners(raw) }
  if (Object.hasOwn(raw, 'approvalViaQQ') && !Object.hasOwn(raw, 'approvalViaChat')) next.approvalViaChat = raw.approvalViaQQ !== false
  for (const key of LEGACY) delete next[key]
  if (Object.keys(settings).length) next.ext = { ...ext, [adapter]: settings }
  writeJson(path, next)
}
