/**
 * 元素树 → QQ 平台能吃的纯文本。
 *
 * QQ 频道和官方机器人都只收文本（图片要先上传换 media id，另走上传接口），
 * 所以这里按能力表降级：发不出去的元素变成 `[图片]` 这类占位符，正文照发。
 */

import { degrade, normalize, type Element } from '../../../../../../src/core/message/element/element.ts'
import type { Capability } from '../../../../../../src/types/adapter/bot.ts'

export interface RenderQQTextOptions {
  supports: (capability: Capability) => boolean
  /** `@` 的写法：频道是 `<@!id>`，官方机器人不支持 @。 */
  at?: (id: string) => string
}

export function renderQQText(content: unknown, options: RenderQQTextOptions): string {
  if (typeof content === 'string' && !content.includes('<')) return content
  const elements = degrade(normalize(content as never), options.supports)
  return join(elements, options)
}

function join(elements: Element[], options: RenderQQTextOptions): string {
  let out = ''
  for (const element of elements) {
    if (element.type === 'text') {
      out += String(element.attrs.content ?? '')
      continue
    }
    if (element.type === 'at') {
      const id = String(element.attrs.id ?? '')
      out += options.at ? options.at(id) : `@${String(element.attrs.name || id)}`
      continue
    }
    out += `[${element.type}]`
  }
  return out
}
