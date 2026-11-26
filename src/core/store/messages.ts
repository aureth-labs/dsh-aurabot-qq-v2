import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
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
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS imported_days (day TEXT PRIMARY KEY) WITHOUT ROWID;
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
  const imported = db.prepare('SELECT 1 FROM imported_days WHERE day=?')
  const mark = db.prepare('INSERT OR IGNORE INTO imported_days VALUES (?)')
  const populated = db.prepare('SELECT 1 FROM messages WHERE day=? LIMIT 1')
  const dataVersion = db.prepare('PRAGMA data_version')
  let version = Number(dataVersion.get().data_version)
  const pending = new Set(readdirSync(dir).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).map(file => file.slice(0, 10)))
  const listDays = db.prepare('SELECT DISTINCT day FROM messages ORDER BY day ASC')

  const cache = new Map<string, CachedRow[]>()

  const load = (day: string): CachedRow[] => {
    importDay(day)
    const next = Number(dataVersion.get().data_version)
    if (version !== next) { cache.clear(); version = next }
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
    if (cache.size >= 8) cache.delete(cache.keys().next().value)
    cache.set(day, rows)
    return rows
  }

  function importDay(day: string) {
    if (!pending.has(day)) return
    const source = join(dir, day + '.jsonl')
    let committed = false
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!imported.get(day) && existsSync(source)) {
        // An existing daily ledger can contain later edits and forgotten messages.
        if (!populated.get(day)) {
          for (const [i, line] of readFileSync(source, 'utf8').split('\n').entries()) {
            if (!line.trim()) continue
            try {
              const row = JSON.parse(line)
              if (!row || Array.isArray(row) || typeof row !== 'object') throw Error('Expected a message')
              insert.run(day, Number(row.t) || 0, JSON.stringify(row))
            } catch (cause) {
              throw Error(`聊天记录 ${day} 第 ${i + 1} 行损坏，已保留源文件`, { cause })
            }
          }
          committed = true
        }
        mark.run(day)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    pending.delete(day)
    if (committed && !existsSync(source + '.migrated')) {
      try { renameSync(source, source + '.migrated') } catch { /* The import marker also covers an unrenamed source. */ }
    }
  }

  let closed = false

  return {
    append(day, row) {
      const payload = JSON.stringify(row ?? {})
      importDay(day)
      insert.run(day, Number(row?.t) || 0, payload)
      cache.delete(day)
    },
    read(day) {
      return load(day).map((item) => item.data)
    },
    mutate(day, fn) {
      importDay(day)
      db.exec('BEGIN IMMEDIATE')
      try {
        let changed = 0
        for (const item of load(day)) {
          const next = fn(item.data)
          if (!next || next === item.data) continue
          updateRow.run(Number(next.t) || 0, JSON.stringify(next), item.id)
          changed++
        }
        db.exec('COMMIT')
        return changed
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        cache.delete(day)
      }
    },
    days() {
      const days = (listDays.all() as Array<{ day: string }>).map(row => row.day)
      for (const day of pending) if (!imported.get(day)) days.push(day)
      return [...new Set(days)].sort()
    },
    remove(day) {
      db.exec('BEGIN IMMEDIATE')
      try {
        mark.run(day)
        deleteDay.run(day)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      pending.delete(day)
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
