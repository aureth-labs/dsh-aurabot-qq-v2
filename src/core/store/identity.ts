import { DatabaseSync } from 'node:sqlite'
import type { TargetType } from '../../types/core/target.ts'
import { isOwnerOf, type Owner } from '../config/owners.ts'

export type SubjectKind = 'user' | TargetType
export interface SubjectKey { platform: string; botId: string; kind: SubjectKind; id: string }
interface IdentityRow extends SubjectKey { name: string; alias: string; level: number | null; seen: number }
type Scope = Pick<SubjectKey, 'platform' | 'botId'>
type Incoming = { type: TargetType; channelId: string; userId: string; userName?: string; channelName?: string }
type OwnerConfig = { owners?: Owner[] }

function createDirectory(file: string) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL')
  function table(name: 'users' | 'channels') {
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      platform TEXT NOT NULL, botId TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', alias TEXT NOT NULL DEFAULT '', level INTEGER CHECK(level BETWEEN 0 AND 5),
      seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (platform,botId,kind,id)) WITHOUT ROWID`)
    return {
      observe: db.prepare(`INSERT INTO ${name} (platform,botId,kind,id,name,seen) VALUES (?,?,?,?,?,?)
        ON CONFLICT (platform,botId,kind,id) DO UPDATE SET seen=excluded.seen,
        name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE ${name}.name END`),
      levels: db.prepare(`SELECT botId,level FROM ${name} WHERE platform=? AND botId IN (?, '') AND kind=? AND id=? AND level IS NOT NULL`),
      edit: db.prepare(`INSERT INTO ${name} (platform,botId,kind,id,alias,level) VALUES (?,?,?,?,?,?)
        ON CONFLICT (platform,botId,kind,id) DO UPDATE SET alias=excluded.alias,level=excluded.level`),
      grant: db.prepare(`INSERT INTO ${name} (platform,botId,kind,id,level) VALUES (?,?,?,?,?)
        ON CONFLICT (platform,botId,kind,id) DO UPDATE SET level=excluded.level`),
      remove: db.prepare(`DELETE FROM ${name} WHERE platform=? AND botId=? AND kind=? AND id=?`),
      list: db.prepare(`SELECT * FROM ${name} WHERE (?='' OR platform=?) AND (?='' OR botId=?) AND
        (?='' OR instr(id,?) OR instr(name,?) OR instr(alias,?))
        ORDER BY platform,botId,kind,id LIMIT ? OFFSET ?`),
    }
  }
  try {
    const users = table('users'), channels = table('channels')
    return { db, users, channels }
  } catch (error) { db.close(); throw error }
}

export function createIdentityDirectory(location: () => string, config: () => OwnerConfig) {
  let state: ReturnType<typeof createDirectory> | undefined
  let closed = false
  function store() {
    if (closed) throw new Error('身份目录已关闭')
    return state ??= createDirectory(location())
  }
  function owner(key: SubjectKey) {
    return key.kind === 'user' && isOwnerOf(config(), key.id, key.platform, key.botId)
  }
  function level(key: SubjectKey): number {
    if (owner(key)) return 5
    const table = key.kind === 'user' ? store().users : store().channels
    const rows = table.levels.all(key.platform, key.botId, key.kind, key.id)
    if (rows.some(row => row.level === 0)) return 0
    return Number(rows.find(row => row.botId === key.botId)?.level ?? rows[0]?.level ?? 1)
  }
  function authority(scope: Scope, message: Incoming) {
    const user = level({ ...scope, kind: 'user', id: message.userId })
    const required = level({ ...scope, kind: message.type, id: message.channelId })
    return required > 0 && user >= required ? user : 0
  }
  function checkLevel(key: SubjectKey, value: number | null) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 5)) throw new Error('权限等级范围是 0 至 5')
    if (owner(key) && value !== null && value !== 5) throw new Error('主人权限由接入配置管理')
  }
  return {
    authority,
    authorize(scope: Scope, actor: Incoming, userId: string, value: number) {
      if (typeof userId !== 'string' || !userId.trim() || userId.length > 512 || !Number.isInteger(value)) throw new Error('请提供有效的用户 ID 和权限等级')
      const key: SubjectKey = { ...scope, kind: 'user', id: userId.trim() }
      const { db, users } = store()
      db.exec('BEGIN IMMEDIATE')
      try {
        if (authority(scope, actor) !== 5) throw new Error('只有 5 级用户可以授权')
        checkLevel(key, value)
        users.grant.run(key.platform, key.botId, key.kind, key.id, value)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    observe(scope: Scope, message: Incoming) {
      const { db, users, channels } = store()
      const now = Date.now()
      db.exec('BEGIN IMMEDIATE')
      try {
        users.observe.run(scope.platform, scope.botId, 'user', message.userId, message.userName || '', now)
        channels.observe.run(scope.platform, scope.botId, message.type, message.channelId, message.channelName || '', now)
        const value = authority(scope, message)
        db.exec('COMMIT')
        return value
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    list(table: 'users' | 'channels', platform: string, botId: string, query: string, limit: number, offset: number) {
      const rows = store()[table].list.all(platform, platform, botId, botId, query, query, query, query, limit + 1, offset) as unknown as IdentityRow[]
      return { rows: rows.slice(0, limit).map(row => ({ ...row, owner: owner(row), effective: level(row) })), more: rows.length > limit }
    },
    edit(key: SubjectKey, alias: string, value: number | null) {
      checkLevel(key, value)
      const table = key.kind === 'user' ? store().users : store().channels
      table.edit.run(key.platform, key.botId, key.kind, key.id, alias, value)
    },
    remove(key: SubjectKey) {
      const table = key.kind === 'user' ? store().users : store().channels
      table.remove.run(key.platform, key.botId, key.kind, key.id)
    },
    close() { closed = true; state?.db.close(); state = undefined },
  }
}
export type IdentityDirectory = ReturnType<typeof createIdentityDirectory>
