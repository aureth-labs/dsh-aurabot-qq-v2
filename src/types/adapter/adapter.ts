/**
 * 适配器契约：一个适配器就是「注册 bot → 连接 → 上线 → 可用 → 断开 → 下线」。
 *
 * 适配器不是宿主的内置特例，而是普通插件里调 `ctx.adapter(spec, config)`。
 * 宿主负责把它挂进 `ctx.bots`、发上线/下线事件、模块卸载时断开。
 */

import type { BotLike, Capability } from './bot.ts'
import type { Element } from '../core/element.ts'
import type { TargetType } from '../core/target.ts'

/**
 * 适配器收到一条平台消息后投给宿主的东西。
 *
 * 适配器只负责「翻译成这层」，不碰指令、中间件、模型——那些是宿主管线的事。
 * `content` 不写时由 `elements` 推纯文本；`elements` 不写时把 `content` 当一条 text。
 */
export interface InboundMessage {
  type: TargetType
  /** 群号 / 私聊用户号 / 频道号。 */
  channelId: string
  /** 发消息的人。 */
  userId: string
  userName?: string
  content?: string
  elements?: Element[]
  messageId?: string
  guildId?: string
  timestamp?: number
  /** 平台原始事件：核心不解析，原样转给模块。 */
  raw?: unknown
}

export interface AdapterRuntime {
  signal?: AbortSignal
  platform: string
  log: (message: string) => void
  /**
   * 收到消息就投进来。宿主负责建 Session、跑 `command → middleware → llm`。
   *
   * 连接握手中最多暂存 100 条消息与事件，注册后按到达顺序投递。
   */
  emitMessage(message: InboundMessage): void
  /** 非消息事件（加群、撤回、上线/下线……）原样转给模块。 */
  emitEvent?(event: string, payload: unknown): void
  /** 把 `<voice>` 里的文字合成音频；宿主没接 TTS 时返回空串。 */
  speak?(text: string): Promise<string>
  /** 宿主给这个平台的能力表：适配器可以用它回答 `bot.supports()`。 */
  supports?(capability: Capability): boolean
}

/** 面板「机器人列表」里一行的只读快照。 */
export interface AdapterInfo {
  platform: string
  id: string
  selfId: string
  status: string
  /** 适配器声明的显示名，没写就用 platform。 */
  name?: string
}

export interface AdapterSpec {
  /** 平台名，进 `Target.platform`：qq / discord / telegram …… */
  platform: string
  /**
   * 平台名要等读到配置才知道时用这个（比如 Satori 是协议层，真正的平台在配置里）。
   * 返回值优先于 `platform`。
   */
  resolvePlatform?(config: unknown): string | undefined
  /** 面板里展示的名字。 */
  name?: string
  /**
   * 这个适配器能渲染哪些元素。
   *
   * 宿主按它决定 `<voice>` / `<file>` 要不要降级成文字；不写就按 `bot.supports()` 逐条问。
   */
  capabilities?: Capability[]
  /**
   * 连接并返回**已经上线**的 bot。失败就抛错，宿主不会把它注册进 bots。
   * 顺序固定：连接成功 → 进注册表 → 发 online；连接失败什么都不留下。
   */
  connect(config: any, runtime: AdapterRuntime): Promise<BotLike>
  /** 断开连接。没实现时只从注册表摘掉。 */
  disconnect?(bot: BotLike, config: any): Promise<void>
}

export interface AdapterHandle {
  bot: BotLike
  /** 断开 + 摘注册表 + 发下线事件；重复调用无副作用。 */
  dispose(): Promise<void>
}

/**
 * 平台 API 的类型化入参。
 *
 * QQ 是 OneBot v11 的外置特例（字段名由协议定），Discord / Telegram 有自己的官方 API。
 * 各适配器把这些类型导出去，插件拿到平台专属 bot 之后就能看到参数提示。
 */

/** OneBot v11 发送消息的入参（QQ）。 */
export interface OneBotSendMessageParams {
  message_type?: 'private' | 'group'
  user_id?: string | number
  group_id?: string | number
  message: unknown
  auto_escape?: boolean
}

/** QQ 官方机器人 `POST /v2/groups/{group_openid}/messages` 的入参。 */
export interface QQOfficialMessageParams {
  /** 文本内容；markdown 时放 markdown 源。 */
  content: string
  /** 0 文本 / 2 markdown / 3 ark / 7 富媒体。 */
  msg_type: 0 | 2 | 3 | 7
  /** 被动回复必填：收到的那条消息 id。 */
  msg_id?: string
  /** 同一条 msg_id 的第几条回复，从 1 递增；重复会报错。 */
  msg_seq?: number
  markdown?: { custom_template_id?: string; content?: string }
  keyboard?: Record<string, unknown>
  media?: { file_uuid?: string; file_info?: string; ttl?: number }
}

/** Telegram Bot API `sendMessage` 的主要参数。 */
export interface TelegramSendMessageParams {
  chat_id: string | number
  text: string
  message_thread_id?: number
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML'
  entities?: TelegramMessageEntity[]
  link_preview_options?: { is_disabled?: boolean; url?: string }
  disable_notification?: boolean
  protect_content?: boolean
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean }
  reply_markup?: unknown
}

export interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  url?: string
  user?: unknown
}

/** Discord `POST /channels/{channel.id}/messages` 的主要参数。 */
export interface DiscordCreateMessageParams {
  content?: string
  nonce?: string | number
  tts?: boolean
  embeds?: DiscordEmbed[]
  allowed_mentions?: {
    parse?: Array<'roles' | 'users' | 'everyone'>
    roles?: string[]
    users?: string[]
    replied_user?: boolean
  }
  message_reference?: { message_id: string; channel_id?: string; guild_id?: string; fail_if_not_exists?: boolean }
  components?: unknown[]
  files?: unknown[]
}

export interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  image?: { url: string }
  thumbnail?: { url: string }
  footer?: { text: string; icon_url?: string }
  timestamp?: string
}
