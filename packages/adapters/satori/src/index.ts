// Satori 适配器：把任意 Satori 协议实现接成 AuraBot 的一个平台。
//
// 刻意做成「普通适配器」——不碰任何业务逻辑，只做三件事：
//   1. 连上 Satori（WebSocket 收事件 + HTTP 发消息）
//   2. 事件 → InboundMessage（元素树）
//   3. 发送：元素树 → Satori content
//
// 业务插件对它是无感的：`ctx.command` / `ctx.middleware` / `session.send` 照旧。

import type { AdapterRuntime, AdapterSpec, InboundMessage } from '../../../../src/types/adapter.ts'
import type {
  BotLike,
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
} from '../../../../src/types/bot.ts'
import { Bot } from '../../../../src/core/bot/index.ts'
import { isElement, toText } from '../../../../src/core/message/element/element.ts'
import { fromSatori, toSatoriBody } from '../../../../src/core/message/satori/satori.ts'
import { SatoriClient, type SatoriEvent, type SatoriLogin } from '../../../../src/core/message/satori/satori-client.ts'

export interface SatoriAdapterConfig {
  /** Satori 服务地址，`http://127.0.0.1:5140` / `ws://…` 都行。 */
  endpoint: string
  token?: string
  /**
   * 真实平台名，进 `Target.platform`（discord / telegram / qq……）。
   * 不写就用 `satori`——插件里 `ctx.platform('discord')` 要能对上，所以建议写上。
   */
  platform?: string
}

/** Satori 的频道类型：0 文本 / 1 私聊 / 2 分类 / 3 语音。 */
const CHANNEL_DIRECT = 1

const CAPABILITIES: Capability[] = ['text', 'at', 'image', 'voice', 'video', 'file', 'forward', 'quote']

class SatoriBot extends Bot {
  readonly platform: string
  private readonly client: SatoriClient
  private readonly log: (message: string) => void
  /** 私聊没有独立「发给用户」的 API，得先记住用户对应的直聊频道。 */
  private readonly directChannels = new Map<string, string>()
  private self = ''
  private state: BotStatus = 'registered'
  private reason = ''

  constructor(platform: string, client: SatoriClient, log: (message: string) => void) {
    super()
    this.platform = platform
    this.client = client
    this.log = log
  }

  get id(): string {
    return this.self || `${this.platform}:satori`
  }

  get selfId(): string {
    return this.self
  }

  get status(): BotStatus {
    return this.state
  }

  get lastError(): string {
    return this.reason
  }

  setLogin(login: SatoriLogin | undefined): void {
    this.self = String(login?.user?.id ?? '')
  }

  markOnline(): void {
    this.state = 'online'
    this.reason = ''
  }

  markOffline(reason: string): void {
    this.state = 'offline'
    this.reason = reason
  }

  rememberDirect(userId: string, channelId: string): void {
    this.directChannels.set(String(userId), String(channelId))
  }

  supports(capability: Capability): boolean {
    return CAPABILITIES.includes(capability)
  }

  async sendMessage(channelId: string, content: unknown, _options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendMessage')
    return this.client.call('message.create', { channel_id: String(channelId), content: render(content) })
  }

  async sendPrivateMessage(userId: string, content: unknown, _options?: SendOptions): Promise<unknown> {
    this.assertOnline('sendPrivateMessage')
    const channelId = this.directChannels.get(String(userId))
    if (!channelId) {
      // 没收到过这个人的私聊就没有直聊频道 id；Satori 的 message.create 只认 channel_id
      throw new Error(`还没收到过 ${userId} 的私聊，拿不到直聊频道 id，发不出去`)
    }
    return this.client.call('message.create', { channel_id: channelId, content: render(content) })
  }

  private assertOnline(action: string): void {
    if (this.state !== 'online') throw new Error(`机器人 ${this.platform}/${this.id} 不在线，不能 ${action}（${this.reason || '未连接'}）`)
  }

  async getSelf(): Promise<User> {
    return this.getUser(this.selfId)
  }

  async getUser(userId: string): Promise<User> {
    return mapUser(await this.api('user.get', { user_id: String(userId) }), userId)
  }

  async getFriendList(): Promise<User[]> {
    return rowsOf(await this.api('friend.list', {})).map((item) => mapUser(item))
  }

  async getGuild(guildId: string): Promise<Guild> {
    const raw = await this.api('guild.get', { guild_id: String(guildId) })
    return { id: String(raw?.id ?? guildId), name: String(raw?.name ?? ''), avatar: raw?.avatar, raw }
  }

  async getGuildList(): Promise<Guild[]> {
    return rowsOf(await this.api('guild.list', {})).map((item) => ({
      id: String(item?.id ?? ''),
      name: String(item?.name ?? ''),
      avatar: item?.avatar,
      raw: item,
    }))
  }

  async getUserList(guildId: string): Promise<GuildMember[]> {
    return rowsOf(await this.api('guild.member.list', { guild_id: String(guildId) })).map((item) => ({
      user: mapUser(item?.user ?? item),
      nick: item?.nick,
      roles: Array.isArray(item?.roles) ? item.roles.map(String) : [],
      joinedAt: item?.joined_at ?? undefined,
      raw: item,
    }))
  }

  async getChannel(channelId: string): Promise<Channel> {
    return mapChannel(await this.api('channel.get', { channel_id: String(channelId) }), channelId)
  }

  async getChannelList(guildId: string): Promise<Channel[]> {
    return rowsOf(await this.api('channel.list', { guild_id: String(guildId) })).map((item) => mapChannel(item))
  }

  async getMessage(channelId: string, messageId: string): Promise<Message> {
    const raw = await this.api('message.get', { channel_id: String(channelId), message_id: String(messageId) })
    return mapMessage(raw, channelId)
  }

  async getMessageList(channelId: string, query: MessageQuery = {}): Promise<Message[]> {
    const raw = await this.api('message.list', {
      channel_id: String(channelId),
      next: query.next,
      limit: query.limit,
    })
    return rowsOf(raw).map((item) => mapMessage(item, channelId))
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.api('message.delete', { channel_id: String(channelId), message_id: String(messageId) })
  }

  async updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message> {
    const raw = await this.api('message.update', {
      channel_id: String(channelId),
      message_id: String(messageId),
      content: render(content),
    })
    return mapMessage(raw, channelId)
  }

  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.api('reaction.create', { channel_id: String(channelId), message_id: String(messageId), emoji })
  }

  async deleteReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.api('reaction.delete', { channel_id: String(channelId), message_id: String(messageId), emoji })
  }

  private async api(method: string, params: Record<string, unknown>): Promise<any> {
    this.assertOnline(method)
    return this.client.call(method, params)
  }
}

/** 元素树 → Satori content；已经是字符串就原样当消息体（含标签时按元素解析）。 */
function render(content: unknown): string {
  if (typeof content === 'string') return toSatoriBody(content)
  if (isElement(content) || Array.isArray(content)) return toSatoriBody(content as never)
  return toSatoriBody(String(content ?? ''))
}

/** 事件 → InboundMessage。认不出来的事件返回 null。 */
export function inboundOf(event: SatoriEvent, bot: { rememberDirect(userId: string, channelId: string): void }): InboundMessage | null {
  if (event.type !== 'message-created' || !event.message) return null
  const userId = String(event.user?.id ?? '')
  const channelId = String(event.channel?.id ?? '')
  if (!userId || !channelId) return null

  const direct = event.channel?.type === CHANNEL_DIRECT
  if (direct) bot.rememberDirect(userId, channelId)
  const elements = fromSatori(event.message.content ?? '')
  return {
    type: direct ? 'private' : 'group',
    channelId,
    userId,
    userName: String(event.user?.nick || event.user?.name || userId),
    content: toText(elements),
    elements,
    messageId: event.message.id != null ? String(event.message.id) : undefined,
    guildId: event.guild?.id != null ? String(event.guild.id) : undefined,
    timestamp: Number(event.timestamp) || Date.now(),
    raw: event,
  }
}

export function satoriAdapter(): AdapterSpec {
  return {
    platform: 'satori',
    // 真正的平台名在配置里（discord / telegram / qq……）；没写才退回协议名
    resolvePlatform: (config) => String((config as SatoriAdapterConfig | undefined)?.platform || 'satori'),
    name: 'Satori 协议',
    capabilities: CAPABILITIES,

    async connect(config, runtime: AdapterRuntime): Promise<BotLike> {
      const cfg = (config ?? {}) as SatoriAdapterConfig
      if (!cfg.endpoint) throw new Error('Satori 适配器要填 endpoint')
      const platform = runtime.platform

      let bot: SatoriBot | null = null
      const client = new SatoriClient({
        endpoint: cfg.endpoint,
        token: cfg.token,
        platform,
        log: {
          debug: (...args) => runtime.log(args.map(String).join(' ')),
          info: (...args) => runtime.log(args.map(String).join(' ')),
          warn: (...args) => runtime.log(args.map(String).join(' ')),
          error: (...args) => runtime.log(args.map(String).join(' ')),
        },
        onEvent: (event) => {
          if (!bot) return
          const message = inboundOf(event, bot)
          if (message) {
            runtime.emitMessage(message)
            return
          }
          runtime.emitEvent?.(event.type, event)
        },
        onDown: (reason) => bot?.markOffline(reason),
      })

      bot = new SatoriBot(platform, client, runtime.log)
      const logins = await client.connect()
      bot.setLogin(logins[0])
      if (!bot.selfId) {
        client.close()
        throw new Error('Satori 没有返回任何登录账号（READY.logins 为空）')
      }
      bot.markOnline()
      runtime.log(`Satori 适配器上线：${platform}/${bot.selfId}`)

      // disconnect 收到的是适配器自己的实例，client 只能在闭包里
      disconnectOf.set(bot, () => client.close())
      return bot
    },

    async disconnect(bot: BotLike): Promise<void> {
      const close = disconnectOf.get(bot)
      disconnectOf.delete(bot)
      close?.()
    },
  }
}

const disconnectOf = new WeakMap<BotLike, () => void>()

const CHANNEL_TYPES: Record<number, ChannelType> = { 0: 'text', 1: 'direct', 2: 'category', 3: 'voice' }

function rowsOf(value: any): any[] {
  if (Array.isArray(value)) return value
  return Array.isArray(value?.data) ? value.data : []
}

function mapUser(raw: any, fallbackId = ''): User {
  return {
    id: String(raw?.id ?? fallbackId),
    name: raw?.name,
    nick: raw?.nick,
    avatar: raw?.avatar,
    isBot: Boolean(raw?.is_bot),
    raw,
  }
}

function mapChannel(raw: any, fallbackId = ''): Channel {
  return {
    id: String(raw?.id ?? fallbackId),
    type: CHANNEL_TYPES[Number(raw?.type)] ?? 'text',
    name: raw?.name,
    guildId: raw?.guild_id == null ? undefined : String(raw.guild_id),
    parentId: raw?.parent_id == null ? undefined : String(raw.parent_id),
    raw,
  }
}

function mapMessage(raw: any, channelId: string): Message {
  const elements = fromSatori(String(raw?.content ?? ''))
  return {
    id: String(raw?.id ?? ''),
    channelId: String(raw?.channel?.id ?? channelId),
    userId: String(raw?.user?.id ?? ''),
    content: toText(elements),
    elements,
    createdAt: Number(raw?.created_at) || undefined,
    raw,
  }
}
