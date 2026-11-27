// Bot：一个已上线的机器人实例。
// 契约本身在 src/types/adapter/bot.ts；这里只留运行时行为（状态校验、目标构造）。

import type {
  BotLike,
  BotStatus,
  Capability,
  Channel,
  Guild,
  GuildMember,
  Message,
  MessageQuery,
  SendOptions,
  User,
} from '../../types/adapter/bot.ts'
import type { Target } from '../../types/core/target.ts'

// 老代码一直从 core/bot.ts 取这些类型，这里原样转发，别让调用方跟着改 import 路径。
export type {
  BotLike,
  BotEvents,
  BotStatus,
  Capability,
  Channel,
  ChannelType,
  Guild,
  GuildMember,
  Message,
  MessageQuery,
  SendOptions,
  User,
} from '../../types/adapter/bot.ts'

export class BotStateError extends Error {
  readonly code = 'AURABOT_DELIVERY'
  readonly outcome = 'rejected'
  constructor(bot: BotLike, action: string) {
    super(`bot ${bot.id}（${bot.platform}）当前状态 ${bot.status}，不能执行 ${action}`)
    this.name = 'BotStateError'
  }
}

export function assertOnline(bot: BotLike, action: string): void {
  if (bot.status !== 'online') throw new BotStateError(bot, action)
}

export function targetOfBot(bot: BotLike, type: Target['type'], id: string): Target {
  return { platform: bot.platform, botId: bot.id, type, id }
}

export class UnsupportedApiError extends Error {
  readonly code = 'UNSUPPORTED_API'

  constructor(bot: Pick<BotLike, 'platform' | 'id'>, api: string) {
    super(`${bot.platform}/${bot.id} 不支持 ${api}`)
    this.name = 'UnsupportedApiError'
  }
}

/**
 * 平台资源 API 的默认实现：不支持的接口一律抛错。
 * 适配器继承 `Bot`，只覆盖自己真能实现的那些。
 */
export abstract class Bot implements BotLike {
  abstract readonly id: string
  abstract readonly platform: string
  abstract readonly selfId: string
  abstract readonly status: BotStatus

  abstract supports(capability: Capability): boolean
  abstract sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  abstract sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>

  async internal<T = any>(action: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T> {
    void params
    void options
    throw new UnsupportedApiError(this, `internal(${action})`)
  }

  getSelfId(): string {
    return this.selfId
  }

  async getSelf(): Promise<User> {
    return { id: this.selfId }
  }

  async getUser(userId: string): Promise<User> {
    void userId
    throw new UnsupportedApiError(this, 'getUser')
  }

  async getFriendList(): Promise<User[]> {
    throw new UnsupportedApiError(this, 'getFriendList')
  }

  async getGuild(guildId: string): Promise<Guild> {
    void guildId
    throw new UnsupportedApiError(this, 'getGuild')
  }

  async getGuildList(): Promise<Guild[]> {
    throw new UnsupportedApiError(this, 'getGuildList')
  }

  async getUserList(guildId: string): Promise<GuildMember[]> {
    void guildId
    throw new UnsupportedApiError(this, 'getUserList')
  }

  async getChannel(channelId: string, type?: Message['channelType']): Promise<Channel> {
    void channelId
    throw new UnsupportedApiError(this, 'getChannel')
  }

  async getChannelList(guildId: string): Promise<Channel[]> {
    void guildId
    throw new UnsupportedApiError(this, 'getChannelList')
  }

  async getMessage(channelId: string, messageId: string): Promise<Message> {
    void channelId
    void messageId
    throw new UnsupportedApiError(this, 'getMessage')
  }

  async getMessageList(channelId: string, query?: MessageQuery): Promise<Message[]> {
    void channelId
    void query
    throw new UnsupportedApiError(this, 'getMessageList')
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    void channelId
    void messageId
    throw new UnsupportedApiError(this, 'deleteMessage')
  }

  async updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message> {
    void channelId
    void messageId
    void content
    throw new UnsupportedApiError(this, 'updateMessage')
  }

  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    void channelId
    void messageId
    void emoji
    throw new UnsupportedApiError(this, 'createReaction')
  }

  async deleteReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    void channelId
    void messageId
    void emoji
    throw new UnsupportedApiError(this, 'deleteReaction')
  }
}

/** 测试桩 / 调试用：补齐资源 API，调用即抛错，只有 getSelf 返回 id。 */
export function botApiStubs(id = ''): Pick<
  BotLike,
  | 'getSelfId'
  | 'getSelf'
  | 'getUser'
  | 'getFriendList'
  | 'getGuild'
  | 'getGuildList'
  | 'getUserList'
  | 'getChannel'
  | 'getChannelList'
  | 'getMessage'
  | 'getMessageList'
  | 'deleteMessage'
  | 'updateMessage'
  | 'createReaction'
  | 'deleteReaction'
  | 'internal'
> {
  const fail = (api: string) => async (): Promise<never> => {
    throw new Error(`${id || 'bot'} 不支持 ${api}`)
  }
  return {
    getSelfId: () => id,
    getSelf: async () => ({ id }),
    getUser: fail('getUser'),
    getFriendList: fail('getFriendList'),
    getGuild: fail('getGuild'),
    getGuildList: fail('getGuildList'),
    getUserList: fail('getUserList'),
    getChannel: fail('getChannel'),
    getChannelList: fail('getChannelList'),
    getMessage: fail('getMessage'),
    getMessageList: fail('getMessageList'),
    deleteMessage: fail('deleteMessage'),
    updateMessage: fail('updateMessage'),
    createReaction: fail('createReaction'),
    deleteReaction: fail('deleteReaction'),
    internal: fail('internal'),
  }
}
