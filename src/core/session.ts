// Session：一条入站消息一个实例。
// 群消息、私聊、定时任务、指令回调都走同一个工厂，插件拿到的永远是这一套字段。
// 所有发送方法都是异步的，调用方一律 await。

import type { BotLike, SendOptions } from '../types/bot.ts'
import type { Element } from '../types/element.ts'
import type { PipelineResult, PipelineRunner } from '../types/pipeline.ts'
import type { SessionInit, SessionLike } from '../types/session.ts'
import type { Target, TargetType } from '../types/target.ts'
import { targetOfBot } from './bot.ts'
import { isElement, toText } from './element.ts'

export type { SessionInit, SessionLike } from '../types/session.ts'

export interface ExecuteResult {
  handled: boolean
  value?: unknown
}

/** 出站回写的上限：只带最近几条、每条不超 300 字，免得把整段刷屏塞进模型上下文。 */
export const SENT_LOG_MAX = 5
export const SENT_TEXT_MAX = 300

/** 发出去的内容压成一行文字（元素树取纯文本）。 */
function sentTextOf(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (isElement(content) || Array.isArray(content)) {
    try {
      return toText(content as never).trim()
    } catch {
      return ''
    }
  }
  return String(content ?? '').trim()
}

export class Session implements SessionLike {
  readonly bot: BotLike
  readonly type: TargetType
  readonly channelId: string
  readonly userId: string
  readonly userName: string
  readonly content: string
  readonly messageId?: string
  readonly guildId?: string
  readonly elements: Element[]
  readonly timestamp: number
  /** 过渡期：OneBot 原始事件的挂载位（S8 收口后删）。 */
  __ev?: unknown
  readonly target: Target
  readonly pipeline?: PipelineRunner

  /**
   * 这条会话往外发过几次（含失败的尝试）。
   *
   * 管线用它判断「中间件是不是已经认领了这条消息」：发过东西才炸的中间件，
   * 不该让消息继续落到模型，否则用户会收到两条。
   */
  sentCount = 0

  /**
   * 这条会话已经发出去的内容（新的在末尾），上限 {@link SENT_LOG_MAX} 条 / 每条 {@link SENT_TEXT_MAX} 字。
   *
   * 用途是「出站回写」：中间件或指令在交给模型之前先回了一句，模型这一轮得知道
   * 自己已经说过什么，才不会重复一遍。宿主在进模型前把它写进聊天流水并清空。
   */
  readonly sentLog: Array<{ text: string; at: number }> = []

  constructor(init: SessionInit) {
    this.bot = init.bot
    this.type = init.type
    this.channelId = init.channelId
    this.userId = init.userId
    this.userName = init.userName ?? ''
    this.content = init.content
    this.messageId = init.messageId
    this.guildId = init.guildId
    this.elements = init.elements ?? []
    this.timestamp = init.timestamp ?? Date.now()
    this.target = targetOfBot(init.bot, init.type, init.type === 'private' ? init.userId : init.channelId)
    this.pipeline = init.pipeline
  }

  get platform(): string {
    return this.bot.platform
  }

  get isPrivate(): boolean {
    return this.type === 'private'
  }

  /** 发回当前会话（群发群、私聊发私聊）。可以多次调用，每次都是一条独立消息。 */
  async send(content: unknown, options?: SendOptions): Promise<unknown> {
    this.sentCount += 1
    const result = this.type === 'private'
      ? await this.bot.sendPrivateMessage(this.userId, content, options)
      : await this.bot.sendMessage(this.channelId, content, options)
    this.rememberSent(content)
    return result
  }

  /** 主动私聊指定用户，和当前会话在哪儿无关。 */
  async sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.sentCount += 1
    const result = await this.bot.sendPrivateMessage(userId, content, options)
    this.rememberSent(content)
    return result
  }

  /** 主动发到指定频道。 */
  async sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    this.sentCount += 1
    const result = await this.bot.sendMessage(channelId, content, options)
    this.rememberSent(content)
    return result
  }

  /** 记一条已发送内容；发失败了不会走到这里（调用方 await 抛错），所以流水里不会有没发出去的话。 */
  private rememberSent(content: unknown): void {
    const text = sentTextOf(content)
    if (!text) return
    this.sentLog.push({ text: text.slice(0, SENT_TEXT_MAX), at: Date.now() })
    while (this.sentLog.length > SENT_LOG_MAX) this.sentLog.shift()
  }

  /**
   * 以当前会话身份本地跑一遍管线：等价于「这条消息又发了一次」。
   * 会经过指令 / 中间件 / 模型三段，该发出去的就真发。
   */
  async execute(text: string): Promise<PipelineResult> {
    if (!this.pipeline) throw new Error('当前会话没有挂管线，execute 不可用')
    return this.pipeline.execute(this, text)
  }

  /**
   * 同一条身份、换一条内容。给 `execute()` 用。
   *
   * 必须是真构造：只复制字段（`{...session}` / `Object.assign`）会把类实例变成普通对象，
   * 中间件拿到的 `send` / `platform` 之类全都没了。
   */
  withContent(content: string): Session {
    return new Session({
      bot: this.bot,
      type: this.type,
      channelId: this.channelId,
      userId: this.userId,
      userName: this.userName,
      content,
      messageId: this.messageId,
      guildId: this.guildId,
      elements: this.elements,
      timestamp: this.timestamp,
      pipeline: this.pipeline,
    })
  }
}

/** 定时任务等没有真实入站消息的场景，用这个造一个 Session。 */
export function createSystemSession(bot: BotLike, type: TargetType, channelId: string, userId = bot.selfId): Session {
  return new Session({ bot, type, channelId, userId, content: '' })
}
