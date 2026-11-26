// 最近图片 / 表情的短期引用：按聊天保留 6 张，重启恢复时不重置 30 分钟有效期。
import { readJson, writeJson } from '../../../../../src/core/store/index.ts'
import type { OutSegment } from '../context/context.ts'

export interface RecentItem {
  at: number
  userId: string
  sticker: boolean
  seg: OutSegment
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
      && ['image', 'mface'].includes(item.seg?.type) && item.seg.data && typeof item.seg.data === 'object' && !Array.isArray(item.seg.data)
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

  // 缺失或损坏的文件当作空缓存，不影响聊天；收到新图片时会重建。
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
