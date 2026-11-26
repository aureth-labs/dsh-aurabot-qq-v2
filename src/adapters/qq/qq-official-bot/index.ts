/**
 * QQ 官方机器人适配器（QQ 开放平台 · 群机器人 / 单聊机器人）。
 *
 * 与频道机器人共用网关和 AccessToken，只是 intents 与事件名不同。
 */

import type { AdapterRuntime, AdapterSpec, InboundMessage } from '../../../types/adapter.ts'
import type { BotLike } from '../../../types/bot.ts'
import { AccessTokenProvider } from '../access-token.ts'
import { QQGateway, type GatewaySocket } from '../gateway.ts'
import { QQOpenApi } from '../openapi.ts'
import { QQOfficialBot } from './bot.ts'

export { QQOfficialBot }
export type { QQOfficialBotInit } from './bot.ts'
export type { QQOfficialMessageParams } from '../../../types/adapter.ts'

export interface QQOfficialBotSpecOptions {
  appId?: string
  clientSecret?: string
  /** 默认 GROUP_AND_C2C_EVENT（1 << 25）。 */
  intents?: number
  name?: string
  wsUrl?: string
  apiBase?: string
  tokenEndpoint?: string
  fetchImpl?: typeof fetch
  socketFactory?: (url: string) => GatewaySocket
}

/** GROUP_AND_C2C_EVENT：群 @ 机器人与单聊消息都在这个 intent 下。 */
export const QQ_OFFICIAL_DEFAULT_INTENTS = 1 << 25

const disconnectOf = new WeakMap<BotLike, () => void>()

export function createQQOfficialBotSpec(defaults: QQOfficialBotSpecOptions = {}): AdapterSpec {
  return {
    platform: 'qq',
    name: defaults.name || 'QQ 官方机器人',
    capabilities: ['text', 'markdown', 'quote'],

    async connect(rawConfig, runtime: AdapterRuntime): Promise<BotLike> {
      const config = { ...defaults, ...((rawConfig ?? {}) as QQOfficialBotSpecOptions) }
      const appId = String(config.appId ?? '')
      const clientSecret = String(config.clientSecret ?? '')
      if (!appId || !clientSecret) throw new Error('QQ 官方机器人适配器要填 appId 和 clientSecret')

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
      const bot = new QQOfficialBot({
        api,
        log: { warn: (...args) => runtime.log(args.map(String).join(' ')) },
      })

      const gateway = new QQGateway({
        url: config.wsUrl,
        intents: config.intents ?? QQ_OFFICIAL_DEFAULT_INTENTS,
        token: () => token.get(),
        socketFactory: config.socketFactory,
        log: runtime.log,
        onDispatch: (type, data) => {
          if (type === 'READY') {
            const selfId = String((data.user as { id?: string } | undefined)?.id ?? '')
            if (selfId) bot.setSelfId(selfId)
            return
          }
          const message = inboundOf(type, data)
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
        throw new Error('QQ 官方机器人网关 READY 里没有 user.id')
      }
      bot.markOnline()
      runtime.log(`QQ 官方机器人适配器上线：qq/${bot.selfId}`)
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

/**
 * 官方机器人事件 → InboundMessage。
 *
 * - 群：`GROUP_AT_MESSAGE_CREATE`，会话 id 是 `group_openid`
 * - 单聊：`C2C_MESSAGE_CREATE`，会话 id 是 `author.user_openid`
 */
export function inboundOf(type: string, data: Record<string, any>): InboundMessage | null {
  if (type !== 'GROUP_AT_MESSAGE_CREATE' && type !== 'C2C_MESSAGE_CREATE') return null
  const author = (data.author ?? {}) as { id?: string; member_openid?: string; user_openid?: string }
  const group = type === 'GROUP_AT_MESSAGE_CREATE'
  const userId = String(group ? author.member_openid ?? author.id ?? '' : author.user_openid ?? author.id ?? '')
  const channelId = group ? String(data.group_openid ?? '') : userId
  if (!userId || !channelId) return null
  return {
    type: group ? 'group' : 'private',
    channelId,
    userId,
    userName: userId,
    content: String(data.content ?? '').trim(),
    messageId: data.id === undefined ? undefined : String(data.id),
    timestamp: Date.parse(String(data.timestamp ?? '')) || Date.now(),
    raw: data,
  }
}
