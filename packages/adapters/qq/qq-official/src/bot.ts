/**
 * QQ 官方机器人（QQ 开放平台的群机器人 / 单聊机器人）。
 *
 * 和频道机器人不是一回事：会话 id 是 `group_openid` / `user_openid`（不是 QQ 号），
 * 被动回复必须带 `msg_id` + 递增的 `msg_seq`，否则会被平台拒掉。
 */

import type { BotLike, BotStatus, Capability, SendOptions } from '../../../../../src/types/bot.ts'
import type { QQOfficialMessageParams } from '../../../../../src/types/adapter.ts'
import type { QQOpenApi } from '../../common/src/openapi.ts'
import { BotStateError } from '../../../../../src/core/bot/index.ts'
import { renderQQText } from '../../common/src/render.ts'

export interface QQOfficialBotInit {
  api: QQOpenApi
  selfId?: string
  id?: string
  log?: { warn: (...args: any[]) => void }
}

/** 官方机器人能稳定表达的：文本、markdown、引用回复。图片要先走富媒体上传。 */
const CAPABILITIES: Capability[] = ['text', 'markdown', 'quote']

export class QQOfficialBot implements BotLike {
  readonly platform = 'qq'
  private readonly api: QQOpenApi
  private readonly key: string
  private readonly log?: { warn: (...args: any[]) => void }
  private sequence = 0
  private self = ''
  private state: BotStatus = 'registered'
  private reason = ''

  constructor(init: QQOfficialBotInit) {
    this.api = init.api
    this.self = init.selfId ?? ''
    this.key = init.id ?? 'qq-official-bot'
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

  /** 群聊：`group_openid` 来自入站事件的 `group_openid`。 */
  async sendMessage(groupOpenId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendMessage')
    const body = this.buildBody(content, options)
    return this.api.request('POST', `/v2/groups/${encodeURIComponent(groupOpenId)}/messages`, body)
  }

  /** 单聊：`user_openid` 来自入站事件的 `author.user_openid`。 */
  async sendPrivateMessage(userOpenId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendPrivateMessage')
    const body = this.buildBody(content, options)
    return this.api.request('POST', `/v2/users/${encodeURIComponent(userOpenId)}/messages`, body)
  }

  private buildBody(content: unknown, options?: SendOptions): QQOfficialMessageParams {
    const body: QQOfficialMessageParams = {
      content: renderQQText(content, { supports: (capability) => this.supports(capability) }),
      msg_type: 0,
    }
    if (options?.replyTo) {
      body.msg_id = options.replyTo
      this.sequence += 1
      body.msg_seq = this.sequence
    }
    return body
  }

  private assertOnline(action: string): void {
    if (this.state !== 'online') {
      this.log?.warn(`官方机器人 ${this.id} 不在线，不能 ${action}`)
      throw new BotStateError(this, action)
    }
  }
}
