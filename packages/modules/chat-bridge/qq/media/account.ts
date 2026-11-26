import { dataDir } from '../../../../../src/core/store/index.ts'
import { createRecentMedia } from './recent.ts'
import type { OutSegment } from '../context/context.ts'
import { createStickerStash } from '../format/sticker.ts'

interface Log { warn(message: string, reason: string): void }

export interface CachedQuote {
  deleted?: boolean
  ok?: boolean
  chatId?: string
  uid?: string
  time?: number
  at?: number
  images?: OutSegment[]
  stickers?: OutSegment[]
}

function openMedia(selfId: string, log: Log) {
  const path = (name: string) => /^\d+$/.test(selfId) ? dataDir('primary-media', selfId, name) : undefined
  const lifetime = new AbortController()
  const images = createRecentMedia({ file: path('recent-media.json'), log })
  const stickers = createStickerStash(path('sticker-stash.json'))
  const files = new Map<string, Record<string, unknown>[]>()
  const quotes = new Map<string, CachedQuote>()
  return {
    selfId, images, stickers, files, quotes, signal: lifetime.signal,
    clear(chatId: string) {
      images.clear(chatId)
      stickers.clear(chatId)
      files.delete(chatId)
      for (const key of quotes.keys()) if (key.startsWith(chatId + '|')) quotes.delete(key)
    },
    dispose() {
      lifetime.abort()
      images.dispose()
      stickers.dispose()
      files.clear()
      quotes.clear()
    },
  }
}

export type AccountMedia = ReturnType<typeof openMedia>

export function createMediaScope(account: () => string | null, log: Log) {
  let media: AccountMedia | undefined
  let active = true
  function reset() {
    media?.dispose()
    media = undefined
  }
  return {
    current() {
      const id = active ? account() : null
      if (media && media.selfId !== id) reset()
      if (id === null) return undefined
      return media ??= openMedia(id, log)
    },
    reset,
    dispose() { active = false; reset() },
  }
}
