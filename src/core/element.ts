// 消息元素模型：入站出站都走同一棵树，平台差异留给适配器。
//
//   h('text', { content: '你好' })      ← 默认写法
//   h('at', { id: '123' })
//   h.parse('<at id="123"/> 你好')      ← 解析，坏标签只丢它自己
//   h.select(tree, 'image')             ← 按类型挑
//   h.stringify(tree)                   ← 回字符串
//
// 不认识的类型照样能构造，能不能发出去由适配器能力表决定。

import type { Element, ElementFactory, ElementSource, OneBotSegment, Selector } from '../types/element.ts'

export type { Element, ElementFactory, ElementSource, OneBotSegment, Selector } from '../types/element.ts'

const VOID_TYPES = new Set(['at', 'image', 'voice', 'video', 'file', 'face', 'quote', 'forward', 'reply', 'br'])

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
    isElement,
    fromOneBot,
    toOneBot,
  },
) as unknown as ElementFactory

export function isElement(value: unknown): value is Element {
  return !!value && typeof value === 'object' && typeof (value as Element).type === 'string'
}

// ── 解析 ────────────────────────────────────────────────────────────

const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)>/g
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g

function parseAttrs(source: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(source))) attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

/**
 * 把消息文本解析成元素树。
 * 容错规则：不认识的标签整体丢掉、没闭合的标签丢掉标签本身但保留里面的文字，
 * 标签之外的文字一律保留 —— 模型吐出半截 `<ACP>` 时不能把正常回复也吞了。
 */
export function parse(source: string): Element[] {
  const input = String(source ?? '')
  const root: Element[] = []
  const stack: Array<{ type: string; attrs: Record<string, unknown>; children: Element[] }> = []
  let cursor = 0

  const push = (element: Element) => {
    if (stack.length) stack[stack.length - 1].children.push(element)
    else root.push(element)
  }
  const flushText = (upTo: number) => {
    if (upTo <= cursor) return
    const chunk = input.slice(cursor, upTo)
    if (chunk) push(text(chunk))
  }

  TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG_RE.exec(input))) {
    const [whole, closing, name, rawAttrs, selfClose] = match
    const type = name.toLowerCase()
    flushText(match.index)
    cursor = match.index + whole.length

    if (closing) {
      // 闭合标签：只在栈里找最近的同名节点；找不到就当没出现（丢弃）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === type) {
          const node = stack[i]
          // 中间还有没闭合的标签：把它们的正文摊回这一层（丢标签、留文字），
          // 否则 <b>粗</text> 这种错配会把「粗」整段吞掉
          for (let j = stack.length - 1; j > i; j--) {
            for (const child of normalize(stack[j].children)) node.children.push(child)
            stack[j].children.length = 0
          }
          stack.length = i
          const kids = normalize(node.children)
          // <text>正文</text> 的正文要并进 content，否则会被当成空文本丢掉
          const element = type === 'text'
            ? text(kids.filter((k) => k.type === 'text').map((k) => String(k.attrs.content ?? '')).join(''))
            : create(node.type, node.attrs, kids)
          push(element)
          break
        }
      }
      continue
    }

    const attrs = parseAttrs(rawAttrs)
    if (type === 'text' && typeof attrs.content === 'string') {
      push(text(attrs.content))
      continue
    }
    if (selfClose || VOID_TYPES.has(type)) {
      push(create(type, attrs))
      continue
    }
    stack.push({ type, attrs, children: [] })
  }

  flushText(input.length)
  // 没闭合的标签：把里面的内容按原顺序吐出来
  while (stack.length) {
    const node = stack.pop()!
    for (const child of normalize(node.children)) push(child)
  }
  return normalize(root)
}

// ── 序列化 ──────────────────────────────────────────────────────────

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

// ── OneBot v11 消息段互转 ───────────────────────────────────────────

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
  forward: 'forward',
}

export function fromOneBot(segments: unknown): Element[] {
  if (!Array.isArray(segments)) return segments == null ? [] : normalize(String(segments))
  const out: Element[] = []
  for (const segment of segments) {
    if (typeof segment === 'string') {
      out.push(text(segment))
      continue
    }
    if (!segment || typeof segment !== 'object') continue
    const raw = segment as { type?: string; data?: Record<string, unknown> }
    const type = ONEBOT_TO_TYPE[String(raw.type)] || String(raw.type || 'text')
    const data = { ...(raw.data || {}) }
    if (type === 'text') {
      out.push(text(String(data.text ?? '')))
      continue
    }
    if (type === 'image' || type === 'voice' || type === 'video' || type === 'file') {
      const url = String(data.url ?? data.file ?? '')
      const attrs: Record<string, unknown> = { url }
      if (data.file && data.url) attrs.file = data.file
      if (data.name) attrs.name = data.name
      out.push(create(type, attrs))
      continue
    }
    if (type === 'at') {
      out.push(create('at', { id: String(data.qq ?? ''), ...(data.name ? { name: data.name } : {}) }))
      continue
    }
    out.push(create(type, data))
  }
  return normalize(out)
}

export function toOneBot(source: ElementSource): OneBotSegment[] {
  return normalize(source).map((element) => {
    const type = TYPE_TO_ONEBOT[element.type] || element.type
    if (element.type === 'text') return { type: 'text', data: { text: String(element.attrs.content ?? '') } }
    if (element.type === 'at') return { type: 'at', data: { qq: String(element.attrs.id ?? '') } }
    if (element.type === 'image' || element.type === 'voice' || element.type === 'video' || element.type === 'file') {
      return { type, data: { file: String(element.attrs.url ?? element.attrs.file ?? '') } }
    }
    if (element.type === 'quote') return { type: 'reply', data: { id: String(element.attrs.id ?? '') } }
    return { type, data: { ...element.attrs } }
  })
}
