import type { Element } from '../../../types/core/element.ts'
import { fetchImage } from '../../net/index.ts'

export interface StickerSource {
  selfId: string
  active(): boolean
  read(el: Element, maxBytes: number): Promise<Buffer>
  add(path: string): Promise<string>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
  list(limit: number): Promise<string[]>
  attributes?(item: Record<string, unknown>): Record<string, unknown>
}

export function stickerService(platform: string, botId: string) {
  return 'sticker-source/' + JSON.stringify([platform, botId])
}

export function readSticker(el: Element, maxBytes: number, source?: StickerSource) {
  if (source) return source.read(el, maxBytes)
  const url = String(el.attrs.url || el.attrs.src || '').replace(/^data:image\/[\w.+-]+;base64,/i, 'base64://')
  return fetchImage(url, { maxBytes, allowLocal: false, timeoutMs: 5000 })
}
