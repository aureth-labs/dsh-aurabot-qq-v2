// `<voice>要念的话</voice>` 的出站处理。
//
// 模型只会写字，不会给音频文件；所以 voice 元素允许只带文字：
//   出站前由框架调 `ctx.tts` 合成音频，把文字换成文件地址，再交给适配器。
// 合成不出来就降级成一条普通文字（别整条消息发不出去），并记一条 warn。

import { isElement, normalize, toText, type Element, type ElementSource } from './element.ts'

/** 文字 → 音频地址（本地绝对路径或 URL）。 */
export type VoiceResolver = (text: string) => Promise<string>

const VOICE_TAG_RE = /<voice[\s>/]/i

/** 粗筛：一段文本里有没有可能需要合成的 voice 块。 */
export function hasVoiceText(source: string): boolean {
  return VOICE_TAG_RE.test(String(source ?? ''))
}

function voiceTextOf(element: Element): string {
  const children = String(toText(element.children ?? [])).trim()
  if (children) return children
  return String(element.attrs.content ?? element.attrs.text ?? '').trim()
}

/**
 * 把所有「只有文字、没有地址」的 voice 元素换成带地址的 voice。
 *
 * - 已经有 `url` / `file` 的原样不动（调用方自己给了音频）
 * - 合成失败 → 换成 text 元素，正文就是原来要念的字
 */
export async function resolveVoice(
  source: ElementSource,
  speak: VoiceResolver,
  log?: { warn: (...args: any[]) => void },
): Promise<Element[]> {
  const elements = normalize(source)
  const walk = async (list: Element[]): Promise<Element[]> => {
    const out: Element[] = []
    for (const element of list) {
      if (element.type !== 'voice') {
        out.push(element.children?.length ? { ...element, children: await walk(element.children) } : element)
        continue
      }
      if (element.attrs.url || element.attrs.file) {
        out.push(element)
        continue
      }
      const text = voiceTextOf(element)
      if (!text) {
        out.push(element)
        continue
      }
      try {
        const url = String((await speak(text)) ?? '').trim()
        if (!url) throw new Error('TTS 返回了空地址')
        out.push({ type: 'voice', attrs: { ...element.attrs, url } })
      } catch (error) {
        log?.warn(`语音没合成出来，这条改发文字：${String((error as Error)?.message ?? error)}`)
        out.push({ type: 'text', attrs: { content: text } })
      }
    }
    return out
  }
  return walk(elements)
}

/** 已经是元素树时用这个判断要不要走合成（省一次无意义的遍历）。 */
export function needsVoiceResolve(source: ElementSource): boolean {
  if (typeof source === 'string') return hasVoiceText(source)
  const list = Array.isArray(source) ? source : source ? [source] : []
  return list.some(function check(element): boolean {
    if (!isElement(element)) return false
    if (element.type === 'voice' && !element.attrs.url && !element.attrs.file) return true
    return (element.children ?? []).some(check)
  })
}
