export interface OneBotSegment {
  type: string
  data: Record<string, unknown>
}
const text = (content: string): OneBotSegment => ({ type: 'text', data: { text: content } })
const escapes: Record<string, string> = { '&amp;': '&', '&#91;': '[', '&#93;': ']', '&#44;': ',' }
const decode = (value: string, attribute = false) =>
  value.replace(attribute ? /&(?:amp|#91|#93|#44);/g : /&(?:amp|#91|#93);/g, entity => escapes[entity])

export function oneBotSegments(input: unknown): OneBotSegment[] {
  if (Array.isArray(input)) return input.flatMap((segment): OneBotSegment[] => {
    if (typeof segment === 'string') return [text(segment)]
    if (!segment || typeof segment.type !== 'string') return []
    return [{ type: segment.type, data: segment.data && typeof segment.data === 'object' ? segment.data : {} }]
  })
  if (typeof input !== 'string') return []
  const segments: OneBotSegment[] = []
  let offset = 0
  for (const match of input.matchAll(/\[CQ:([\w-]+)((?:,[^,=\[\]]+=[^,\[\]]*)*)\]/g)) {
    if (match.index > offset) segments.push(text(decode(input.slice(offset,match.index))))
    const fields: [string,string][] = []
    for (const attr of match[2].slice(1).split(',').filter(Boolean)) {
      const eq = attr.indexOf('=')
      fields.push([attr.slice(0,eq),decode(attr.slice(eq+1),true)])
    }
    segments.push({ type: match[1], data: Object.fromEntries(fields) })
    offset = match.index + match[0].length
  }
  if (offset < input.length) segments.push(text(decode(input.slice(offset))))
  return segments
}
