// QQ · OneBot v11 适配器。
//
// QQ 自己没有开放的机器人 API，社区走的是「外置协议端」：
//   SnowLuma / LLOneBot / NapCat 之类把 QQ 客户端包装成一个 OneBot v11 的 HTTP / WebSocket 服务，
//   我们只管调它的 action（send_group_msg / send_private_msg …），不碰 QQ 协议本身。
//
// 所以这里的适配器**不自己拉起进程**：传输层（call / isConnected）由宿主或插件提供。

import type { AdapterSpec } from '../../../../../src/types/adapter/adapter.ts'
import type { VoiceResolver } from '../../../../../src/core/message/element/voice-element.ts'
import { OneBotBot, type OneBotBotInit, type OneBotCall } from './bot.ts'

export { OneBotBot }
export type { OneBotBotInit, OneBotCall }

export interface OneBotV11SpecOptions extends OneBotBotInit {
  /** 面板里显示的名字，默认「QQ（OneBot v11）」。 */
  name?: string
}

/**
 * 把一个已有的 OneBot 传输层包装成适配器 spec。
 *
 * 插件里想自己接一个 OneBot 实现（比如自建的 NapCat）时：
 *
 * ```ts
 * const spec = createOneBotV11Spec({
 *   call: (action, params) => myCall(action, params),
 *   isConnected: () => myClient.ready,
 * })
 * const handle = await ctx.adapter(spec, {})
 * ```
 */
export function createOneBotV11Spec(options: OneBotV11SpecOptions): AdapterSpec {
  const bot = new OneBotBot(options)
  return {
    platform: 'qq',
    name: options.name || 'QQ（OneBot v11）',
    async connect() {
      // 传输层是外置的：没连上就别假装上线，直接抛错让宿主什么都不注册
      if (!options.isConnected()) throw new Error('OneBot 网关还没连上')
      bot.markOnline()
      return bot
    },
    async disconnect() {
      bot.markOffline('适配器断开')
    },
  }
}
