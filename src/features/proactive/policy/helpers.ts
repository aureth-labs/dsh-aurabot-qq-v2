// 策略源共用的小工具与常量：额度、时间键、JSON 读写。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const MINUTE = 60_000
export const VERSION = 1

// reserve 的 reason 全集（契约 §2），reasonText 只翻译这几个 + 'settled'
export const REASONS = ['quiet', 'budget', 'cooldown', 'busy', 'error', 'settled']
export const OUTCOMES = ['sent', 'queued', 'uncertain', 'failed']

export const REASON_TEXT = {
  quiet: '当前不宜开口（未启用 / 不在清醒时段 / 已被禁言）',
  budget: '今日额度已用完（生成尝试额度或逻辑发言额度）',
  cooldown: '还没到下次可开口的时间（间隔未到，或主人刚说完话）',
  busy: '另一次主动发言正在流程中',
  error: '策略源内部错误（读配置或读状态失败）',
  settled: '这次预占已经结算过了',
  'out-of-scope': '不是主人私聊（白名单朋友等各有各的额度，不归这套策略管）',
}

// ---------------- 小工具（自带实现，不依赖 src/core） ----------------

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 本地日期键（跨天重置次数用；与 purpose/engine.js 的 localDateKey 同口径）。 */
export function localDateKey(at) {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** dataDir 允许传字符串或函数（模块 api.dataDir 是函数），空值 → 内存模式。 */
export function resolveDir(dataDir) {
  if (!dataDir) return ''
  try {
    const v = typeof dataDir === 'function' ? dataDir() : dataDir
    return v ? String(v) : ''
  } catch {
    return ''
  }
}

/** now 允许传数字（冻结时间，测试友好）、函数（生产）或省略（Date.now）。 */
export function clockOf(now) {
  if (typeof now === 'function') {
    return () => {
      const t = Number(now())
      return Number.isFinite(t) ? t : Date.now()
    }
  }
  if (Number.isFinite(Number(now))) return () => Number(now)
  return () => Date.now()
}

export function readJsonFile(file, fallback) {
  if (!file) return fallback
  try {
    let text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** 先写临时文件再改名：断电/并发下不会留下半截 JSON；写失败只记日志，不影响内存态。 */
export function writeJsonFile(file, value, log) {
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
    writeFileSync(tmp, JSON.stringify(value), 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    log?.warn?.(`策略源落盘失败（不影响内存态）：${error?.message || error}`)
  }
}

let idSeq = 0
export function makeReserveId(name, at) {
  idSeq = (idSeq + 1) % 1e9
  return `${name}-${at.toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeOutcome(outcome) {
  const v = String(outcome ?? 'sent')
  return OUTCOMES.includes(v) ? v : 'sent'
}

/** 上限语义：0 / 负数 / 非法值 = 不限（Infinity）。purpose 的 dailyMax 就是这层语义。 */
export function unlimitedIfZero(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return Infinity
  return Math.round(n)
}