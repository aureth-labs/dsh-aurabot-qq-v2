import { h, normalize, type Element, type ElementSource } from '../../../../../src/core/message/element/element.ts'

import { oneBotSegments, type OneBotSegment } from './cq.ts'
export type { OneBotSegment } from './cq.ts'

const ONEBOT_TO_TYPE: Record<string, string> = {
  text: 'text',
  at: 'at',
  image: 'image',
  record: 'voice',
  video: 'video',
  file: 'file',
  face: 'face',
  reply: 'quote',
  forward: 'forward',
  node: 'forward',
}

const TYPE_TO_ONEBOT: Record<string, string> = {
  text: 'text',
  at: 'at',
  image: 'image',
  voice: 'record',
  video: 'video',
  file: 'file',
  face: 'face',
  quote: 'reply',
  poke: 'poke',
  forward: 'forward',
}

export function fromOneBot(segments: unknown): Element[] {
  const out: Element[] = []
  for (const raw of oneBotSegments(segments)) {
    const type = ONEBOT_TO_TYPE[String(raw.type)] || String(raw.type || 'text')
    const data = { ...(raw.data || {}) }
    if (type === 'text') {
      out.push(h.text(String(data.text ?? '')))
      continue
    }
    if (type === 'image' || type === 'voice' || type === 'video' || type === 'file') {
      const url = String(data.url ?? data.file ?? '')
      const attrs: Record<string, unknown> = { url }
      if (data.file && data.url) attrs.file = data.file
      if (data.name) attrs.name = data.name
      out.push(h(type, attrs))
      continue
    }
    if (type === 'at') {
      out.push(h('at', { id: String(data.qq ?? ''), ...(data.name ? { name: data.name } : {}) }))
      continue
    }
    out.push(h(type, data))
  }
  return normalize(out)
}

export function toOneBot(source: ElementSource): OneBotSegment[] {
  return normalize(source).flatMap<OneBotSegment>((element) => {
    if (element.type === 'br') return [{ type: 'text', data: { text: '\n' } }]
    const type = TYPE_TO_ONEBOT[element.type]
    if (!type) return element.children ? toOneBot(element.children) : []
    if (type === 'forward' && !element.attrs.id && element.children) return toOneBot(element.children).map(segment =>
      segment.type === 'poke' ? { type: 'text', data: { text: '[戳一戳]' } } : segment)
    if (element.type === 'text') return { type: 'text', data: { text: String(element.attrs.content ?? '') } }
    if (element.type === 'at') return { type: 'at', data: { qq: String(element.attrs.id ?? '') } }
    if (element.type === 'image' || element.type === 'voice' || element.type === 'video' || element.type === 'file') {
      return { type, data: { file: String(element.attrs.url ?? element.attrs.file ?? '') } }
    }
    if (element.type === 'quote') return { type: 'reply', data: { id: String(element.attrs.id ?? '') } }
    return { type, data: { ...element.attrs } }
  })
}
