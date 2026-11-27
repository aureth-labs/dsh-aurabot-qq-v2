import { stickerService } from '../../src/core/message/media/sticker.ts'
import type { stickerSource } from '../adapters/qq/onebot-v11/src/stickers.ts'
import { createMediaScope } from '../modules/chat-bridge/qq/media/account.ts'
import { fileURLToPath } from 'node:url'
import * as adapter from '../adapters/qq/onebot-v11/src/plugin.ts'
import type { createOneBotConnection } from '../adapters/qq/onebot-v11/src/connection.ts'
import type { createWarmup } from '../adapters/qq/onebot-v11/src/warmup.ts'
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
      const media = createMediaScope(() => {
        const connection = ctx.services.get<Connection>('onebot/' + ctx.instanceId)
        return connection?.verified ? connection.login.uin : null
      }, ctx.logger)
      ctx.provide('primary-chat-media', media)
      ctx.provide('primary-sticker-source', { capture: () => ctx.get<ReturnType<typeof stickerSource>>(stickerService('qq', ctx.instanceId))?.capture(), botId: ctx.instanceId, platform: 'qq' })
      ctx.effect(() => media.dispose())
      ctx.on('onebot/connection', (id, state) => { if (id === ctx.instanceId && state !== 'connected') media.reset() })
      return adapter.apply(ctx, config)
    },
  }
}

export function oneBotStatus(services: { get<T>(name: string): T | undefined }, id = defaultOneBotId) {
  const connection = () => services.get<Connection>('onebot/' + id)
  const warmup = () => services.get<ReturnType<typeof createWarmup>>('onebot-warmup/' + id)
  return {
    get state() { return connection()?.client.state ?? 'stopped' },
    get verified() { return connection()?.verified ?? false },
    get login() { return connection()?.login ?? { uin: '', nickname: '', at: 0 } },
    get wrongAccount() { return connection()?.wrongAccount ?? '' },
    warmup: () => warmup()?.snapshot() ?? { since: 0, phase: '', label: '' },
  }
}
