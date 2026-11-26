// ctx.llm 的实现：润色 / 改写 / 摘要。
//
// 走的是「不进聊天会话」的后台调用（和更新短期状态同一条路），
// 不占聊天上下文、不计入她的人格记忆——插件拿它当工具用就行。
//
// 失败一律退回原文：这类调用处在消息发送路径上，
// 「润色失败就整条发不出去」比「照原文发出去」糟糕得多。

import type { LlmFacade, LlmSummaryOptions, LlmTextOptions } from '../../types/plugin/ctx.ts'

/** 后台问一次模型的函数（host 用 askModel 包出来）。 */
export type AskText = (options: {
  text: string
  sessionId?: string
  system?: string
  maxTokens?: number
  temperature?: number
  model?: { provider: string; model: string }
}) => Promise<string>

export interface LlmFacadeDeps {
  config: LlmFacade['config']
  ask: AskText
  log?: { warn: (...args: any[]) => void }
}

const POLISH_SYSTEM = [
  '你是文字校对。只改错别字、病句、标点和语序，不改原意，不加内容，不解释。',
  '保留原文的语气和人称。直接输出改好的文本，不要加引号、不要加说明。',
].join('\n')

const REWRITE_SYSTEM = [
  '你是改写助手。按用户给的要求换一种说法，意思不变。',
  '直接输出改写后的文本，不要加引号、不要解释改了什么。',
].join('\n')

const SUMMARY_SYSTEM = [
  '你是摘要助手。只保留事实和结论，去掉寒暄、重复和语气词。',
  '按用户给的字数上限压缩，直接输出摘要正文，不要前缀。',
].join('\n')

/** 字数按「看得见的字符」算：代理对（emoji）算一个。 */
function charLength(text: string): number {
  return [...text].length
}

function truncate(text: string, maxLength: number): string {
  const chars = [...text]
  if (chars.length <= maxLength) return text
  return chars.slice(0, maxLength).join('')
}

export function createLlmFacade(deps: LlmFacadeDeps): LlmFacade {
  const { ask, log } = deps

  const run = async (system: string, text: string, options: LlmTextOptions & { maxTokens?: number }): Promise<string | null> => {
    const source = String(text ?? '').trim()
    if (!source) return ''
    const instruction = String(options.instruction ?? '').trim()
    try {
      const output = await ask({
        text: instruction ? `${instruction}\n\n---\n${source}` : source,
        system,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        model: options.model,
      })
      const result = String(output ?? '').trim()
      return result || null
    } catch (error) {
      log?.warn(`ctx.llm 调用失败，退回原文：${String((error as Error)?.message ?? error)}`)
      return null
    }
  }

  return {
    config: deps.config,
    generate: ask,
    async polish(text, options = {}) {
      const source = String(text ?? '')
      return (await run(POLISH_SYSTEM, source, options)) ?? source
    },

    async rewrite(text, options = {}) {
      const source = String(text ?? '')
      return (await run(REWRITE_SYSTEM, source, options)) ?? source
    },

    async summarize(text, options: LlmSummaryOptions = {}) {
      const source = String(text ?? '').trim()
      if (!source) return ''
      const maxLength = Math.max(1, Number(options.maxLength ?? 200))
      if (charLength(source) <= maxLength) return source
      const hint = `字数上限 ${maxLength} 字。`
      const output = await run(SUMMARY_SYSTEM, source, {
        ...options,
        instruction: options.instruction ? `${options.instruction} ${hint}` : hint,
        maxTokens: options.maxTokens ?? Math.min(1200, maxLength * 4),
      })
      // 模型偶尔会超字数，这里兜一刀，保证契约里的上限是真的
      return truncate(output ?? source, maxLength)
    },
  }
}
