import { fileURLToPath } from 'node:url'
import * as adapter from '../adapters/qq/onebot-v11/src/plugin.ts'
import type { createOneBotConnection } from '../adapters/qq/onebot-v11/src/connection.ts'
import type { PluginContext } from '../../src/types/plugin/ctx.ts'
import type { AurabotConfig } from '../../src/core/config/shape/defaults.ts'

export const defaultOneBotId = 'adapter-qq-onebot-v11'
type Connection = ReturnType<typeof createOneBotConnection>

export function defaultOneBot(getConfig: () => AurabotConfig) {
  return {
    ...adapter,
    id: defaultOneBotId,
    packageDir: fileURLToPath(new URL('../adapters/qq/onebot-v11/', import.meta.url)),
    version: '0.1.0',
    platforms: ['qq'],
    apply(ctx: PluginContext, settings: adapter.Config) {
      const current = getConfig()
      if (ctx.instanceId !== defaultOneBotId) return adapter.apply(ctx, settings)
      if (!current.enabled) return
      const overrides = current.ext?.[defaultOneBotId] ?? {}
      const config = { ...current.onebot, selfId: current.botQQ, ...overrides } as adapter.Config
      return adapter.apply(ctx, config)
    },
  }
}

export function primaryOneBot(service: () => Connection | null) {
  return {
    get state() { return service()?.client.state ?? 'stopped' },
    get verified() { return service()?.verified ?? false },
    get login() { return service()?.login ?? { uin: '', nickname: '', at: 0 } },
    get wrongAccount() { return service()?.wrongAccount ?? '' },
    isConnected() { return service()?.client.isConnected() ?? false },
    async call(action: string, params = {}, options = {}) {
      const current = service()
      if (!current || (!current.verified && action !== 'get_login_info')) throw new Error('OneBot 适配器尚未核验登录账号')
      return current.client.call(action, params, options)
    },
  }
}
