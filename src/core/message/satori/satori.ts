// Satori 序列化：内部元素树 ⇄ Satori 的 <message> 片段。
//
// 内部统一用 h 的元素树（type + attrs + children），Satori 只是「出站字符串」的一种编码；
// 接新平台时只做这一层转换，不改消息语义。

import { normalize, parse, type Element, type ElementSource } from '../element/element.ts'

/** 内部类型 → Satori 标签名 */
const TO_SATORI: Record<string, string> = {
  text: 'text',
  at: 'at',
  image: 'img',
  voice: 'audio',
  video: 'video',
  file: 'file',
  quote: 'quote',
  forward: 'message',
  br: 'br',
}

/** Satori 标签名 → 内部类型 */
const FROM_SATORI: Record<string, string> = {
  img: 'image',
  audio: 'voice',
}

/** 属性改名：内部叫 url，Satori 叫 src。 */
const ATTR_OUT: Record<string, string> = { url: 'src' }
const ATTR_IN: Record<string, string> = { src: 'url' }

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function render(element: Element): string {
  const type = TO_SATORI[element.type] || element.type
  if (element.type === 'text') return `<text>${escapeText(String(element.attrs.content ?? ''))}</text>`
  const attributes = element.type === 'forward' ? { ...element.attrs, forward: true } : element.attrs
  const attrs = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => value === true ? ' ' + (ATTR_OUT[key] || key) : ` ${ATTR_OUT[key] || key}="${escapeAttr(value)}"`)
    .join('')
  if (!element.children || !element.children.length) return `<${type}${attrs}/>`
  return `<${type}${attrs}>${element.children.map(render).join('')}</${type}>`
}

/** 元素树 → Satori 消息正文（不带外壳）。发消息时 `content` 要的就是这一段。 */
export function toSatoriBody(source: ElementSource): string {
  return normalize(source).map(render).join('')
}

/** 元素树 → Satori 片段（带 <message> 外壳，事件里那种整段消息）。 */
export function toSatori(source: ElementSource): string {
  return `<message>${toSatoriBody(source)}</message>`
}

export function fromSatori(xml: string): Element[] {
  const roots = parse(String(xml ?? ''))
  // 外层 <message> 是协议外壳，不是内容；里面的 <message forward> 才当转发处理
  const body = roots.length === 1 && roots[0].type === 'message' && !Object.keys(roots[0].attrs).length ? roots[0].children || [] : roots
  return normalize(body.map(convert))
}

function convert(element: Element): Element {
  const forward = element.type === 'message' && (element.attrs.forward === true || element.attrs.forward === 'true')
  const type = forward ? 'forward' : FROM_SATORI[element.type] || element.type
  const attrs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(element.attrs)) attrs[ATTR_IN[key] || key] = value
  if (forward) delete attrs.forward
  return element.children?.length ? { type, attrs, children: element.children.map(convert) } : { type, attrs }
}
