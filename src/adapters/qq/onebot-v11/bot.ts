// OneBot v11（SnowLuma）的 Bot 实现。
// 只做「平台动作 → OneBot action」的翻译，不碰业务逻辑，也不改消息内容。

import type { BotLike, BotStatus, Capability, SendOptions } from '../../../types/bot.ts'
import { BotStateError } from '../../../core/bot.ts'
import { toOneBot, isElement, normalize, degrade } from '../../../core/element.ts'
import { hasVoiceText, needsVoiceResolve, resolveVoice, type VoiceResolver } from '../../../core/voice-element.ts'

export interface OneBotCall {
  (action: string, params?: Record<string, unknown>, options?: { retries?: number; timeoutMs?: number }): Promise<any>
}

export interface OneBotBotInit {
  call: OneBotCall
  isConnected: () => boolean
  selfId?: string
  id?: string
  /** `<voice>要念的话</voice>` 出站时用它合成音频；不传就按原样发文字。 */
  speak?: VoiceResolver
  log?: { warn: (...args: any[]) => void }
}

const CAPABILITIES: Capability[] = ['text', 'image', 'voice', 'video', 'file', 'forward', 'quote', 'reaction']

export class OneBotBot implements BotLike {
  readonly platform = 'qq'
  readonly call: OneBotCall
  private readonly connected: () => boolean
  private self: string
  private readonly key: string
  private readonly speak?: VoiceResolver
  private readonly log?: { warn: (...args: any[]) => void }
  private state: BotStatus = 'registered'
  private lastError = ''

  constructor(init: OneBotBotInit) {
    this.call = init.call
    this.connected = init.isConnected
    this.self = init.selfId ?? ''
    this.key = init.id ?? 'onebot'
    this.speak = init.speak
    this.log = init.log
  }

  get id(): string {
    return this.self || this.key
  }

  get selfId(): string {
    return this.self
  }

  get status(): BotStatus {
    if (this.state === 'online' && !this.connected()) return 'offline'
    return this.state
  }

  get lastErrorMessage(): string {
    return this.lastError
  }

  /** 登录核对通过后调用，把真实 QQ 号补进来。 */
  setSelfId(selfId: string): void {
    this.self = String(selfId)
  }

  markOnline(): void {
    this.state = 'online'
  }

  markOffline(reason?: string): void {
    this.state = 'offline'
    if (reason) this.lastError = reason
  }

  markError(error: Error): void {
    this.state = 'error'
    this.lastError = error.message
  }

  supports(capability: Capability): boolean {
    return CAPABILITIES.includes(capability)
  }

  async sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    return this.deliver('send_group_msg', { group_id: toId(channelId), message: await this.toMessage(content) }, options)
  }

  async sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    return this.deliver('send_private_msg', { user_id: toId(userId), message: await this.toMessage(content) }, options)
  }

  /**
   * 字符串原样发；OneBot 消息段数组直接透传；元素树序列化成消息段。
   * 带 `<voice>文字</voice>` 的先合成音频（能力由宿主注入，适配器不自己找 TTS）。
   */
  private async toMessage(content: unknown): Promise<unknown> {
    const speak = this.speak
    if (speak && needsVoiceResolve(content as any)) {
      const elements = await resolveVoice(content as any, speak, this.log)
      return toOneBot(elements)
    }
    if (typeof content === 'string') {
      if (speak && hasVoiceText(content)) return toOneBot(await resolveVoice(content, speak, this.log))
      return content
    }
    const fits = (capability: Capability) => this.supports(capability)
    if (isElement(content)) return toOneBot(degrade(content, fits))
    if (Array.isArray(content)) {
      if (content.length && content.every((item) => isElement(item))) return toOneBot(degrade(normalize(content), fits))
      return content
    }
    return String(content ?? '')
  }

  private async deliver(action: string, params: Record<string, unknown>, options?: SendOptions): Promise<unknown> {
    if (this.status !== 'online') throw new BotStateError(this, action)
    const result = await this.call(action, params, { timeoutMs: options?.timeoutMs })
    return result
  }
}

function toId(value: string | number): string {
  return String(value).replace(/^(group|private|channel):/, '')
}

