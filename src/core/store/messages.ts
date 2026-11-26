/**
 * 聊天流水存储：node:sqlite（每个会话目录一个库）。
 *
 * 旧版本按天写 `<day>.jsonl`。首次打开空库时自动导入同目录的 JSONL，
 * 导入后把原文件改名为 `<day>.jsonl.migrated`，不重复导入、也不丢原始数据。
 */

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, renameSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureDir } from './index.ts'

export interface MessageLog {
  append(day: string, row: Record<string, any>): void
  read(day: string): Record<string, any>[]
  mutate(day: string, fn: (row: Record<string, any>) => Record<string, any> | null | void): number
  days(): string[]
  remove(day: string): void
  close(): void
}

interface CachedRow {
  id: number
  data: Record<string, any>
}

interface OpenLog {
  directory: string
  store: MessageLog
  owners: Set<symbol>
}
const stores = new Map<string, OpenLog>()
const defaultOwner = Symbol('default')

function acquire(dir: string, owner: symbol) {
  const directory = resolve(dir)
  const key = process.platform === 'win32' ? directory.toLowerCase() : directory
  let entry = stores.get(key)
  if (!entry) {
    const store = createMessageLog(directory, () => stores.delete(key))
    entry = { directory, store, owners: new Set() }
    stores.set(key, entry)
  }
  entry.owners.add(owner)
  return entry.store
}

export const messageLogOf = (dir: string) => acquire(dir, defaultOwner)

export function createMessageLogScope() {
  const owner = Symbol('message log scope')
  let disposed = false
  return {
    open(dir: string) {
      if (disposed) throw Error('聊天记录已关闭')
      return acquire(dir, owner)
    },
    close() {
      disposed = true
      for (const { store, owners } of stores.values()) {
        if (owners.delete(owner) && !owners.size) store.close()
      }
    },
  }
}

export function closeAllMessageLogs(): void {
  for (const { store } of stores.values()) store.close()
}

export function closeMessageLogsUnder(dir: string): void {
  for (const { directory, store } of stores.values()) {
    const rel = relative(resolve(dir), directory)
    if (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) store.close()
  }
}

function createMessageLog(dir: string, release: () => void): MessageLog {
  ensureDir(dir)
  const db = new DatabaseSync(join(dir, 'messages.db'))
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 3000')
  } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      t INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_day ON messages(day, t);
  `)

  const insert = db.prepare('INSERT INTO messages (day, t, payload) VALUES (?, ?, ?)')
  const selectDay = db.prepare('SELECT id, payload FROM messages WHERE day = ? ORDER BY t ASC, id ASC')
  const deleteDay = db.prepare('DELETE FROM messages WHERE day = ?')
  const updateRow = db.prepare('UPDATE messages SET t = ?, payload = ? WHERE id = ?')
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM messages')
  const listDays = db.prepare('SELECT DISTINCT day FROM messages ORDER BY day ASC')

  const cache = new Map<string, CachedRow[]>()

  const load = (day: string): CachedRow[] => {
    const cached = cache.get(day)
    if (cached) return cached
    const rows = (selectDay.all(day) as Array<{ id: number; payload: string }>).map((item) => {
      let data: Record<string, any>
      try {
        data = JSON.parse(String(item.payload))
      } catch {
        data = { __broken: true }
      }
      return { id: Number(item.id), data }
    })
    cache.set(day, rows)
    return rows
  }

  const migrate = (): void => {
    try {
      const total = Number((countAll.get() as { n?: number } | undefined)?.n ?? 0)
      if (total > 0) return
      const files = readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      if (!files.length) return
      db.exec('BEGIN')
      try {
        for (const name of files) {
          const day = name.slice(0, 10)
          const text = readFileSync(join(dir, name), 'utf8')
          for (const line of text.split('\n')) {
            if (!line.trim()) continue
            try {
              const row = JSON.parse(line)
              insert.run(day, Number(row?.t) || 0, JSON.stringify(row))
            } catch {}
          }
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      for (const name of files) {
        try {
          renameSync(join(dir, name), join(dir, `${name}.migrated`))
        } catch {}
      }
    } catch {}
  }

  migrate()
  let closed = false

  return {
    append(day, row) {
      const payload = JSON.stringify(row ?? {})
      const list = load(day)
      const result = insert.run(day, Number(row?.t) || 0, payload)
      list.push({ id: Number(result.lastInsertRowid), data: row })
    },
    read(day) {
      return load(day).map((item) => item.data)
    },
    mutate(day, fn) {
      let changed = 0
      for (const item of load(day)) {
        const next = fn(item.data) as Record<string, any> | null | undefined
        if (next == null || next === item.data) continue
        item.data = next
        updateRow.run(Number(next.t) || 0, JSON.stringify(next), item.id)
        changed++
      }
      return changed
    },
    days() {
      return (listDays.all() as Array<{ day: string }>).map((item) => String(item.day))
    },
    remove(day) {
      deleteDay.run(day)
      cache.delete(day)
    },
    close() {
      if (closed) return
      db.close()
      closed = true
      release()
    },
  }
}
