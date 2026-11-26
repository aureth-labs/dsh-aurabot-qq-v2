import { targetKey, type Target } from '../pipeline/target.ts'
import { DatabaseSync } from 'node:sqlite'

export interface ConversationLine {
  role: 'user' | 'assistant'
  speaker: string
  text: string
  at?: number
}

export function openConversations(file: string) {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS received (
      room TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (room, message)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS history (
      seq INTEGER PRIMARY KEY, room TEXT NOT NULL, persona TEXT NOT NULL,
      role TEXT NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS revisions (
      room TEXT NOT NULL, persona TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(room, persona)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS accounts (
      platform TEXT NOT NULL, instance TEXT NOT NULL, self TEXT NOT NULL, PRIMARY KEY(platform, instance)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS history_room ON history(room, persona, seq);
  `)
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!db.prepare('PRAGMA table_info(history)').all().some(column => column.name === 'at'))
      db.exec('ALTER TABLE history ADD COLUMN at INTEGER NOT NULL DEFAULT 0')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  const bind = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?,?,?)')
  const lookup = db.prepare('SELECT self FROM accounts WHERE platform=? AND instance=?')
  const claim = db.prepare('INSERT OR IGNORE INTO received VALUES (?, ?)')
  const seen = db.prepare('SELECT 1 FROM received WHERE room = ? AND message = ?')
  const recent = db.prepare('SELECT role, speaker, text, at FROM history WHERE room = ? AND persona = ? ORDER BY seq DESC LIMIT ?')
  const revision = db.prepare('SELECT version FROM revisions WHERE room=? AND persona=?')
  const advance = db.prepare('INSERT INTO revisions VALUES (?,?,1) ON CONFLICT(room,persona) DO UPDATE SET version=version+1')
  const write = db.prepare('INSERT INTO history(room, persona, role, speaker, text, at) VALUES (?, ?, ?, ?, ?, ?)')
  const trim = db.prepare(`DELETE FROM history WHERE room = ? AND persona = ? AND seq IN
    (SELECT seq FROM history WHERE room = ? AND persona = ? ORDER BY seq DESC LIMIT -1 OFFSET ?)`)
  return {
    room(target: Target, selfId: string) {
      if (!selfId) throw Error('适配器尚未提供登录身份')
      let origin = lookup.get(target.platform, target.botId)
      if (!origin) {
        bind.run(target.platform, target.botId, selfId)
        origin = lookup.get(target.platform, target.botId)
      }
      return origin.self === selfId ? targetKey(target)
        : JSON.stringify([target.platform, target.botId, selfId, target.type, target.id])
    },
    claim(room: string, message?: string) { return !message || claim.run(room, message).changes === 1 },
    seen(room: string, message?: string) { return Boolean(message && seen.get(room, message)) },
    revision(room: string, persona: string) { return Number(revision.get(room, persona)?.version ?? 0) },
    recent(room: string, persona: string, limit: number): ConversationLine[] {
      return recent.all(room, persona, limit).reverse() as unknown as ConversationLine[]
    },
    append(room: string, persona: string, lines: ConversationLine[], limit: number) {
      db.exec('BEGIN IMMEDIATE')
      try {
        if (limit > 0) for (const row of lines) write.run(room, persona, row.role, row.speaker, row.text, row.at ?? Date.now())
        if (lines.length) advance.run(room, persona)
        trim.run(room, persona, room, persona, limit)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close() { db.close() },
  }
}
