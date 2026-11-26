// 她的小闹钟：对话里设定的一次性提醒。到点只把她叫醒（进主人私聊的真实会话），不替她发消息。

import type { OwnerChannel } from '../../owners.ts'
import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../../../../../src/core/store/index.ts'

export interface CreateRemindersOptions {
  getConfig: () => Record<string, any>
  log: { info(message: string): void; warn(message: string, error?: unknown): void }
  hub: Record<string, any>
  primaryIdentity?: () => unknown
  channel?: OwnerChannel
  clean?: (text: string) => string
  purposeDir: (...parts: string[]) => string
}

export function createReminders({ getConfig, log, hub, purposeDir, channel, clean, primaryIdentity }: CreateRemindersOptions) {
  const REMINDER_GRACE_MS = 15 * 60_000
  const REMINDER_RETRY_MS = 5 * 60_000
  const REMINDER_WAIT_MS = 4 * 60_000
  let reminderBusy = false
  const remindersFile = () => purposeDir('reminders.json')
  const two = (n) => String(n).padStart(2, '0')
  const reminderText = (at) => {
    const d = new Date(at)
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
  }
  function parseReminderTime(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(value || '').trim())
    if (!m) return 0
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])
      || d.getHours() !== Number(m[4]) || d.getMinutes() !== Number(m[5])) return 0
    return d.getTime()
  }
  function normalizeReminder(raw) {
    if (!raw || typeof raw !== 'object') return null
    const id = String(raw.id || '').trim()
    const at = Number(raw.at)
    const note = String(raw.note || '').trim().slice(0, 500)
    if (!id || !Number.isFinite(at) || !note) return null
    return {
      id,
      owner: String(raw.owner ?? ''),
      at,
      atText: String(raw.atText || '').trim() || reminderText(at),
      note,
      createdAt: Number(raw.createdAt) || at,
      attempts: Math.max(0, Math.round(Number(raw.attempts) || 0)),
      nextAt: Number(raw.nextAt) || at,
      expiresAt: Number(raw.expiresAt) || at + REMINDER_GRACE_MS,
      lastError: String(raw.lastError || '').slice(0, 180),
    }
  }
  function loadReminders() {
    // 新文件存在（哪怕存的是空数组）就只认新文件：首写后旧文件冻结
    const fresh = readJson(remindersFile(), null)
    const raw = Array.isArray(fresh) ? fresh : channel ? [] : (() => {
      const legacy = readJson(dataDir('speakup-reminders.json'), null)
      return Array.isArray(legacy) ? legacy : []
    })()
    const reminders = raw.map(normalizeReminder).filter(Boolean)
    const owner = channel?.target.id || String(getConfig().ownerQQ || '')
    if (owner && reminders.some(row => !row.owner)) {
      for (const row of reminders) row.owner ||= owner
      saveReminders(reminders)
    }
    return reminders
  }
  function saveReminders(list) { writeJson(remindersFile(), list) }
  function pruneReminders(now = Date.now()) {
    const raw = loadReminders()
    const live = raw.filter((r) => r.expiresAt > now)
    if (live.length !== raw.length) saveReminders(live)
    return live
  }
  const reminderList = (now = Date.now()) => pruneReminders(now).sort((a, b) => a.at - b.at)
  /** 小闹钟的总闸：插件总开关 + 目的引擎未显式关 + 主人在面板开了「小闹钟」开关。 */
  function remindersOn(cfg = getConfig()) {
    return Boolean(cfg.enabled) && !cfg.debug && ((cfg.ext && cfg.ext.purpose) || {}).enabled !== false && cfg.speakUp?.reminderEnabled === true
  }
  function addReminder(value, noteText) {
    const cfg = getConfig()
    if (!cfg.enabled) return { ok: false, message: '插件总开关没开启' }
    if (((cfg.ext && cfg.ext.purpose) || {}).enabled === false) return { ok: false, message: '目的引擎没开启' }
    if (!cfg.speakUp?.reminderEnabled) return { ok: false, message: '小闹钟没开启' }
    const at = parseReminderTime(value)
    if (!at) return { ok: false, message: '时间格式不对，要用 yyyy-mm-dd HH:MM，例如 2026-11-12 17:30' }
    const now = Date.now()
    if (at <= now) return { ok: false, message: '这个时间已经过去了，请设一个将来的时间' }
    const note = String(noteText || '').trim().slice(0, 500)
    if (!note) return { ok: false, message: '要提醒自己什么？把想说的话写进 note' }
    const live = pruneReminders(now)
    if (live.length >= (cfg.speakUp.reminderLimit ?? 5)) return { ok: false, message: '你设定的提醒太多了' }
    const reminder = {
      id: randomUUID(),
      owner: channel?.target.id || String(cfg.ownerQQ || ''),
      at,
      atText: reminderText(at),
      note,
      createdAt: now,
      attempts: 0,
      nextAt: at,
      expiresAt: at + REMINDER_GRACE_MS,
      lastError: '',
    }
    saveReminders([...live, reminder])
    log.info(`小闹钟：${reminder.atText} ${note}`)
    return { ok: true, id: reminder.id, at: reminder.atText, message: `已记下，${reminder.atText} 叫醒你` }
  }
  function closeReminder(id) {
    const key = String(id || '').trim()
    const live = pruneReminders()
    if (!key || !live.some((r) => r.id === key)) return { ok: false, message: '没找到这个提醒，可能已经过期或关闭了' }
    saveReminders(live.filter((r) => r.id !== key))
    return { ok: true, message: '这个小闹钟已关闭' }
  }
  function reminderPrompt(reminder, owner) {
    return `【系统提醒，不是${owner}说的话】你之前给自己定的小闹钟到时间了：${reminder.atText}「${reminder.note}」。现在可以主动找${owner}说这件事；如果你觉得现在不适合打扰，就只回 [沉默]。`
  }
  async function attemptReminder(reminder, now = Date.now()) {
    const cfg = getConfig()
    const owner = channel?.target.id || String(cfg.ownerQQ || '')
    if (!owner || !remindersOn(cfg)) return
    if (reminder.owner && reminder.owner !== owner) { closeReminder(reminder.id); return }
    const primary = primaryIdentity?.()
    const stillPending = () => remindersOn() && loadReminders().some(row => row.id === reminder.id) &&
      (channel ? channel.available() : (primaryIdentity?.() === primary && String(getConfig().ownerQQ || '') === owner))
    async function dispatch() {
      const prompt = reminderPrompt(reminder, cfg.ownerName || '主人')
      const room = 'private:' + owner
      if (channel?.busy()) return { ok: false, error: '私聊忙或账号离线' }
      const turn = channel ? { ok: true, raw: await channel.generate(prompt) }
        : await hub.runTurnInChat(room, prompt, { noTools: true, timeoutMs: REMINDER_WAIT_MS, kind: 'reminder', suppressDelivery: true })
      if (!turn.ok) return { ok: false, error: turn.error || turn.reason }
      if (!stillPending()) return { ok: false, error: '提醒已撤销或目标已变更' }
      const text = clean(turn.raw || '')
      if (!text) return { ok: true }
      const sent = channel ? await channel.send(text) : (await hub.deliver(room, text, { userText: '小闹钟' }))?.sent
      return { ok: Boolean(sent), error: '投递未确认' }
    }
    const outcome = await dispatch().catch(error => ({ ok: false, error: error.message }))
    const live = loadReminders()
    const current = live.find((r) => r.id === reminder.id)
    if (!current) return
    if (outcome.ok) {
      saveReminders(live.filter((r) => r.id !== reminder.id))
      log.info(`小闹钟触发：${reminder.atText} ${reminder.note}`)
      return
    }
    const retry = cfg.speakUp?.reminderRetry !== false
    const at = Date.now()
    if (!retry) {
      saveReminders(live.filter((r) => r.id !== reminder.id))
      log.warn(`小闹钟放弃：${reminder.atText} ${outcome.error || '触发失败'}`)
      return
    }
    // 第一次失败后从现在起保留 15 分钟；之后每 5 分钟再试。
    if (current.attempts === 0) current.expiresAt = at + REMINDER_GRACE_MS
    if (at + REMINDER_RETRY_MS >= current.expiresAt) {
      saveReminders(live.filter((r) => r.id !== reminder.id))
      log.warn(`小闹钟放弃：${reminder.atText} ${outcome.error || '触发失败'}`)
      return
    }
    current.attempts += 1
    current.nextAt = at + REMINDER_RETRY_MS
    current.lastError = String(outcome.error || '触发失败').slice(0, 180)
    saveReminders(live)
    log.warn(`小闹钟触发失败，5 分钟后重试：${reminder.atText}（${current.lastError}）`)
  }
  async function tickReminders(now = Date.now()) {
    if (reminderBusy) return false
    const cfg = getConfig()
    if (!remindersOn(cfg)) return false
    const due = reminderList(now).find((r) => r.nextAt <= now)
    if (!due) return false
    reminderBusy = true
    try { await attemptReminder(due, now) } finally { reminderBusy = false }
    return true
  }

  return { addReminder, closeReminder, reminderList, tickReminders }
}
