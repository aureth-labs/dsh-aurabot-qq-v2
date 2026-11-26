/**
 * Session 契约：一条入站消息一个实例。
 *
 * 群消息、私聊、定时任务、指令回调都走同一套字段，插件拿到的永远是这些。
 * 所有发送方法都是异步的，调用方一律 `await`。
 */

import type { BotLike, SendOptions } from '../adapter/bot.ts'
import type { Element } from './element.ts'
import type { Target, TargetType } from './target.ts'
import type { PipelineResult, PipelineRunner } from '../plugin/pipeline.ts'

export interface SessionInit {
  bot: BotLike
  type: TargetType
  channelId: string
  userId: string
  userName?: string
  content: string
  messageId?: string
  guildId?: string
  /** 入站元素树；取不到就留空，`content` 是它的纯文本投影。 */
  elements?: Element[]
  timestamp?: number
  /** 挂了管线之后，`session.execute()` 才能用。 */
  pipeline?: PipelineRunner
}

/**
 * 插件侧的 Session 形状。
 *
 * 用接口而不是 Session 类，是为了让宿主可以塞进简化版（定时任务、测试桩），
 * 插件只依赖这份契约，不依赖具体实现。
 */
export interface SessionLike {
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
  readonly target: Target
  readonly platform: string
  readonly isPrivate: boolean
  /** 发回当前会话：群发群、私聊发私聊。可以多次调用，每次一条独立消息。 */
  send(content: unknown, options?: SendOptions): Promise<unknown>
  /** 主动私聊指定用户，和当前会话在哪儿无关。 */
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>
  /** 主动发到指定频道。 */
  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  /**
   * 以当前会话身份再发一遍这条消息：会走指令 / 中间件 / 模型三段，该发出去的真发。
   * 等价于「用户又发了这句话」，不是「本地跑一下不发」。
   */
  execute(text: string): Promise<PipelineResult>
}
