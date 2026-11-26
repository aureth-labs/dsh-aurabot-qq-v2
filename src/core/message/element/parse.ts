import type { Element } from '../../../types/core/element.ts'

const supported = new Set(['text', 'at', 'image', 'img', 'voice', 'audio', 'video', 'file', 'face', 'poke', 'quote', 'reply', 'forward', 'message', 'author', 'br',
  'translatevoice', 'sharp', 'emoji', 'a', 'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'del', 'spl', 'code', 'sup', 'sub', 'p', 'button'])
const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

function decode(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (original, name: string) => {
    if (!name.startsWith('#')) return entities[name] ?? original
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original
  })
}

type Frame = { type: string; attrs: Record<string, unknown>; children: Element[] }

function finish({ type, attrs, children }: Frame): Element {
  if (['img', 'audio', 'video', 'file'].includes(type) && attrs.src !== undefined) {
    attrs.url = attrs.src
    delete attrs.src
  }
  if (type === 'translatevoice') type = 'translateVoice'
  if (type === 'img') type = 'image'
  if (type === 'audio') type = 'voice'
  if (type === 'text') return { type, attrs: { content: String(attrs.content ?? children.map(child => child.attrs.content ?? '').join('')) } }
  if (type === 'file' && !attrs.url && !attrs.src && children.every(child => child.type === 'text')) {
    const url = children.map(child => child.attrs.content).join('').trim()
    if (url) return { type, attrs: { ...attrs, url } }
  }
  return children.length ? { type, attrs, children } : { type, attrs }
}

export function parse(source: string): Element[] {
  const input = String(source ?? '')
  const root: Element[] = []
  const stack: Frame[] = []
  const opening = /<!--|<(\/?)([a-z][\w:-]*)/gi
  const end = /(?:[^'"<>]|"[^"]*"|'[^']*')*>/y
  const attribute = /\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/gy
  let ignored: { type: string; depth: number } | undefined
  let cursor = 0

  const append = (element: Element) => {
    const children = stack.at(-1)?.children ?? root
    if (element.type === 'text') {
      if (!element.attrs.content) return
      const previous = children.at(-1)
      if (previous?.type === 'text') {
        previous.attrs.content += element.attrs.content
        return
      }
    }
    children.push(element)
  }

  for (const match of input.matchAll(opening)) {
    if (match.index < cursor) continue
    if (!ignored) append({ type: 'text', attrs: { content: decode(input.slice(cursor, match.index)) } })
    if (match[0] === '<!--') {
      const close = input.indexOf('-->', match.index + 4)
      if (close < 0) return root
      cursor = close + 3
      continue
    }
    end.lastIndex = match.index + match[0].length
    const tail = end.exec(input)
    if (!tail) return root
    cursor = end.lastIndex
    const type = match[2].toLowerCase()
    const closing = Boolean(match[1])
    const body = tail[0].slice(0, -1).trimEnd()
    const empty = body.endsWith('/')
    if (ignored) {
      if (ignored.type === type && closing && !body && --ignored.depth === 0) ignored = undefined
      else if (ignored.type === type && !closing && !empty) ignored.depth++
      continue
    }
    if (closing) {
      if (body) continue
      const index = stack.findLastIndex(frame => frame.type === type)
      if (index >= 0) {
        const frame = stack[index]
        stack.length = index
        append(finish(frame))
      }
      continue
    }

    const sourceAttrs = (empty ? body.slice(0, -1) : body).trimEnd()
    const attrs: Record<string, unknown> = Object.create(null)
    let offset = 0
    attribute.lastIndex = 0
    for (let field; (field = attribute.exec(sourceAttrs));) {
      attrs[field[1]] = field[2] === undefined && field[3] === undefined && field[4] === undefined
        ? true : decode(field[2] ?? field[3] ?? field[4])
      offset = attribute.lastIndex
    }
    if (!supported.has(type) || offset !== sourceAttrs.length) {
      if (!empty) ignored = { type, depth: 1 }
      continue
    }
    const frame = { type, attrs: { ...attrs }, children: [] }
    if (empty || type === 'br') append(finish(frame))
    else stack.push(frame)
  }

  if (!ignored) append({ type: 'text', attrs: { content: decode(input.slice(cursor)) } })
  return root
}
