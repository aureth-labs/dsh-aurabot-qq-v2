import { parse } from './parse.ts'
export { parse } from './parse.ts'
import type { Element, ElementFactory, ElementSource, Selector } from '../../../types/core/element.ts'
import type { Capability } from '../../../types/adapter/bot.ts'

export type { Element, ElementFactory, ElementSource, Selector } from '../../../types/core/element.ts'

function create(type: string, attrs: Record<string, unknown> = {}, children?: Element[]): Element {
  const element: Element = { type, attrs: { ...attrs } }
  if (children && children.length) element.children = children
  return element
}

function text(content: string): Element {
  return create('text', { content: String(content ?? '') })
}

/** h 本体：既能当函数用，也带一批快捷构造。 */
export const h: ElementFactory = Object.assign(
  (type: string, attrs?: Record<string, unknown>, children?: Element[]) => create(type, attrs, children),
  {
    text,
    at: (id: string | number, name?: string) => create('at', name ? { id: String(id), name } : { id: String(id) }),
    image: (url: string, extra: Record<string, unknown> = {}) => create('image', { url, ...extra }),
    voice: (url: string, extra: Record<string, unknown> = {}) => create('voice', { url, ...extra }),
    video: (url: string, extra: Record<string, unknown> = {}) => create('video', { url, ...extra }),
    file: (url: string, name?: string) => create('file', name ? { url, name } : { url }),
    face: (id: string | number) => create('face', { id: String(id) }),
    quote: (id: string | number) => create('quote', { id: String(id) }),
    forward: (idOrChildren: string | number | Element[]) =>
      Array.isArray(idOrChildren) ? create('forward', {}, idOrChildren) : create('forward', { id: String(idOrChildren) }),
    parse,
    stringify,
    select,
    normalize,
    degrade,
    isElement,
  },
) as unknown as ElementFactory

export function isElement(value: unknown): value is Element {
  return !!value && typeof value === 'object' && typeof (value as Element).type === 'string'
    && !!(value as Element).attrs && typeof (value as Element).attrs === 'object'
}

function escapeAttr(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function stringify(elements: ElementSource): string {
  return normalize(elements).map(render).join('')
}

function render(element: Element): string {
  if (element.type === 'text') return escapeText(String(element.attrs.content ?? ''))
  const attrs = Object.entries(element.attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('')
  if (!element.children || !element.children.length) return `<${element.type}${attrs}/>`
  return `<${element.type}${attrs}>${element.children.map(render).join('')}</${element.type}>`
}

// ── 规范化与选择 ────────────────────────────────────────────────────

/** 统一成数组，并把相邻文本合并、空文本丢掉。 */
export function normalize(source: ElementSource): Element[] {
  const list: Element[] = []
  const push = (element: Element) => {
    const last = list[list.length - 1]
    if (element.type === 'text') {
      const content = String(element.attrs.content ?? '')
      if (!content) return
      if (last && last.type === 'text') {
        last.attrs.content = String(last.attrs.content ?? '') + content
        return
      }
      list.push(create('text', { content }))
      return
    }
    list.push(element.children ? create(element.type, element.attrs, normalize(element.children)) : element)
  }

  if (source === null || source === undefined) return list
  if (typeof source === 'string') return parse(source)
  if (Array.isArray(source)) {
    for (const item of source) if (item) push(item)
    return list
  }
  push(source)
  return list
}

/** 按类型名或断言挑元素，递归进子节点。 */
export function select(source: ElementSource, selector: Selector): Element[] {
  const test = typeof selector === 'string' ? (element: Element) => element.type === selector : selector
  const out: Element[] = []
  const walk = (list: Element[]) => {
    for (const element of list) {
      if (test(element)) out.push(element)
      if (element.children) walk(element.children)
    }
  }
  walk(normalize(source))
  return out
}

/** 纯文本（把所有 text 节点拼起来）。 */
export function toText(source: ElementSource): string {
  return select(source, 'text').map((element) => String(element.attrs.content ?? '')).join('')
}

// ── 按平台能力降级 ──────────────────────────────────────────────────

/** 需要平台支持的媒体类型 → 能力名。text / at / face 不用查表，永远能降级成文字。 */
const MEDIA_CAPABILITY: Record<string, Capability> = {
  image: 'image',
  voice: 'voice',
  video: 'video',
  file: 'file',
  forward: 'forward',
  quote: 'quote',
}

const PLACEHOLDER: Record<string, (element: Element) => string> = {
  image: () => '[图片]',
  voice: () => '[语音]',
  video: () => '[视频]',
  file: (element) => '[文件] ' + String(element.attrs.name || element.attrs.url || ''),
  forward: () => '[合并转发]',
}

/**
 * 按平台能力把发不出去的元素换成文字占位符。
 *
 * 平台不支持某类消息是常态（纯文本聊天室没有图片、没有文件）。这时候不能整条不发，
 * 也不能把 `<file url="..."/>` 原样当字符串发给用户——降级成一句人话，正文照常发。
 * 引用（quote）例外：不支持就直接不引用，塞个占位符纯属噪音。
 */
export function degrade(source: ElementSource, supports: (capability: Capability) => boolean): Element[] {
  const out: Element[] = []
  for (const element of normalize(source)) {
    const needed = MEDIA_CAPABILITY[element.type]
    if (needed && !supports(needed)) {
      if (element.type === 'quote') continue
      const placeholder = PLACEHOLDER[element.type]
      out.push(text(placeholder ? placeholder(element) : '[' + element.type + ']'))
      continue
    }
    // `@` 与表情是「平台原生有就发原生的」：能发 @ 就别降成纯文本，否则 @ 会变成一句没人看得懂的字
    if (element.type === 'at' && !supports('at')) {
      out.push(text('@' + String(element.attrs.name || element.attrs.id || '')))
      continue
    }
    if (element.type === 'face' && !supports('face')) {
      out.push(text('[表情]'))
      continue
    }
    out.push(element.children ? create(element.type, element.attrs, degrade(element.children, supports)) : element)
  }
  return normalize(out)
}
