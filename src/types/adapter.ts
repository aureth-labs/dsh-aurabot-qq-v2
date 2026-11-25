/**
 * 适配器契约：一个适配器就是「注册 bot → 连接 → 上线 → 可用 → 断开 → 下线」。
 *
 * 适配器不是宿主的内置特例，而是普通插件里调 `ctx.adapter(spec, config)`。
 * 宿主负责把它挂进 `ctx.bots`、发上线/下线事件、模块卸载时断开。
 */

import type { BotLike } from './bot.ts'

export interface AdapterRuntime {
  platform: string
  log: (message: string) => void
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
  /** 面板里展示的名字。 */
  name?: string
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
