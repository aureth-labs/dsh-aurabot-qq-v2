import type { PluginContext } from '../../../../../src/types/plugin/ctx.ts'
import { createQQOfficialBotSpec, type QQOfficialBotSpecOptions } from './index.ts'

declare const Schema: typeof import('../../../../../src/core/config/shape/schema.ts').Schema

export const name = 'QQ 官方机器人'
export const config = Schema.object({
  appId: Schema.string().description('机器人 AppID'),
  clientSecret: Schema.string().role('secret').description('机器人 AppSecret'),
})

export async function apply(ctx: PluginContext, config: QQOfficialBotSpecOptions) {
  if (config.appId && config.clientSecret) await ctx.adapter(createQQOfficialBotSpec(), config)
}
