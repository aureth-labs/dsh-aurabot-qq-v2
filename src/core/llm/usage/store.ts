import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beijingDayKey } from './offpeak.ts'
import type { UsageRow, SessionCursor } from './usage.ts'

export const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0

export function openUsage(dir: string) {
  const db = new DatabaseSync(join(dir, 'usage.sqlite'))
  try {
    db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS entries(
        id TEXT UNIQUE, at INTEGER NOT NULL, module TEXT NOT NULL, chat TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        input INTEGER NOT NULL, output INTEGER NOT NULL, cached INTEGER NOT NULL, written INTEGER NOT NULL, runs INTEGER NOT NULL, task TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_at ON entries(at);
      CREATE TABLE IF NOT EXISTS cursors(id TEXT PRIMARY KEY, at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value INTEGER NOT NULL)`)
    const write = db.prepare(`INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET at=excluded.at,module=excluded.module,chat=excluded.chat,provider=excluded.provider,
        model=excluded.model,input=excluded.input,output=excluded.output,cached=excluded.cached,written=excluded.written,runs=excluded.runs,task=excluded.task`)
    const cursor = db.prepare('SELECT value FROM cursors WHERE id=?')
    const save = db.prepare('INSERT OR REPLACE INTO cursors VALUES(?,?,?)')
    const prior = db.prepare('SELECT module FROM entries WHERE id=?')
    const range = db.prepare('SELECT at,module,chat,provider,model,input AS "in",output AS "out",cached,written,runs,task FROM entries WHERE at BETWEEN ? AND ?')
    const byDay = db.prepare(`SELECT strftime('%Y-%m-%d',at/1000,'unixepoch','+8 hours') AS day,
      SUM(input) AS "in",SUM(output) AS "out",SUM(cached) AS cached,SUM(written) AS written,SUM(runs) AS runs
      FROM entries WHERE at BETWEEN ? AND ? GROUP BY day`)
    const readMeta = db.prepare('SELECT value FROM metadata WHERE key=?')
    const setMeta = db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)')
    function transaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE')
      try { const value = fn(); db.exec('COMMIT'); return value }
      catch (error) { db.exec('ROLLBACK'); throw error }
    }
    function put(row: UsageRow) {
      write.run(row.id || null, row.at, String(row.module || ''), String(row.chat || ''), String(row.provider || ''), String(row.model || ''),
        count(row.in), count(row.out), count(row.cached), count(row.written), count(row.runs) || 1, String(row.task || ''))
    }
    transaction(() => {
      const legacy = join(dir, 'usage.json')
      if (!readMeta.get('imported-json') && existsSync(legacy)) {
        const raw = JSON.parse(readFileSync(legacy, 'utf8'))
        for (const [day, group] of Object.entries(raw.days || {})) {
          const at = Date.parse(day + 'T00:00:01+08:00')
          if (!Number.isFinite(at) || beijingDayKey(at) !== day) continue
          if (Array.isArray(group)) {
            for (const row of group) if (row && Number.isSafeInteger(row.at)) put(row)
          } else if (group && typeof group === 'object') {
            for (const [module, sum] of Object.entries(group)) {
              if (!sum || typeof sum !== 'object') continue
              put({ at, module, in: sum.in, out: sum.out, cached: sum.hit, runs: sum.calls, chat: '', provider: '', model: '' })
            }
          }
        }
        for (const [id, value] of Object.entries(raw.sessions || {}) as Array<[string, SessionCursor]>) {
          if (Number.isSafeInteger(value?.seq) && Number.isSafeInteger(value.at)) save.run(id, value.at, JSON.stringify(value))
        }
        if (Number.isSafeInteger(raw.startedAt)) setMeta.run('started', raw.startedAt)
        setMeta.run('imported-json', 1)
      }
      if (!readMeta.get('started')) setMeta.run('started', Date.now())
    })
    const removeEntries = db.prepare('DELETE FROM entries WHERE at < ?')
    const removeCursors = db.prepare('DELETE FROM cursors WHERE at < ?')
    let pruned = 0
    return {
      transaction, put, startedAt: Number(readMeta.get('started').value),
      module: (id: string) => prior.get(id)?.module as string | undefined,
      cursor(id: string): SessionCursor | null { const row = cursor.get(id); return row ? JSON.parse(String(row.value)) : null },
      save: (id: string, c: SessionCursor) => save.run(id, c.at, JSON.stringify(c)),
      rows: (a: number, b: number) => range.all(a, b) as unknown as UsageRow[],
      days: (a: number, b: number) => byDay.all(a, b) as unknown as Array<UsageRow & { day: string }>,
      first: () => db.prepare('SELECT min(at) AS at FROM entries').get().at as number | null,
      prune(cut: number) {
        if (cut <= pruned) return
        transaction(() => { removeEntries.run(cut); removeCursors.run(cut) }); pruned = cut
      },
      close: () => db.close(),
    }
  } catch (error) { db.close(); throw error }
}
