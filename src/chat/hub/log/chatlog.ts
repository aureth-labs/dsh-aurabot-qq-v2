// 聊天流水：写一行、按天读、删一天、重启后回捞主动发言。
// 只依赖传进来的取配置 / 取目录 / 清理规则，不碰 hub 的其他状态。

import { mkdirSync } from 'node:fs'
import { messageLogOf } from '../../../core/store/messages.ts'
import { redact } from '../../../core/support/log/redact.ts'
import { parseMemoryCommand } from '../../../features/memory/index.ts'
import { cleanOutboundText } from '../../reply/index.ts'
import { simulationStore } from '../context/context.ts'
import { chatImageRefs } from '../context/context.ts'

/** 写一条聊天流水。 */
export interface LogChatOptions {
  /** 来自哪个平台（记忆模块据此区分来源） */
  via?: string
  /** 这条消息的时间戳；缺省用现在 */
  at?: number
  /** 这一段互动涉及的 QQ 号（面板回放用） */
  interaction?: unknown[]
  originId?: string
  proactive?: string
  images?: unknown[]
  mid?: string
}

/** 主动发言的标记参数。 */
export interface NoteProactiveOptions {
  proactiveCause?: string
}

export interface ChatLogDeps {
  getConfig: () => any
  log: any
  hooks?: any
  /** chatId → 别处安排她说的话 */
  saidElsewhere: Map<string, Array<{ at: number; text: string }>>
  /** chatId → 已从流水回捞过的最大时间戳 */
  proactiveLogAt: Map<string, number>
  isBeforeMemoryReset: (chatId: string, uid?: string, at?: number) => boolean
  chatDir: (pid?: string) => string
  chatMemoryCutoff: (chatId: string, uid?: string) => number
  cleaningFor: (chatId: string) => any
}

export function createChatLog(deps: ChatLogDeps) {
  const { getConfig, log, hooks, saidElsewhere, proactiveLogAt, isBeforeMemoryReset, chatDir, chatMemoryCutoff, cleaningFor } = deps
  let revision = 0

  function logChat(chatId: string, who: string, text: string, uid = '', { via, at, interaction, originId, proactive, images, mid }: LogChatOptions = {}) {
    // 模块「模拟测试」的 simulation 上下文：只回放给面板看，不能写真实聊天流水。
    if (simulationStore.getStore() || isBeforeMemoryReset(String(chatId), uid, at ?? Date.now())) return false
    // 调试模式：不写聊天流水，只进插件日志。流水是长期记忆的原料，写了就等于把调试对话记进记忆。
    if (getConfig().debug) {
      log.info(`[调试] ${who}${uid ? '（' + uid + '）' : ''} → ${chatId}：${String(text || '').slice(0, 300)}`)
      return
    }
    try {
      // noteVia 直接写入其他平台的流水；QQ 回复已在投递路径清洗。
      if (who === 'bot' && via) {
        text = cleanOutboundText(text, cleaningFor(chatId))
        if (!text.trim()) return false
      }
      const timestamp = Number(at) > 0 && Number.isFinite(Number(at)) && Number.isFinite(new Date(Number(at)).getTime()) ? Number(at) : Date.now()
      const d = new Date(timestamp)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dir = chatDir()
      mkdirSync(dir, { recursive: true })
      const forgotten = String(chatId).startsWith('private:') && getConfig().memory?.enabled && getConfig().memory?.instantCommands !== false && parseMemoryCommand(text)?.action === 'forget'
      const pics = chatImageRefs(images)
      const row = { t: timestamp, chatId, who, ...(uid ? { uid: String(uid) } : {}), text: redact(String(text).slice(0, 500)), ...(mid ? { mid: String(mid) } : {}), ...(pics.length ? { images: pics } : {}), ...(via ? { via } : {}), ...(proactive ? { proactive } : {}), ...(interaction?.length ? { interaction: [...new Set(interaction.map(String))] } : {}), ...(forgotten ? { forgottenAt: Date.now() } : {}) }
      messageLogOf(dir).append(day, row)
      revision++
      try { hooks?.journal?.({ ...row, ...(originId ? { originId } : {}) }) } catch (error) { log.warn('流水通知失败：', error.message) }
      return true
    } catch (error) { return false }
  }

  /** 她在 QQ 之外说的话（桌宠气泡）：记进这个聊天，对方在 QQ 回她时她知道在接哪句（#133）。 */
  function noteSaid(chatId: string, text: string) {
    logChat(chatId, 'bot', text)
    saidElsewhere.set(chatId, [...(saidElsewhere.get(chatId) || []), { at: Date.now(), text: String(text).slice(0, 300) }].slice(-5))
  }

  /**
   * 主动发出的话（刷B站分享、群分享、私聊问询……）也要在目标聊天留痕：
   * 写一条聊天流水 + 记进「别处说过」桥接，主人下次在这个聊天里接话时她才知道自己刚发过什么。
   * 只在该条消息真发出去之后调用；试运行、补发队列、失败都不记。
   */
  function noteProactive(chatId: string, message: any, opts: NoteProactiveOptions = {}) {
    const said = (Array.isArray(message) ? message : [])
      .map((s) => {
        const type = s && s.type
        if (type === 'text') return String(s.data?.text || '')
        if (type === 'image') return '[图片]'
        if (type === 'file') return '[文件]'
        if (type === 'record') return '[语音]'
        return ''
      })
      .filter(Boolean)
      .join(' ')
      .trim()
    if (!said) return
    // 用独立字段 proactive 标记，不占 via —— via 在记忆模块里是「来自哪个平台」的语义
    logChat(chatId, 'bot', said, '', { proactive: String(opts.proactiveCause || 'proactive') })
    saidElsewhere.set(chatId, [...(saidElsewhere.get(chatId) || []), { at: Date.now(), text: said.slice(0, 300) }].slice(-5))
  }

  function chatLogDays(pid?: string) {
    try { return messageLogOf(chatDir(pid)).days() } catch (error) { return [] }
  }

  function deleteChatLog(day: string, pid?: string) {
    try { messageLogOf(chatDir(pid)).remove(day); revision++ } catch (error) {}
  }

  function chatLogOf(day: string, pid?: string) {
    try {
      return messageLogOf(chatDir(pid)).read(day).map((row) => {
        const rowCutoff = chatMemoryCutoff(String(row.chatId || ''), row.uid)
        if (rowCutoff && (Number(row.t) || 0) <= rowCutoff) return { ...row, text: '', forgottenAt: row.forgottenAt || rowCutoff }
        return row
      })
    } catch (error) {
      return []
    }
  }

  // 重启后把「主动发出过」（带 proactive 标记）的 bot 行捞回来，同一个聊天只补一次。
  const proactiveQueried = new Set<string>()
  function proactiveFromChatLog(chatId: string) {
    if (proactiveQueried.has(chatId)) return []
    proactiveQueried.add(chatId)
    const since = Math.max(Date.now() - 24 * 3600_000, proactiveLogAt.get(chatId) || 0)
    const days = [0, 1].map((n) => {
      const d = new Date(Date.now() - n * 86400_000)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    const rows = [...new Set(days)].flatMap((day) => chatLogOf(day))
      .filter((r) => r && r.chatId === chatId && r.who === 'bot' && r.proactive && !r.forgottenAt && Number(r.t) > since)
      .sort((a, b) => Number(a.t) - Number(b.t))
      .slice(-5)
    if (!rows.length) return []
    proactiveLogAt.set(chatId, Number(rows[rows.length - 1].t))
    return rows.map((r) => ({ at: Number(r.t), text: String(r.text || '') }))
  }

  return {
    logChat, noteSaid, noteProactive, chatLogDays, deleteChatLog, chatLogOf, proactiveFromChatLog,
    bumpRevision: () => { revision++ },
    revision: () => revision,
  }
}
