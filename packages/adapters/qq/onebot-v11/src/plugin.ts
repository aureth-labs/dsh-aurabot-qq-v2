import type { PluginContext } from '../../../../../src/types/plugin/ctx.ts'
import type { AdapterSpec } from '../../../../../src/types/adapter/adapter.ts'
import { createOneBotConnection } from './connection.ts'
import { inboundOf, isMessageEvent } from './inbound.ts'
import type { OneBotBot } from './bot.ts'

declare const Schema: typeof import('../../../../../src/core/config/shape/schema.ts').Schema

interface Config {
  wsUrl: string
  httpUrl: string
  wsToken: string
  httpToken: string
  selfId: string
}

export const name = 'QQ · OneBot v11'
export const config = Schema.object({
  wsUrl: Schema.string().description('OneBot WebSocket 地址'),
  httpUrl: Schema.string().description('HTTP 接口地址（可选）'),
  wsToken: Schema.string().role('secret').description('WebSocket 访问令牌'),
  httpToken: Schema.string().role('secret').description('HTTP 访问令牌'),
  selfId: Schema.string().description('限定登录的机器人 QQ 号（可选）'),
})

export async function apply(ctx: PluginContext, config: Config) {
  if (!config.wsUrl) return
  let connection: ReturnType<typeof createOneBotConnection>
  const spec: AdapterSpec = {
    platform: 'qq',
    name,
    async connect(_, runtime) {
      const ready = Promise.withResolvers<OneBotBot>()
      connection = createOneBotConnection({
        id: ctx.instanceId,
        endpoint: () => config,
        expectedAccount: () => config.selfId || undefined,
        enabled: () => true,
        log: ctx.logger,
        onOnline: ready.resolve,
        onOffline: (_, reason) => runtime.log(reason),
        onState(state) {
          if (state === 'stopped') ready.reject(new Error(connection.wrongAccount ? '网关登录账号不匹配' : 'OneBot 连接已停止'))
        },
        onEvent(event) {
          if (isMessageEvent(event)) runtime.emitMessage(inboundOf(event))
          else runtime.emitEvent?.('onebot', event)
        },
      })
      const cancel = () => connection.client.stop()
      runtime.signal?.throwIfAborted()
      runtime.signal?.addEventListener('abort', cancel, { once: true })
      const timeout = setTimeout(() => ready.reject(new Error('等待 OneBot 登录超时，请检查网关状态')), 30_000)
      try {
        connection.client.start()
        return await ready.promise
      } catch (error) {
        cancel()
        throw error
      } finally {
        clearTimeout(timeout)
        runtime.signal?.removeEventListener('abort', cancel)
      }
    },
    async disconnect() { connection.client.stop() },
  }
  await ctx.adapter(spec, config)
}
