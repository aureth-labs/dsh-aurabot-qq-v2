// 适配器 bot 的统一包装。
//
// 三件事对所有平台都一样，不能指望每个适配器各写一遍：
//   1. 试运行 / 总开关关着时不许真发（写漏一处就等于那个平台能绕过闸门）
//   2. `<voice>要念的话</voice>` 出站前先合成音频
//   3. 平台渲染不了的元素按能力表降级成文字
//
// 适配器拿到的是包装后的 bot 发消息；它自己的实例仍然只保留在自己手里，
// 断开连接时用的是原实例（见 core/adapter.ts）。

import type { BotLike, Capability, SendOptions } from '../../types/bot.ts'
import { degrade, isElement, normalize } from '../message/element.ts'
import { needsVoiceResolve, resolveVoice, type VoiceResolver } from '../message/voice-element.ts'

export interface WrapAdapterBotOptions {
  /** 现在允许真发吗（总开关开着且不在试运行）。 */
  allowed: () => boolean
  /** 试运行被拦下时的记录口。 */
  log: (message: string) => void
  /** 文字 → 音频地址；没接 TTS 就不传，`<voice>` 会原样留给适配器。 */
  speak?: VoiceResolver
}

/**
 * 包一层发送闸门与消息预处理。

 * 包装后的 bot 与适配器自己的实例 **id / platform / selfId / status 完全一致**，
 * 注册表按 id 索引不会错位。
 */
export function wrapAdapterBot(bot: BotLike, options: WrapAdapterBotOptions): BotLike {
  const supports = (capability: Capability) => bot.supports(capability)

  const prepare = async (content: unknown): Promise<unknown> => {
    if (typeof content === 'string') {
      if (options.speak && needsVoiceResolve(content)) return degrade(await resolveVoice(content, options.speak), supports)
      return content
    }
    if (isElement(content)) {
      const resolved = options.speak && needsVoiceResolve(content) ? await resolveVoice(content, options.speak) : [content]
      return degrade(resolved, supports)
    }
    if (Array.isArray(content) && content.length && content.every((item) => isElement(item))) {
      const resolved = options.speak && needsVoiceResolve(content) ? await resolveVoice(content, options.speak) : normalize(content)
      return degrade(resolved, supports)
    }
    return content
  }

  const send = async (
    method: 'sendMessage' | 'sendPrivateMessage',
    targetId: string,
    content: unknown,
    sendOptions?: SendOptions,
  ): Promise<unknown> => {
    if (!options.allowed()) {
      options.log(`试运行（${bot.platform} 适配器没真发）→ ${method} ${targetId}`)
      return { ok: false, simulated: true }
    }
    const prepared = await prepare(content)
    return method === 'sendMessage'
      ? bot.sendMessage(targetId, prepared, sendOptions)
      : bot.sendPrivateMessage(targetId, prepared, sendOptions)
  }

  return {
    get id() {
      return bot.id
    },
    get platform() {
      return bot.platform
    },
    get selfId() {
      return bot.selfId
    },
    get status() {
      return bot.status
    },
    supports,
    sendMessage: (channelId, content, sendOptions) => send('sendMessage', channelId, content, sendOptions),
    sendPrivateMessage: (userId, content, sendOptions) => send('sendPrivateMessage', userId, content, sendOptions),
  }
}
