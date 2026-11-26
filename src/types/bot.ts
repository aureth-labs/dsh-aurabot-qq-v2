/**
 * Bot 契约：一个已上线的机器人实例。
 *
 * 生命周期固定为「注册 → 连接 → 上线事件 → 可用 → 断开 → 下线事件」，
 * 未上线时调用发送一律抛错，不要静默丢消息。
 */

export type BotStatus = 'registered' | 'connecting' | 'online' | 'offline' | 'error'

/** 适配器要如实声明自己能渲染哪些元素，核心据此决定是否降级。 */
export type Capability =
  | 'text'
  | 'at'
  | 'face'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'forward'
  | 'markdown'
  | 'html'
  | 'satori'
  | 'quote'
  | 'reaction'

export interface SendOptions {
  /** 引用回复哪条消息（平台原生的 reply / quote）。 */
  replyTo?: string
  timeoutMs?: number
}

export interface BotLike {
  /** 实例 id，注册表按它索引；同一个平台多开时不能重。 */
  readonly id: string
  readonly platform: string
  /** 平台侧自己的账号，用来判断「是不是我发的」。 */
  readonly selfId: string
  readonly status: BotStatus
  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>
  supports(capability: Capability): boolean
}

export interface BotEvents {
  online: (bot: BotLike) => void
  offline: (bot: BotLike, reason?: string) => void
  error: (bot: BotLike, error: Error) => void
}

/**
 * `ctx.bots` 的取法（三种都支持）：
 *
 * ```ts
 * ctx.bots[0]                 // 第一个
 * ctx.bots('1787850032')      // 按 id 取，取不到是 undefined
 * ctx.bots.list()             // 全部
 * ```
 *
 * 做成「数组 + 可调用」的混合体，是为了不用记 `get()`：写 `ctx.bots(id)` 最顺手。
 */
export type BotsAccessor = BotLike[] & {
  (id: string): BotLike | undefined
  get(id: string): BotLike | undefined
  list(): BotLike[]
}
