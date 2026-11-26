import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { tokenize } from '../../src/features/memory/query/query.ts'
import type { TurnTool } from '../../src/core/llm/tool-turn.ts'

interface Where {
  room: string
  persona: string
  user: string
}
interface Fact {
  id: string
  text: string
  changed: number
}
export interface RoomMemory {
  recall(where: Where, query: string, limit: number): Fact[]
  tools(where: Where): TurnTool[]
}
export function roomMemory(file: () => string, enabled: () => boolean) {
  let db: DatabaseSync | undefined,
    closed = false
  function store() {
    if (closed || !enabled()) throw Error('记忆模块已关闭')
    if (!db) {
      db = new DatabaseSync(file())
      db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS facts(room TEXT NOT NULL, persona TEXT NOT NULL, user TEXT NOT NULL,
          id TEXT NOT NULL, text TEXT NOT NULL, changed INTEGER NOT NULL, PRIMARY KEY(room,persona,user,id)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS recent_facts ON facts(room,persona,user,changed DESC);`)
    }
    return db
  }
  function recall(w: Where, query: string, limit: number) {
    if (closed || !enabled() || limit <= 0) return []
    const facts = store()
      .prepare(
        'SELECT id,text,changed FROM facts WHERE room=? AND persona=? AND user=? ORDER BY changed DESC LIMIT 250',
      )
      .all(w.room, w.persona, w.user) as unknown as Fact[]
    const words = new Set(tokenize(query))
    const scores = facts.map((fact) => {
      const tokens = new Set(tokenize(fact.text))
      const overlap = [...words].filter((t) => tokens.has(t)).length
      return { fact, score: overlap / Math.sqrt(Math.max(1, tokens.size * words.size)) }
    })
    return scores
      .sort((a, b) => b.score - a.score || b.fact.changed - a.fact.changed)
      .slice(0, Math.min(16, limit))
      .map((x) => x.fact)
  }
  function tools(w: Where): TurnTool[] {
    if (closed || !enabled()) return []
    return [
      {
        name: 'memory_remember',
        description: '在当前人物和聊天中记住用户明确表达的长期事实或偏好。不要存密码、猜测和临时请求。',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        execute({ text }) {
          const value = typeof text === 'string' ? text.trim() : ''
          if (!value || [...value].length > 360) throw Error('记忆须为 1 到 360 字')
          const id = createHash('sha256').update(value).digest('hex').slice(0, 24)
          const db = store()
          db.prepare(
            'INSERT INTO facts VALUES (?,?,?,?,?,?) ON CONFLICT(room,persona,user,id) DO UPDATE SET changed=excluded.changed',
          ).run(w.room, w.persona, w.user, id, value, Date.now())
          db.prepare(
            'DELETE FROM facts WHERE room=? AND persona=? AND user=? AND id IN (SELECT id FROM facts WHERE room=? AND persona=? AND user=? ORDER BY changed DESC LIMIT -1 OFFSET 250)',
          ).run(w.room, w.persona, w.user, w.room, w.persona, w.user)
          return { ok: true, id }
        },
      },
      {
        name: 'memory_recall',
        description: '按关键词回忆当前用户在本聊天与这个人格留下的事实。',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        execute: ({ query }) => ({ facts: recall(w, String(query || ''), 8) }),
      },
      {
        name: 'memory_forget',
        description: '用户要求遗忘时，删除本聊天中属于该用户的一条长期记忆。',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: ({ id }) => ({
          removed:
            store()
              .prepare('DELETE FROM facts WHERE room=? AND persona=? AND user=? AND id=?')
              .run(w.room, w.persona, w.user, String(id)).changes === 1,
        }),
      },
    ]
  }
  return {
    recall,
    tools,
    close() {
      closed = true
      db?.close()
      db = undefined
    },
  }
}
