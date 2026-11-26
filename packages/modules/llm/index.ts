import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { createLlmFacade } from '../../../src/core/llm/facade.ts'
import { askModel } from '../../../src/core/llm/index.ts'

export const name = '模型服务'
export const description = '通过 DeepSeek Harness 提供生成、润色、改写和摘要'

export function apply(ctx: PluginContext) {
  ctx.provide('llm', createLlmFacade({
    ask: options => askModel(ctx.harness, { cfg: ctx.root.config, ...options }),
    log: ctx.logger,
  }))
}
