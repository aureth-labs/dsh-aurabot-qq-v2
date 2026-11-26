import type { PluginContext } from '../../../../src/types/plugin/ctx.ts'
import { satoriAdapter, type SatoriAdapterConfig } from './index.ts'

declare const Schema: typeof import('../../../../src/core/config/shape/schema.ts').Schema

export const name = 'Satori 协议'
export const config = Schema.object({
  endpoint: Schema.string().description('Satori 服务地址'),
  token: Schema.string().role('secret').description('访问令牌'),
  platform: Schema.string().description('服务端登录的平台名，如 discord'),
  selfId: Schema.string().description('机器人账号 ID，同平台有多个登录时填写'),
})

export async function apply(ctx: PluginContext, config: SatoriAdapterConfig) {
  if (config.endpoint && config.platform) await ctx.adapter(satoriAdapter(), config)
}
