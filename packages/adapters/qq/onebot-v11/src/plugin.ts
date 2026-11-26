import type { PluginContext } from '../../../../../src/types/plugin/ctx.ts'
import type { AdapterSpec } from '../../../../../src/types/adapter/adapter.ts'
import { createOneBotConnection } from './connection.ts'
import { stickerService } from '../../../../../src/core/message/media/sticker.ts'
import { stickerSource } from './stickers.ts'
import { voiceSource } from './voice.ts'
import { oneBotNotice } from './notices.ts'
import { inboundOf, isMessageEvent } from './inbound.ts'
import type { OneBotBot } from './bot.ts'

import { Schema } from '../../../../../src/core/config/shape/schema.ts'

export interface Config {
  expandForwards?: boolean
  wsUrl: string
  httpUrl: string
  wsToken: string
  httpToken: string
  selfId: string
}

export const kind = 'adapter'
export const reusable = true
export const reloadOnConfig = true
export const name = 'QQ · OneBot v11'
export const config = Schema.object({
  expandForwards: Schema.boolean().default(true).description('展开接收到的合并转发'),
  wsUrl: Schema.string().required().description('OneBot WebSocket 地址'),
  httpUrl: Schema.string().description('HTTP 接口地址（可选）'),
  wsToken: Schema.string().role('secret').description('WebSocket 访问令牌'),
  httpToken: Schema.string().role('secret').description('HTTP 访问令牌'),
  selfId: Schema.string().description('限定登录的机器人 QQ 号（可选）'),
})

export function apply(ctx: PluginContext, config: Config) {
  if (!config.wsUrl) return
  let connection: ReturnType<typeof createOneBotConnection>
  const spec: AdapterSpec = {
    platform: 'qq',
    name,
    async connect(_, runtime) {
      let sn = 0
      const ready = Promise.withResolvers<OneBotBot>()
      connection = createOneBotConnection({
        id: ctx.instanceId,
        expandForwards: config.expandForwards,
        endpoint: () => config,
        expectedAccount: () => config.selfId || undefined,
        enabled: () => true,
        log: ctx.logger,
        onOnline(bot) {
          runtime.statusChanged?.()
          ready.resolve(bot)
        },
        onOffline: (_, reason) => runtime.statusChanged?.(reason),
        onReady: async () => ctx.emit('onebot/ready', ctx.instanceId),
        onState(state, detail) {
          ctx.emit('onebot/connection', ctx.instanceId, state, detail)
          if (state === 'stopped') ready.reject(new Error(connection.wrongAccount ? '网关登录账号不匹配' : 'OneBot 连接已停止'))
        },
        onEvent(event) {
          if (isMessageEvent(event)) runtime.emitMessage({ ...inboundOf(event), sn: ++sn })
          else {
            const notice = oneBotNotice(event, ++sn)
            if (notice) runtime.emitEvent?.(notice.type, notice)
            runtime.emitEvent?.('onebot', event)
          }
        },
      })
      const expand = connection.bot.expandForwards
      ctx.provide('onebot/' + ctx.instanceId, connection)
      if (config.expandForwards !== false) ctx.on('before-parse', async draft => {
        if (draft.platform !== 'qq' || draft.botId !== ctx.instanceId || !ctx.root.config.enabled ||
            ctx.root.config.debug || ctx.host.canReadMedia?.(ctx.bots.get(ctx.instanceId, 'qq'), draft) === false) return
        draft.elements = await expand(draft.elements, draft.messageId)
      })
      ctx.provide(stickerService('qq', ctx.instanceId), stickerSource(connection))
      ctx.provide('voice-source/' + JSON.stringify(['qq', ctx.instanceId]), { open: voiceSource(connection.bot) })
      const cancel = () => {
        connection.client.stop()
        ready.reject(new Error('OneBot 连接已停止'))
      }
      runtime.signal?.throwIfAborted()
      runtime.signal?.addEventListener('abort', cancel, { once: true })
      try {
        connection.client.start()
        return await ready.promise
      } catch (error) {
        cancel()
        throw error
      } finally {
        runtime.signal?.removeEventListener('abort', cancel)
      }
    },
    async disconnect() { connection.client.stop() },
  }
  const ready = ctx.adapter(spec, config).catch(error => {
    if (error?.name !== 'AbortError') ctx.logger.warn('OneBot 连接结束', error.message)
  })
  return { ready }
}
