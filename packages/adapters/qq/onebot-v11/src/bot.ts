// OneBot v11 的 Bot 实现。
// 只做「平台动作 → OneBot action」的翻译，不碰业务逻辑，也不改消息内容。

import type {
  BotStatus,
  Capability,
  Channel,
  Guild,
  GuildMember,
  Message,
  MessageQuery,
  SendOptions,
  User,
} from '../../../../../src/types/adapter/bot.ts'
import { Bot, BotStateError } from '../../../../../src/core/bot/index.ts'
import { toOneBot, isElement, normalize, degrade, fromOneBot, toText } from '../../../../../src/core/message/element/element.ts'
import { hasVoiceText, needsVoiceResolve, resolveVoice, type VoiceResolver } from '../../../../../src/core/message/element/voice-element.ts'

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

const CAPABILITIES: Capability[] = ['text', 'at', 'face', 'image', 'voice', 'video', 'file', 'forward', 'quote', 'reaction']

export class OneBotBot extends Bot {
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
    super()
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
  async getSelf(): Promise<User> {
    const info = await this.callApi('get_login_info')
    const id = String(info?.user_id ?? this.selfId)
    if (id) this.setSelfId(id)
    return { id, name: String(info?.nickname ?? ''), raw: info }
  }

  async getUser(userId: string): Promise<User> {
    const info = await this.callApi('get_stranger_info', { user_id: toId(userId), no_cache: true })
    return {
      id: String(info?.user_id ?? userId),
      name: String(info?.remark || info?.nickname || ''),
      nick: String(info?.nickname || ''),
      raw: info,
    }
  }

  async getFriendList(): Promise<User[]> {
    const list = await this.callApi('get_friend_list')
    return (Array.isArray(list) ? list : []).map((item) => ({
      id: String(item?.user_id ?? ''),
      name: String(item?.remark || item?.nickname || ''),
      nick: String(item?.nickname || ''),
      raw: item,
    }))
  }

  async getGuild(guildId: string): Promise<Guild> {
    const info = await this.callApi('get_group_info', { group_id: toId(guildId), no_cache: true })
    return { id: String(info?.group_id ?? guildId), name: String(info?.group_name ?? ''), raw: info }
  }

  async getGuildList(): Promise<Guild[]> {
    const list = await this.callApi('get_group_list')
    return (Array.isArray(list) ? list : []).map((item) => ({
      id: String(item?.group_id ?? ''),
      name: String(item?.group_name ?? ''),
      raw: item,
    }))
  }

  async getUserList(guildId: string): Promise<GuildMember[]> {
    const list = await this.callApi('get_group_member_list', { group_id: toId(guildId) })
    return (Array.isArray(list) ? list : []).map((item) => {
      const role = String(item?.role ?? '')
      return {
        user: { id: String(item?.user_id ?? ''), name: String(item?.card || item?.nickname || '') },
        nick: String(item?.card || ''),
        roles: role === 'owner' ? ['owner'] : role === 'admin' ? ['admin'] : [],
        joinedAt: Number(item?.join_time) ? Number(item.join_time) * 1000 : undefined,
        raw: item,
      }
    })
  }

  async getChannel(channelId: string): Promise<Channel> {
    const id = toId(channelId)
    if (String(channelId).startsWith('private:')) return { id, type: 'direct' }
    const info = await this.callApi('get_group_info', { group_id: id, no_cache: true })
    return { id, type: 'text', name: String(info?.group_name ?? ''), guildId: id, raw: info }
  }

  async getChannelList(guildId: string): Promise<Channel[]> {
    if (guildId) return [await this.getChannel(guildId)]
    const guilds = await this.getGuildList()
    return guilds.map((guild) => ({ id: guild.id, type: 'text' as const, name: guild.name, guildId: guild.id }))
  }

  async getMessage(channelId: string, messageId: string): Promise<Message> {
    const info = await this.callApi('get_msg', { message_id: toId(messageId) })
    return mapMessage(info, channelId)
  }

  async getMessageList(channelId: string, query: MessageQuery = {}): Promise<Message[]> {
    const id = toId(channelId)
    const count = Math.max(1, Math.min(Number(query.limit) || 20, 100))
    const action = String(channelId).startsWith('private:') ? 'get_friend_msg_history' : 'get_group_msg_history'
    const params = action === 'get_friend_msg_history' ? { user_id: id, count } : { group_id: id, count }
    const result = await this.callApi(action, params)
    const list = Array.isArray(result?.messages) ? result.messages : []
    return list.map((item) => mapMessage(item, channelId))
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    void channelId
    await this.callApi('delete_msg', { message_id: toId(messageId) })
  }

  async updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message> {
    void channelId
    void messageId
    void content
    throw new Error('OneBot v11 没有编辑消息的 action')
  }

  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    void channelId
    await this.callApi('set_msg_emoji_like', { message_id: toId(messageId), emoji_id: emoji, set: true })
  }

  private async callApi<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.status !== 'online') throw new BotStateError(this, action)
    return this.call(action, params)
  }

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

function mapMessage(raw: any, channelId: string): Message {
  const elements = fromOneBot(raw?.message ?? raw?.raw_message ?? '')
  return {
    id: String(raw?.message_id ?? ''),
    channelId: String(channelId),
    userId: String(raw?.user_id ?? raw?.sender?.user_id ?? ''),
    content: toText(elements),
    elements,
    createdAt: Number(raw?.time) ? Number(raw.time) * 1000 : undefined,
    raw,
  }
}

