import type { Element, Ctx } from '../../sdk/aurabot.d.ts'

const fold = (text: string) => text.normalize('NFKC').toLowerCase()
const metadata = ['alt', 'title', 'name', 'filename', 'href', 'url', 'src']

function searchable(elements: Element[]) {
  const text: string[] = [], fields: string[] = []
  const visit = (el: Element) => {
    if (el.type === 'text') text.push(String(el.attrs.content || ''))
    if (el.type === 'br') text.push('\n')
    for (const key of metadata) {
      const value = el.attrs[key]
      if (typeof value === 'string' && !/^(?:data:|base64:\/\/)/i.test(value)) fields.push(value)
    }
    el.children?.forEach(visit)
  }
  elements.forEach(visit)
  return [text.join(''), ...fields].map(fold)
}

export function apply(ctx: Ctx) {
  ctx.on('before-send', ({ elements, platform, botId }) => {
    const rules = (ctx.config.keywords as string[]).map(word => fold(word.trim()))
    if (!rules.some(Boolean)) return
    const content = searchable(elements)
    const found = rules.findIndex(word => word && content.some(field => field.includes(word)))
    if (found < 0) return
    ctx.logger.warn(`出站关键词规则 ${found + 1} 已拦截消息（${platform} / ${botId}）`)
    return true
  })
}
