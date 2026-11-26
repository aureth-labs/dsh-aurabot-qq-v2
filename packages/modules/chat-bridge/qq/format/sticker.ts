// 「她挑 / 只听主人的」：这一轮收到的表情按会话记着，她想收时凭编号来取。落盘一份，DSH 重启不丢。
import { readJson, writeJson } from '../../../../../src/core/store/index.ts'
import type { OutSegment } from '../context/context.ts'

const TTL = 30 * 60_000

export function createStickerStash(file?: string) {
  const stash = new Map<string, { at: number; segs: OutSegment[] }>()
  let disposed = false
  let loaded = false

  function load () {
    if (disposed || loaded || !file) return
    loaded = true
    try {
      const raw = readJson(file, () => ({}))
      const now = Date.now()
      for (const [chatId, v] of Object.entries(raw && typeof raw === 'object' ? raw as Record<string, any> : {})) {
        if (v && Array.isArray(v.segs) && v.segs.length && Number.isFinite(v.at) && v.at <= now && now - v.at < TTL) {
          stash.set(chatId, { at: Number(v.at) || now, segs: v.segs })
        }
      }
    } catch (error) {}
  }

  function save () {
    const now = Date.now()
    const out: Record<string, any> = {}
    for (const [chatId, v] of stash) if (v && now - v.at < TTL) out[chatId] = v
    if (!file || disposed) return
    try { writeJson(file, out) } catch (error) {}
  }

  return {
    /** 记下这一轮收到的表情，返回张数。 */
    remember (chatId: string, segs: unknown[]) {
      if (disposed) return 0
      load()
      const list = (segs || []).slice(0, 4)
      if (!list.length) return 0
      stash.set(chatId, { at: Date.now(), segs: list as OutSegment[] })
      save()
      return list.length
    },
    /** 取第 index 张（从 1 开始）。过期或没有就返回 null。 */
    of (chatId: string, index: unknown) {
      load()
      const s = stash.get(chatId)
      if (!s || Date.now() - s.at > TTL) return null
      const i = Number(index) - 1
      return Number.isInteger(i) && i >= 0 && i < s.segs.length ? s.segs[i] : null
    },
    clear(chatId: string) { load(); if (stash.delete(chatId)) save() },
    dispose() { disposed = true; stash.clear() },
  }
}

export function stickerHint(n: number) {
  const range = n > 1 ? `1~${n}` : '1'
  return `（这轮里夹着 ${n} 张表情，是你自己看到的。有中意的就用 qq_collect_sticker ${range} 收进自己库；收表情是你自己的小爱好，不用每张都跟对方说，偶尔提一句也行。）`
}
