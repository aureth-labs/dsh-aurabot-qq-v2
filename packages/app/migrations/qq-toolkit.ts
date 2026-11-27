import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../src/core/store/index.ts'
import { backup, object, read, type Values } from './files.ts'

const plugin = 'shangxueink/qq-toolkit'
const LEVELS = ['off', 'owner', 'all']
const PERMS = { qqNickname: 'nickname', qqSignature: 'signature', qqAvatar: 'avatar', qqFriendRequest: 'requests' }

export function migrateQqToolkit(root = dataDir()) {
  const path = join(root, 'config.json')
  if (!existsSync(path)) return
  const raw = object(read(path))
  const perms = object(raw.profilePerms)
  if (!Object.hasOwn(raw, 'qqApi') && !Object.keys(PERMS).some((key) => Object.hasOwn(perms, key))) return
  backup(path, '.before-qq-toolkit')
  const modules = object(raw.modules)
  const settings: Values = { api: object(raw.qqApi).enabled !== false, groupAdmin: object(modules['group-admin']).enabled !== false }
  for (const [from, to] of Object.entries(PERMS)) if (LEVELS.includes(String(perms[from]))) settings[to] = perms[from]
  const next: Values = { ...raw }
  delete next.qqApi
  const rest = Object.fromEntries(Object.entries(perms).filter(([key]) => !Object.hasOwn(PERMS, key)))
  if (Object.keys(rest).length) next.profilePerms = rest
  else delete next.profilePerms
  const cleanModules = { ...modules }
  for (const id of ['qq-api', 'group-admin', 'profile', 'contacts']) delete cleanModules[id]
  next.modules = cleanModules
  const ext = object(raw.ext)
  next.ext = { ...ext, [plugin]: { ...settings, ...object(ext[plugin]) } }
  writeJson(path, next)
}
