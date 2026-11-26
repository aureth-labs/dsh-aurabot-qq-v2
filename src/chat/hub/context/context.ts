// 聊天中枢的公共上下文：工作区常量、出站消息类型、模拟测试用的 AsyncLocalStorage、
// 以及几个不依赖 hub 实例的纯辅助。index.ts 负责装配，这里只放「谁都能用」的东西。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'
import { extractMarkedReply } from '../../reply/context/reply-marker.ts'

// QQ 会话的工作区目录，第一次收到消息时自动创建。面板「连接」页能改（config.workspaceDir，#32）；
// 没填就用环境变量 AURABOT_WORKSPACE，再没有：老安装沿用 C:\Aurabot\qq-chats，新安装放在用户目录下（不用往 C 盘根目录写）
export const LEGACY_WORKSPACE = 'C:\\Aurabot\\qq-chats'
export const MAX_IMAGE_BYTES = 1024 * 1024 * 1024 // 图片大小不设实际限制，只防把内存撑爆
export const MODEL_IMAGE_BYTES = 8 * 1024 * 1024 // 超过这个大小先缩小再给模型
export const MAX_MESSAGE_IMAGES = 8 // 一条消息最多给她看几张，合并转发里的图算在内
export const QUOTE_FORWARD_MAX_CHARS = 1200 // 引用里套的合并转发：正文本身就是那条消息，比普通引用的 300 字放宽；普通引用仍走 300
export const WORKSPACE_DIR = process.env.AURABOT_WORKSPACE || (existsSync(LEGACY_WORKSPACE) ? LEGACY_WORKSPACE : join(homedir(), 'Aurabot', 'qq-chats'))
/** 现在用的工作区目录：面板里填了就用填的，否则默认。 */
export const workspaceDirOf = (cfg) => String(cfg?.workspaceDir || '').trim() || WORKSPACE_DIR
export const WORKSPACE_TITLE = 'Aurabot · QQ'
export const SOURCE_KIND = 'aurabot'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const sessionKey = (id) => {
  const s = String(id ?? '')
  return s.startsWith('session-') ? s.slice(8) : s
}

/**
 * hooks（扩展模块用，都可以不传）：
 *   message(msg) → true 表示这条消息被模块接管了，她不再处理
 *   reply(text, {chatId}) → 改写她要发的话；返回 null 表示这次不发
 *   deniedTools() → 不许出现在她 QQ 会话里的全局工具名（给其他 DSH 会话用的联动工具）
 *   groupDecide(decision, info) → 改群聊「回不回、怎么回」的决定 { reply, mode, reason }
 *   prompt(content, info) → 改交给她的内容（文字 / 图片块）；返回 null 表示这次不交给她
 *   items(items, info) → 改拆好的回复（每条 { kind: text|voice|sticker|poke|image, value, replyTo }）
 *   send(message, info) → 改最终发出去的 OneBot 消息段；返回 null 表示不发
 *   model(selection, chat) → 这个聊天用哪个模型 { provider, model, reasoningEffort }（同步）；selection 已经按主人「按聊天选模型」的设置算过
 *   poke(event) → true 表示戳一戳被模块接管了
 */
/** 一条出站消息段（OneBot v11 形状；各平台由适配器翻译）。 */
export interface OutSegment {
  type: string
  data?: Record<string, any>
}
export type OutMessage = OutSegment[]

/** capture 期间记下的一次「发送」（模拟测试只记账不真发）。 */
export interface CapturedSend {
  chatId: string
  note: string
  message: OutMessage
}

/** 一轮投递期的固定快照：期间所有发送都归到这一轮。 */
export interface OutputScope {
  chatId: string
  sources: import('../../../security/leak-guard.ts').PromptSources
  incomingReply?: boolean
  sent: number
  sentTypes: Set<string>
  queuedTypes: Set<string>
  blocked: boolean
  allowPromptEcho: boolean
}

/** 一次拆条间隔的等待（卸载时统一结束）。 */
export interface ReplyWait {
  timer: NodeJS.Timeout
  reject: (error: Error) => void
}

/** 已挂载的会话：DSH agent ↔ QQ 会话。 */
export interface MountedRec {
  agent: any
  chat: any
  level: string
  chatId: string
  offs: Array<() => void>
  toolsKey: string
}

/** 群聊这一段交给她的内容（groupPrompt 的产物）。 */
/** 交给模型的一段内容块（文字 / 图片）。 */
export type ContentBlock = { type: string; text?: string; data?: string | Buffer; mediaType?: string; name?: string }

export interface GroupPromptResult {
  text: string
  query: string
  speakers: string[]
  autoReply: any
  directRequester: any
  images: any[]
  archiveMessages: Array<{ role: 'user'; text: string; speakerId: string; at?: number; id: string }>
  freshCount: number
}

/** 没有新内容时的空结果：调用方不用先判 null。 */
export const emptyGroupPrompt = (): GroupPromptResult => ({ text: '', query: '', speakers: [], autoReply: null, directRequester: null, images: [], archiveMessages: [], freshCount: 0 })

/** capture 期间记下的数组：模拟结束打 closed，继承到后台链上的旧上下文不能吞真实发送。 */
export type CapturedList = CapturedSend[] & { closed?: boolean }

// 模拟测试：这里面发出去的消息只记下来，不真发
export const captureStore = new AsyncLocalStorage<CapturedList>()
// 只承认仍在进行的模拟调用：AsyncLocalStorage 会被宿主长生命周期异步链继承。
export const activeCapture = (): CapturedList | null => {
  const cap = captureStore.getStore()
  return cap && !cap.closed ? cap : null
}
// 模拟测试专用：capture 只拦发送还不够，模块自己写流水时也要拦住。
export const simulationStore = new AsyncLocalStorage<boolean>()
export const failStore = new AsyncLocalStorage<string[]>() // deliver 这一次里发失败的原因，好让调用方如实告诉她
/**
 * 一轮结束时该发到 QQ 的文字：只认「这一轮最后一条 assistant 消息」里的 text 块。
 *
 * 带工具调用的 assistant 消息默认是过程性发言（模型在调工具前写的计划/心里话），不是给用户看的回复，
 * 一律丢弃——否则会出现「模型把自己的思考发出来」。
 * 但有一个例外：模型明确用 ⟦REPLY⟧ 标记包住的文本是它特意要发的话（正文标记由代码注入提示），
 * 这种情况放行，交给 turn/end 的标记剥离再发出去；没标记的照旧丢弃。
 */
export function assistantReplyText (message) {
  if (!message || !Array.isArray(message.content)) return ''
  const text = message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
  const hasToolCall = message.content.some((b) => b && (b.type === 'tool-call' || b.type === 'tool_use'))
  if (hasToolCall) return extractMarkedReply(text).found ? text : ''
  return text
}

/**
 * 网关真给了 message_id 才算「真发出去」：模拟返回（sim-*）和排进补发队列都不算。
 * 主动分享记账、群分享额度都按这个判，别各写一份。
 */
export function reallySent (r) {
  return Boolean(r) && r.message_id !== undefined && !String(r.message_id).startsWith('sim-')
}

/**
 * 聊天流水里的图片：只留能长期重建下载地址的稳定字段。
 * 图片段自带的 url 里含 rkey，一小时左右就过期，光存 url 等于没存；
 * 换成文件 id 之后随时能用网关当前的 rkey 拼回来（qq_api_call 的 get_msg 会现取现用）。
 */
export function chatImageRefs(segs, cap = 4) {
  const out = []
  for (const s of Array.isArray(segs) ? segs : []) {
    if (s?.type !== 'image') continue
    const d = s.data ?? {}
    let appid = ''
    let fileid = ''
    try {
      const u = new URL(String(d.url ?? ''))
      appid = u.searchParams.get('appid') ?? ''
      fileid = u.searchParams.get('fileid') ?? ''
    } catch (error) {}
    if (!appid || !fileid) continue
    out.push({ appid, fileid, ...(d.file ? { file: String(d.file).slice(0, 80) } : {}) })
    if (out.length >= cap) break
  }
  return out
}

