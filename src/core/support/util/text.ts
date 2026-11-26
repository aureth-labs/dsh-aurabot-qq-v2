// 文字处理的小工具。

/** 去掉孤立的代理字符：按 UTF-16 截断会把 emoji 劈成两半，这种字符串发给模型会被整轮 400（#151）。 */
export function cleanText(text: unknown): string {
  const s = String(text ?? '')
  return s.isWellFormed() ? s : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

/** 按字符截断，不会切开 emoji。 */
export const clipText = (text: unknown, n: number): string => [...cleanText(text)].slice(0, n).join('')

/** 判断一段文本是不是「只有空白」（null / undefined 也算空白）。 */
export function isBlank(text: unknown): boolean {
  const value = cleanText(text)
  return value.length === 0 || value.trim().length === 0
}

/** 清理提示词内容块里的文字。 */
export const cleanContent = <T extends { type?: string; text?: string }>(content: T[]): T[] =>
  content.map((c) => (c?.type === 'text' ? { ...c, text: cleanText(c.text) } : c))
