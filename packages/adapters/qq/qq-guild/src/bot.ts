/**
 * QQ 频道机器人。
 *
 * 频道是 QQ 开放平台里最接近「标准机器人平台」的一个：有频道、子频道、成员、
 * 消息 API 全会返回 JSON，鉴权用 AppID + AppSecret 换的 AccessToken。
 *
 * 这里只做「平台动作 → 频道 API」的翻译。
 */

import type { BotLike, BotStatus, Capability, SendOptions } from '../../../../../src/types/bot.ts'
import type { QQGuildMessageParams } from '../../../../../src/types/adapter.ts'
import type { QQOpenApi } from '../../common/src/openapi.ts'
import { BotStateError } from '../../../../../src/core/bot/index.ts'
import { renderQQText } from '../../common/src/render.ts'

/** `PUT /users/@me/dms` 的入参：开一个私信频道。 */
export interface QQGuildCreateDmParams {
  recipient_id: string
  source_guild_id: string
}

export interface QQGuildDmChannel {
  id?: string
  channel_id?: string
  guild_id?: string
}

export interface QQGuildBotInit {
  api: QQOpenApi
  selfId?: string
  /** 没拿到 selfId 时的实例 id，多开时不能重。 */
  id?: string
  /** 频道私信必须带源频道 id；不填就只能发频道消息。 */
  dmGuildId?: string
  log?: { warn: (...args: any[]) => void }
}

/** 频道消息能表达的东西：文本、@、markdown、引用、表情回应。 */
const CAPABILITIES: Capability[] = ['text', 'at', 'markdown', 'quote', 'reaction']

export class QQGuildBot implements BotLike {
  readonly platform = 'qq'
  private readonly api: QQOpenApi
  private readonly key: string
  private readonly dmGuildId: string
  private readonly log?: { warn: (...args: any[]) => void }
  /** 私信要先换 channel_id，换过就记住，别每次都开。 */
  private readonly directChannels = new Map<string, string>()
  private self = ''
  private state: BotStatus = 'registered'
  private reason = ''

  constructor(init: QQGuildBotInit) {
    this.api = init.api
    this.self = init.selfId ?? ''
    this.key = init.id ?? 'qq-guild'
    this.dmGuildId = init.dmGuildId ?? ''
    this.log = init.log
  }

  get id(): string {
    return this.self || this.key
  }

  get selfId(): string {
    return this.self
  }

  get status(): BotStatus {
    return this.state
  }

  get lastErrorMessage(): string {
    return this.reason
  }

  setSelfId(selfId: string): void {
    this.self = String(selfId)
  }

  markOnline(): void {
    this.state = 'online'
    this.reason = ''
  }

  markOffline(reason: string): void {
    this.state = 'offline'
    this.reason = reason
  }

  markError(error: Error): void {
    this.state = 'error'
    this.reason = error.message
  }

  supports(capability: Capability): boolean {
    return CAPABILITIES.includes(capability)
  }

  async sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendMessage')
    const body: QQGuildMessageParams = {
      content: renderQQText(content, {
        supports: (capability) => this.supports(capability),
        at: (id) => `<@!${id}>`,
      }),
    }
    if (options?.replyTo) {
      body.msg_id = options.replyTo
      body.msg_seq = 1
    }
    return this.api.request('POST', `/channels/${encodeURIComponent(channelId)}/messages`, body)
  }

  async sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendPrivateMessage')
    const channelId = await this.ensureDirectChannel(userId)
    const body: QQGuildMessageParams = {
      content: renderQQText(content, {
        supports: (capability) => this.supports(capability),
        at: (id) => `<@!${id}>`,
      }),
    }
    if (options?.replyTo) {
      body.msg_id = options.replyTo
      body.msg_seq = 1
    }
    return this.api.request('POST', `/channels/${encodeURIComponent(channelId)}/messages`, body)
  }

  /** 频道私信没有「直接发给用户」，必须先 `PUT /users/@me/dms` 换出 channel_id。 */
  async ensureDirectChannel(userId: string): Promise<string> {
    const key = String(userId)
    const cached = this.directChannels.get(key)
    if (cached) return cached
    if (!this.dmGuildId) {
      throw new Error('频道私信要先在配置里填 dmGuildId（源频道 id），否则开不了私信频道')
    }
    const result = await this.api.request<QQGuildDmChannel>('PUT', '/users/@me/dms', {
      recipient_id: key,
      source_guild_id: this.dmGuildId,
    })
    const channelId = String(result.channel_id ?? result.id ?? '')
    if (!channelId) throw new Error(`开私信频道失败：接口没有返回 channel_id`)
    this.directChannels.set(key, channelId)
    return channelId
  }

  private assertOnline(action: string): void {
    if (this.state !== 'online') {
      this.log?.warn(`频道机器人 ${this.id} 不在线，不能 ${action}`)
      throw new BotStateError(this, action)
    }
  }
}
