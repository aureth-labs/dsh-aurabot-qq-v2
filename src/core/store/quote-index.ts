import { DatabaseSync } from 'node:sqlite'
import type { MessageQuote } from '../../types/core/session.ts'

export function openQuoteIndex(file: string) {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      room TEXT NOT NULL, id TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '', created INTEGER, deleted INTEGER,
      PRIMARY KEY(room, id)
    ) WITHOUT ROWID
  `)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO messages(room,id,author,content,created) VALUES(?,?,?,?,?)',
  )
  const find = db.prepare('SELECT author,content,created,deleted FROM messages WHERE room=? AND id=?')
  const recall = db.prepare(`INSERT INTO messages(room,id,deleted) VALUES(?,?,?)
    ON CONFLICT(room,id) DO UPDATE SET deleted=COALESCE(messages.deleted,excluded.deleted)`)
  return {
    record(room: string, id: string, userId: string, content: string, at: number) {
      insert.run(room, id, userId, content.slice(0, 8192), at)
    },
    get(room: string, channelId: string, id: string): MessageQuote | undefined {
      const row = find.get(room, id)
      if (!row) return
      return row.deleted == null
        ? {
            id,
            channelId,
            userId: String(row.author),
            content: String(row.content),
            createdAt: Number(row.created),
          }
        : { id, channelId, deletedAt: Number(row.deleted) }
    },
    recall(room: string, id: string, at: number) {
      recall.run(room, id, at)
    },
    close() {
      db.close()
    },
  }
}
