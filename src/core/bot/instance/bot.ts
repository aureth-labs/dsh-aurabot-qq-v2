import type { BotLike, Capability, SendOptions } from '../../../types/adapter/bot.ts'
import type { createSendEvents } from '../send-events.ts'
import { degrade, isElement, normalize } from '../../message/element/element.ts'
import { needsVoiceResolve, resolveVoice, type VoiceResolver } from '../../message/element/voice-element.ts'

export interface WrapAdapterBotOptions {
  allowed: () => boolean
  log: (message: string) => void
  events?: ReturnType<typeof createSendEvents>
  speak?: VoiceResolver
}

export function wrapAdapterBot(bot: BotLike, options: WrapAdapterBotOptions): BotLike {
  const supports = (capability: Capability) => bot.supports(capability)

  const prepare = async (content: unknown): Promise<unknown> => {
    if (typeof content === 'string' && !/[<&]/.test(content)) return content
    if (typeof content !== 'string' && !isElement(content) && !(Array.isArray(content) && content.every(isElement))) return content
    const elements = normalize(content)
    const resolved = options.speak && needsVoiceResolve(elements) ? await resolveVoice(elements, options.speak) : elements
    return degrade(resolved, supports)
  }

  const send = async (
    method: 'sendMessage' | 'sendPrivateMessage',
    targetId: string,
    content: unknown,
    sendOptions?: SendOptions,
  ): Promise<unknown> => {
    if (!options.allowed()) {
      options.log(`总开关关着（${bot.platform} 适配器没真发）→ ${method} ${targetId}`)
      return { ok: false, simulated: true }
    }
    const prepared = await prepare(content)
    if (prepared === '' || (Array.isArray(prepared) && !prepared.length)) return { ok: false, skipped: true }
    const transmit = () => {
      if (!options.allowed()) return Promise.resolve({ ok: false, skipped: true })
      return method === 'sendMessage' ? bot.sendMessage(targetId, prepared, sendOptions) : bot.sendPrivateMessage(targetId, prepared, sendOptions)
    }
    if (!options.events) return transmit()
    const elements = typeof prepared === 'string' || isElement(prepared) || Array.isArray(prepared) && prepared.every(isElement)
      ? normalize(prepared) : []
    return options.events(wrapped, method === 'sendPrivateMessage' ? 'private' : 'channel', targetId, elements, transmit)
  }

  const overrides = {
    supports,
    sendMessage: (channelId: string, content: unknown, sendOptions?: SendOptions) =>
      send('sendMessage', channelId, content, sendOptions),
    sendPrivateMessage: (userId: string, content: unknown, sendOptions?: SendOptions) =>
      send('sendPrivateMessage', userId, content, sendOptions),
  }

  // 资源 API（getUser / getChannel / getMessage……）不逐个转发：
  // 代理把一切未覆盖的成员绑回原实例，适配器以后新增接口不会在这里漏掉。
  const wrapped = new Proxy(bot, {
    get(target, prop) {
      if (prop in overrides) return (overrides as Record<string | symbol, unknown>)[prop]
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target)
    },
  }) as BotLike
  return wrapped
}
