import { readJson, writeJson } from '../../../../../src/core/store/index.ts'
import type { Element } from '../../../../../src/types/core/element.ts'

export interface RecentItem {
  at: number
  userId: string
  sticker: boolean
  element: Element
  messageId?: string
  imageIndex?: number
}
interface Options { file?: string; log?: { warn(message: string, reason: string): void } }

const TTL = 30 * 60_000
const LIMIT = 6

export function createRecentMedia({ file, log }: Options = {}) {
  const chats = new Map<string, RecentItem[]>()
  let disposed = false

  function valid(item: RecentItem, now: number) {
    return item && Number.isFinite(item.at) && item.at > 0 && item.at <= now && now - item.at < TTL
      && typeof item.userId === 'string' && item.userId.length > 0 && typeof item.sticker === 'boolean'
      && item.element?.type === 'image' && item.element.attrs && typeof item.element.attrs === 'object' && !Array.isArray(item.element.attrs)
  }

  function save() {
    if (!file) return
    try { writeJson(file, Object.fromEntries(chats)) }
    catch (error) { log?.warn('最近图片 / 表情暂存写入失败（本次仍可使用）：', error.message) }
  }

  function prune(now: number) {
    let changed = false
    for (const [chatId, items] of chats) {
      const fresh = items.filter((item) => valid(item, now)).slice(-LIMIT)
      if (fresh.length !== items.length) changed = true
      if (fresh.length) chats.set(chatId, fresh)
      else { chats.delete(chatId); changed = true }
    }
    return changed
  }

  const raw = file ? readJson(file, () => ({})) : {}
  let invalid = false
  for (const [chatId, items] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})) {
    if (Array.isArray(items)) chats.set(chatId, items)
    else invalid = true
  }
  if (prune(Date.now()) || invalid) save()

  return {
    remember(chatId: string, items: Omit<RecentItem, 'at'>[]) {
      if (disposed || !items.length) return
      const now = Date.now()
      prune(now)
      const fresh = items.map((item) => ({ ...item, at: now })).filter((item) => valid(item, now))
      chats.set(String(chatId), [...(chats.get(String(chatId)) || []), ...fresh].slice(-LIMIT))
      save()
    },
    get(chatId: string, userId?: string) {
      if (disposed) return []
      if (prune(Date.now())) save()
      return (chats.get(String(chatId)) || []).filter((item) => !userId || item.userId === String(userId))
    },
    clear(chatId: string) {
      if (chats.delete(String(chatId))) save()
    },
    dispose() {
      disposed = true
      chats.clear()
    },
  }
}
