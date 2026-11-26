import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface Evidence {
  id: string
  role: 'user' | 'assistant'
  text: string
  speakerId: string
  at: number
  contextAt: number
}

function legacyEvidence(line: string): Evidence {
  const row = JSON.parse(line)
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.text !== 'string' ||
      !['user', 'assistant'].includes(row.role) || !Number.isFinite(row.at) ||
      !Number.isFinite(row.contextAt ?? row.at)) throw Error('Invalid conversation evidence')
  return { ...row, speakerId: String(row.speakerId ?? ''), contextAt: row.contextAt ?? row.at }
}

export function openEvidenceStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'evidence.db')
  closeSync(openSync(file, 'a', 0o600))
  const db = new DatabaseSync(file)
  try {
    db.exec(`
      PRAGMA busy_timeout = 3000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS evidence (
        scope TEXT NOT NULL, room TEXT NOT NULL, seq INTEGER NOT NULL,
        id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, speakerId TEXT NOT NULL,
        at INTEGER NOT NULL, contextAt INTEGER NOT NULL,
        PRIMARY KEY(scope, room, seq), UNIQUE(scope, room, id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS imported_rooms (
        scope TEXT NOT NULL, room TEXT NOT NULL, PRIMARY KEY(scope, room)
      ) WITHOUT ROWID;
    `)
    const imported = db.prepare('SELECT 1 FROM imported_rooms WHERE scope=? AND room=?')
    const mark = db.prepare('INSERT INTO imported_rooms VALUES (?,?)')
    const write = db.prepare(`INSERT INTO evidence
      SELECT ?,?,coalesce(max(seq),0)+1,?,?,?,?,?,? FROM evidence WHERE scope=? AND room=?
      ON CONFLICT(scope,room,id) DO NOTHING`)
    const last = db.prepare('SELECT coalesce(max(seq),0) AS seq FROM evidence WHERE scope=? AND room=?')
    const range = db.prepare(`SELECT id,role,text,speakerId,at,contextAt FROM evidence
      WHERE scope=? AND room=? AND seq>? AND seq<=? ORDER BY seq`)

    function append(scope: string, room: string, row: Evidence) {
      return write.run(scope, room, row.id, row.role, row.text, row.speakerId, row.at, row.contextAt, scope, room).changes === 1
    }

    function migrate(scope: string, room: string) {
      if (imported.get(scope, room)) return
      db.exec('BEGIN IMMEDIATE')
      try {
        if (!imported.get(scope, room)) {
          const hash = createHash('sha256').update(scope + '\0' + room).digest('hex')
          const journal = join(directory, hash + '.jsonl')
          if (existsSync(journal)) {
            const lines = readFileSync(journal, 'utf8').split('\n')
            for (const [i, line] of lines.entries()) {
              if (!line.trim()) continue
              try {
                if (!append(scope, room, legacyEvidence(line))) throw Error('Duplicate evidence ID')
              } catch (cause) {
                const reason = cause instanceof SyntaxError && i === lines.length - 1 ? 'incomplete tail' : 'corrupt record'
                throw Error(`Conversation journal ${reason} at line ${i + 1}; preserving source`, { cause })
              }
            }
          }
          mark.run(scope, room)
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }

    return {
      migrate, append,
      length(scope: string, room: string) { return Number(last.get(scope, room).seq) },
      range(scope: string, room: string, after: number, through: number) {
        return range.all(scope, room, after, through) as unknown as Evidence[]
      },
      close() { db.close() },
    }
  } catch (error) {
    db.close()
    throw error
  }
}
