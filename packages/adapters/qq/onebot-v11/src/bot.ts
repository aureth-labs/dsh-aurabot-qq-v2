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
import { createForwardExpansion, forwardBudget } from './message/project.ts'
import { messageSource } from './message/source.ts'
import { planPokes } from './message/poke.ts'
import { toOneBot, fromOneBot } from './element.ts'
import { isElement, normalize, degrade, toText, type ElementSource } from '../../../../../src/core/message/element/element.ts'
import { needsVoiceResolve, resolveVoice, type VoiceResolver } from '../../../../../src/core/message/element/voice-element.ts'

export interface OneBotCall {
  (action: string, params?: Record<string, unknown>, options?: { retries?: number; timeoutMs?: number }): Promise<any>
}

export interface OneBotBotInit {
  expandForwards?: boolean
  call: OneBotCall
  isConnected: () => boolean
  selfId?: string
  id?: string
  /** `<voice>要念的话</voice>` 出站时用它合成音频；不传就按原样发文字。 */
  speak?: VoiceResolver
  log?: { warn: (...args: any[]) => void }
}

const CAPABILITIES: Capability[] = ['text', 'at', 'face', 'image', 'voice', 'video', 'file', 'forward', 'quote', 'reaction', 'poke']

export class OneBotBot extends Bot {
  readonly platform = 'qq'
  readonly call: OneBotCall
  readonly expandForwards: ReturnType<typeof createForwardExpansion>
  private readonly connected: () => boolean
  private self: string
  private readonly key: string
  private readonly speak?: VoiceResolver
  private readonly log?: { warn: (...args: any[]) => void }
  private state: BotStatus = 'registered'
  private lastError = ''

  constructor(init: OneBotBotInit) {
    super()
    this.expandForwards = createForwardExpansion(this, init.expandForwards !== false)
    this.call = init.call
    this.connected = init.isConnected
    this.self = init.selfId ?? ''
    this.key = init.id || init.selfId || 'onebot'
    this.speak = init.speak
    this.log = init.log
  }

  get id(): string {
    return this.key
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
    return this.deliver('send_group_msg', { group_id: String(channelId) }, content, options)
  }

  async sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown> {
    return this.deliver('send_private_msg', { user_id: String(userId) }, content, options)
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
    const info = await this.callApi('get_stranger_info', { user_id: String(userId), no_cache: true })
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
    const info = await this.callApi('get_group_info', { group_id: String(guildId), no_cache: true })
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
    const list = await this.callApi('get_group_member_list', { group_id: String(guildId) })
    return (Array.isArray(list) ? list : []).map((item) => {
      const role = String(item?.role ?? '')
      return {
        user: { id: String(item?.user_id ?? ''), name: String(item?.card || item?.nickname || ''), nick: String(item?.nickname || '') },
        nick: String(item?.card || ''),
        roles: role === 'owner' ? ['owner'] : role === 'admin' ? ['admin'] : [],
        joinedAt: Number(item?.join_time) ? Number(item.join_time) * 1000 : undefined,
        raw: item,
      }
    })
  }

  async getChannel(channelId: string, type?: Message['channelType']): Promise<Channel> {
    const id = String(channelId)
    if (type === 'private') return { id, type: 'direct' }
    const info = await this.callApi('get_group_info', { group_id: id, no_cache: true })
    return { id, type: 'text', name: String(info?.group_name ?? ''), guildId: id, raw: info }
  }

  async getChannelList(guildId: string): Promise<Channel[]> {
    if (guildId) return [await this.getChannel(guildId)]
    const guilds = await this.getGuildList()
    return guilds.map((guild) => ({ id: guild.id, type: 'text' as const, name: guild.name, guildId: guild.id }))
  }

  async getMessage(channelId: string, messageId: string): Promise<Message> {
    const info = await this.callApi('get_msg', { message_id: String(messageId) })
    const { type, id: channel } = messageSource(info, this.selfId)
    if (!channel || channel !== channelId)
      throw Error('引用消息不属于当前会话')
    return this.projectMessage(info, channel, type, forwardBudget())
  }

  async getMessageList(channelId: string, query: MessageQuery = {}): Promise<Message[]> {
    const id = String(channelId)
    const count = Math.max(1, Math.min(Number(query.limit) || 20, 100))
    const direct = query.channelType === 'private'
    const target = direct ? { user_id: id } : { group_id: id }
    const params: Record<string, unknown> = { ...target, count }
    if (query.next !== undefined) {
      if (!/^-?\d+$/.test(query.next) || !Number.isSafeInteger(Number(query.next)) || Number(query.next) === 0)
        throw new Error('无效的 OneBot 消息游标')
      params.message_id = Number(query.next)
      params.reverse_order = true
    }
    const result = await this.callApi(direct ? 'get_friend_msg_history' : 'get_group_msg_history', params)
    const rows = Array.isArray(result) ? result : result?.messages
    if (!Array.isArray(rows)) return []
    const budget = forwardBudget()
    const resultRows: Message[] = []
    for (const item of rows) resultRows.push(await this.projectMessage(item, channelId, direct ? 'private' : 'group', budget))
    return resultRows
  }

  private async projectMessage(raw, channel: string, channelType: Message['channelType'], budget: ReturnType<typeof forwardBudget>) {
    const row = mapMessage(raw, channel)
    const elements = await this.expandForwards(row.elements, row.id, budget)
    return { ...row, channelType, elements, content: toText(elements) }
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    void channelId
    await this.callApi('delete_msg', { message_id: String(messageId) })
  }

  async updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message> {
    void channelId
    void messageId
    void content
    throw new Error('OneBot v11 没有编辑消息的 action')
  }

  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    void channelId
    await this.callApi('set_msg_emoji_like', { message_id: String(messageId), emoji_id: emoji, set: true })
  }

  override async internal<T = any>(action: string, params: Record<string, unknown> = {}, options?: { timeoutMs?: number }): Promise<T> {
    if (this.status !== 'online') throw new BotStateError(this, action)
    return this.call(action, params, options)
  }

  private async callApi<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.status !== 'online') throw new BotStateError(this, action)
    return this.call(action, params)
  }

  private async deliver(action: string, target: { user_id?: string; group_id?: string }, content: unknown, options?: SendOptions): Promise<unknown> {
    const self = this.selfId
    const call = (method: string, params: Record<string, unknown>, retries?: number) => {
      if (this.status !== 'online' || this.selfId !== self) throw new BotStateError(this, method)
      return this.call(method, params, { timeoutMs: options?.timeoutMs, retries })
    }
    let message = content
    const markup = typeof content === 'string' ? /[<&]/.test(content) : isElement(content) || Array.isArray(content) && content.every(isElement)
    if (markup) {
      const elements = normalize(content as ElementSource)
      const resolved = this.speak && needsVoiceResolve(elements) ? await resolveVoice(elements, this.speak, this.log) : elements
      const segments = toOneBot(degrade(resolved, cap => this.supports(cap)))
      if (segments.some(seg => seg.type === 'poke')) {
        const receipts: unknown[] = []
        for (const step of planPokes(action, target, segments)) {
          const result = await call(step.action, step.params, 0)
          receipts.push(step.action === 'send_poke' ? { ok: true } : result)
        }
        return receipts.length === 1 ? receipts[0] : receipts
      }
      message = segments
    }
    if (message === '' || Array.isArray(message) && !message.length) return { ok: false, skipped: true }
    return call(action, { ...target, message })
  }
}



export function mapMessage(raw: any, channelId: string): Message {
  const elements = fromOneBot(raw?.message ?? raw?.raw_message ?? '')
  return {
    id: String(raw?.message_id ?? ''),
    channelId: String(channelId),
    userId: String(raw?.user_id ?? raw?.sender?.user_id ?? ''),
    userName: String(raw?.sender?.card || raw?.sender?.nickname || raw?.nickname || ''),
    content: toText(elements),
    elements,
    createdAt: Number(raw?.time) ? Number(raw.time) * 1000 : undefined,
    raw,
  }
}

