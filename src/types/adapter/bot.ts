/**
 * Bot 契约：一个已上线的机器人实例。
 *
 * 发送与平台资源查询都在 bot 上，适配器只负责把调用翻译成平台 API。
 * 资源方法对齐 Satori：user / guild / channel / message / friend / reaction。
 * 平台不支持的接口由基类抛 UnsupportedApiError，不静默返回空。
 */

import type { Element } from '../core/element.ts'

export type BotStatus = 'registered' | 'connecting' | 'online' | 'offline' | 'error'

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
  replyTo?: string
  timeoutMs?: number
}

export interface User {
  id: string
  name?: string
  nick?: string
  avatar?: string
  isBot?: boolean
  raw?: unknown
}

export interface Guild {
  id: string
  name?: string
  avatar?: string
  raw?: unknown
}

export type ChannelType = 'text' | 'voice' | 'category' | 'direct'

export interface Channel {
  id: string
  type: ChannelType
  name?: string
  guildId?: string
  parentId?: string
  raw?: unknown
}

export interface GuildMember {
  user: User
  nick?: string
  roles?: string[]
  joinedAt?: number
  raw?: unknown
}

export interface Message {
  channelType?: 'private' | 'group' | 'channel'
  id: string
  channelId: string
  userId: string
  content: string
  elements?: Element[]
  createdAt?: number
  raw?: unknown
}

export interface MessageQuery {
  limit?: number
  /** 平台分页游标；不传取最近一页。 */
  next?: string
  order?: 'asc' | 'desc'
}

export interface BotLike {
  readonly id: string
  readonly platform: string
  readonly selfId: string
  readonly status: BotStatus
  supports(capability: Capability): boolean

  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>

  getSelfId(): string
  getSelf(): Promise<User>
  getUser(userId: string): Promise<User>
  getFriendList(): Promise<User[]>

  getGuild(guildId: string): Promise<Guild>
  getGuildList(): Promise<Guild[]>
  getUserList(guildId: string): Promise<GuildMember[]>

  getChannel(channelId: string): Promise<Channel>
  getChannelList(guildId: string): Promise<Channel[]>

  getMessage(channelId: string, messageId: string): Promise<Message>
  getMessageList(channelId: string, query?: MessageQuery): Promise<Message[]>
  deleteMessage(channelId: string, messageId: string): Promise<void>
  updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message>

  /** 平台原生调用：QQ 是 OneBot action，Telegram 是 Bot API 方法名。没有原生口的平台抛 UnsupportedApiError。 */
  internal<T = any>(action: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>

  createReaction(channelId: string, messageId: string, emoji: string): Promise<void>
  deleteReaction(channelId: string, messageId: string, emoji: string): Promise<void>
}

export interface BotEvents {
  online: (bot: BotLike) => void
  offline: (bot: BotLike, reason?: string) => void
  error: (bot: BotLike, error: Error) => void
}

/**
 * `ctx.bots` 的取法：
 *
 * ```ts
 * ctx.bots[0]
 * ctx.bots('1787850032')
 * ctx.bots.list()
 * ```
 */
export type BotsAccessor = BotLike[] & {
  (id: string, platform?: string): BotLike | undefined
  get(id: string, platform?: string): BotLike | undefined
  list(): BotLike[]
}
