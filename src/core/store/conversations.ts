import { DatabaseSync } from 'node:sqlite'

export interface ConversationLine {
  role: 'user' | 'assistant'
  speaker: string
  text: string
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
      role TEXT NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_room ON history(room, persona, seq);
  `)
  const claim = db.prepare('INSERT OR IGNORE INTO received VALUES (?, ?)')
  const seen = db.prepare('SELECT 1 FROM received WHERE room = ? AND message = ?')
  const recent = db.prepare('SELECT role, speaker, text FROM history WHERE room = ? AND persona = ? ORDER BY seq DESC LIMIT ?')
  const write = db.prepare('INSERT INTO history(room, persona, role, speaker, text) VALUES (?, ?, ?, ?, ?)')
  const trim = db.prepare(`DELETE FROM history WHERE room = ? AND persona = ? AND seq IN
    (SELECT seq FROM history WHERE room = ? AND persona = ? ORDER BY seq DESC LIMIT -1 OFFSET ?)`)
  return {
    claim(room: string, message?: string) { return !message || claim.run(room, message).changes === 1 },
    seen(room: string, message?: string) { return Boolean(message && seen.get(room, message)) },
    recent(room: string, persona: string, limit: number): ConversationLine[] {
      return recent.all(room, persona, limit).reverse() as unknown as ConversationLine[]
    },
    append(room: string, persona: string, lines: ConversationLine[], limit: number) {
      db.exec('BEGIN IMMEDIATE')
      try {
        if (limit > 0) for (const row of lines) write.run(room, persona, row.role, row.speaker, row.text)
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
