import { createMediaScope } from '../modules/chat-bridge/qq/media/account.ts'
import { fileURLToPath } from 'node:url'
import * as adapter from '../adapters/qq/onebot-v11/src/plugin.ts'
import type { createOneBotConnection } from '../adapters/qq/onebot-v11/src/connection.ts'
import type { BotLike } from '../../src/types/adapter/bot.ts'
import type { createSendEvents } from '../../src/core/bot/send-events.ts'
import { hubSegments } from '../adapters/qq/onebot-v11/src/inbound.ts'
import { fromOneBot } from '../adapters/qq/onebot-v11/src/element.ts'
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
      ctx.effect(() => media.dispose())
      ctx.on('onebot/connection', (id, state) => { if (id === ctx.instanceId && state !== 'connected') media.reset() })
      return adapter.apply(ctx, config)
    },
  }
}

export function primaryOneBot(service: () => Connection | null, botOf?: () => BotLike, events?: ReturnType<typeof createSendEvents>) {
  return {
    get bot() { return botOf?.() },
    async projectQuote(raw, id) {
      const current = service()
      const elements = fromOneBot(raw)
      if (!current?.bot || !elements.some(el => el.type === 'forward')) return raw
      const expanded = await current.bot.expandForwards(elements, id)
      return current === service() && expanded !== elements ? hubSegments(expanded, raw) : raw
    },
    get state() { return service()?.client.state ?? 'stopped' },
    get verified() { return service()?.verified ?? false },
    get login() { return service()?.login ?? { uin: '', nickname: '', at: 0 } },
    get wrongAccount() { return service()?.wrongAccount ?? '' },
    isConnected() { return service()?.client.isConnected() ?? false },
    async call(action: string, params: Record<string, unknown> = {}, options: { timeoutMs?: number; retries?: number; sensitive?: boolean } = {}) {
      const current = service()
      if (!current || (!current.verified && action !== 'get_login_info')) throw new Error('OneBot 适配器尚未核验登录账号')
      const transmit = () => {
        if (service() !== current || (!current.verified && action !== 'get_login_info')) throw new Error('OneBot 连接已变更')
        return current.client.call(action, params, options)
      }
      if (!events || options?.sensitive || (action !== 'send_group_msg' && action !== 'send_private_msg')) return transmit()
      const bot = botOf?.()
      if (!bot) return transmit()
      const group = action === 'send_group_msg'
      const id = String(group ? params.group_id : params.user_id)
      return events(bot, group ? 'group' : 'private', id, fromOneBot(params.message), transmit)
    },
  }
}
