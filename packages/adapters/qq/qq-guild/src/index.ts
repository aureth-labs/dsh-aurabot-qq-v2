/**
 * QQ 频道适配器插件入口。
 *
 * 用法（普通插件里）：
 *
 * ```ts
 * import { createQQGuildSpec } from 'dsh-aurabot-qq/adapters'
 *
 * export function apply(ctx, config) {
 *   ctx.adapter(createQQGuildSpec(), config)
 * }
 * ```
 */

import type { AdapterRuntime, AdapterSpec, InboundMessage } from '../../../../../src/types/adapter.ts'
import type { BotLike } from '../../../../../src/types/bot.ts'
import { AccessTokenProvider } from '../../common/src/access-token.ts'
import { QQGateway, type GatewaySocket } from '../../common/src/gateway.ts'
import { QQOpenApi } from '../../common/src/openapi.ts'
import { QQGuildBot } from './bot.ts'

export { QQGuildBot }
export type { QQGuildBotInit, QQGuildCreateDmParams, QQGuildDmChannel } from './bot.ts'
export type { QQGuildMessageParams } from '../../../../../src/types/adapter.ts'

export interface QQGuildSpecOptions {
  appId?: string
  clientSecret?: string
  /** 默认 GUILDS | PUBLIC_GUILD_MESSAGES | DIRECT_MESSAGE。 */
  intents?: number
  /** 频道私信要用：源频道 id。 */
  dmGuildId?: string
  name?: string
  wsUrl?: string
  apiBase?: string
  tokenEndpoint?: string
  /** 测试注入。 */
  fetchImpl?: typeof fetch
  socketFactory?: (url: string) => GatewaySocket
}

/** GUILDS | PUBLIC_GUILD_MESSAGES | DIRECT_MESSAGE */
export const QQ_GUILD_DEFAULT_INTENTS = (1 << 0) | (1 << 30) | (1 << 12)

const disconnectOf = new WeakMap<BotLike, () => void>()

/**
 * 把一个 QQ 频道机器人接成适配器 spec。
 *
 * `defaults` 里的字段会被模块配置覆盖（面板里填的优先）。
 */
export function createQQGuildSpec(defaults: QQGuildSpecOptions = {}): AdapterSpec {
  return {
    platform: 'qq',
    name: defaults.name || 'QQ 频道',
    capabilities: ['text', 'at', 'markdown', 'quote', 'reaction'],

    async connect(rawConfig, runtime: AdapterRuntime): Promise<BotLike> {
      const config = { ...defaults, ...((rawConfig ?? {}) as QQGuildSpecOptions) }
      const appId = String(config.appId ?? '')
      const clientSecret = String(config.clientSecret ?? '')
      if (!appId || !clientSecret) throw new Error('QQ 频道适配器要填 appId 和 clientSecret')

      const token = new AccessTokenProvider({
        appId,
        clientSecret,
        endpoint: config.tokenEndpoint,
        fetchImpl: config.fetchImpl,
      })
      const api = new QQOpenApi({
        token: () => token.get(),
        baseUrl: config.apiBase,
        fetchImpl: config.fetchImpl,
        log: runtime.log,
      })
      const bot = new QQGuildBot({
        api,
        dmGuildId: config.dmGuildId,
        log: { warn: (...args) => runtime.log(args.map(String).join(' ')) },
      })

      const gateway = new QQGateway({
        url: config.wsUrl,
        intents: config.intents ?? QQ_GUILD_DEFAULT_INTENTS,
        token: () => token.get(),
        socketFactory: config.socketFactory,
        log: runtime.log,
        onDispatch: (type, data) => {
          if (type === 'READY') {
            const selfId = String((data.user as { id?: string } | undefined)?.id ?? '')
            if (selfId) bot.setSelfId(selfId)
            return
          }
          const message = inboundOf(type, data, bot)
          if (message) {
            runtime.emitMessage(message)
            return
          }
          runtime.emitEvent?.(type, data)
        },
      })

      try {
        await gateway.connect()
      } catch (error) {
        gateway.close()
        throw error
      }
      if (!bot.selfId) {
        gateway.close()
        throw new Error('QQ 频道网关 READY 里没有 user.id')
      }
      bot.markOnline()
      runtime.log(`QQ 频道适配器上线：qq/${bot.selfId}`)
      disconnectOf.set(bot, () => {
        gateway.close()
        bot.markOffline('适配器断开')
      })
      return bot
    },

    async disconnect(bot: BotLike): Promise<void> {
      const close = disconnectOf.get(bot)
      disconnectOf.delete(bot)
      close?.()
    },
  }
}

/** 频道网关事件 → InboundMessage。认不出来的返回 null。 */
export function inboundOf(
  type: string,
  data: Record<string, any>,
  bot: { selfId: string },
): InboundMessage | null {
  if (type !== 'MESSAGE_CREATE' && type !== 'AT_MESSAGE_CREATE' && type !== 'DIRECT_MESSAGE_CREATE') return null
  const author = (data.author ?? {}) as { id?: string; username?: string; bot?: boolean }
  const userId = String(author.id ?? '')
  const channelId = String(data.channel_id ?? '')
  if (!userId || !channelId) return null
  if (author.bot) return null
  const direct = type === 'DIRECT_MESSAGE_CREATE'
  return {
    type: direct ? 'private' : 'group',
    channelId,
    userId,
    userName: String(author.username || userId),
    content: stripSelfMention(String(data.content ?? ''), bot.selfId),
    messageId: data.id === undefined ? undefined : String(data.id),
    guildId: data.guild_id === undefined ? undefined : String(data.guild_id),
    timestamp: Date.parse(String(data.timestamp ?? '')) || Date.now(),
    raw: data,
  }
}

function stripSelfMention(content: string, selfId: string): string {
  const trimmed = content.replace(/^\s+/, '')
  if (!selfId) return trimmed
  return trimmed.replace(new RegExp(`^<@!?${selfId}>\\s*`), '')
}
