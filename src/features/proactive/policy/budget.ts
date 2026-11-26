// 共享预算域：按 ownerQQ 一份，两个策略源竞争同一份额度。

import { join } from 'node:path'
import { clampInt, clockOf, isPlainObject, localDateKey, readJsonFile, resolveDir, writeJsonFile, MINUTE, VERSION } from './helpers.ts'

export interface CreateSharedBudgetOptions {
  ownerQQ?: string
  dataDir?: string
  now?: () => number
  log?: (message: string) => void
  dailyMax?: number
  minGapMs?: number
}

export interface SetLimitsOptions { source?: string; dailyMax?: number; minGapMs?: number; sharedDailyMax?: number }
export interface TryAcquireOptions { reserveId?: string; source?: string; at?: number }
export interface SettleOptions { refund?: boolean; at?: number }

// ---------------- 共享预算域（按 ownerQQ 唯一） ----------------

const BUDGET_REGISTRY = new Map()

function normalizeBudgetState(raw, at, ownerQQ) {
  const src = isPlainObject(raw) ? raw : {}
  const s = {
    version: VERSION,
    ownerQQ: String(ownerQQ ?? ''),
    day: typeof src.day === 'string' ? src.day : localDateKey(at),
    used: clampInt(src.used, 0, 0, 99999),
    lastSettledAt: Number(src.lastSettledAt) || 0,
    // 全局共享硬上限（默认不限）；各策略源自己的日额度仍在策略源内判，避免互相削额度
    dailyMax: Number(src.dailyMax) > 0 ? Math.round(Number(src.dailyMax)) : 0,
    minGapMs: clampInt(src.minGapMs, 0, 0, 24 * 60 * MINUTE),
    sourceLimits: {},
    inFlight: [], // 预占中；**不落盘生效**——重启一律视为未结算，见 persist()
  }
  const limits = isPlainObject(src.sourceLimits) ? src.sourceLimits : {}
  for (const [name, lim] of Object.entries(limits)) {
    if (!isPlainObject(lim)) continue
    s.sourceLimits[name] = {
      dailyMax: clampInt((lim as any).dailyMax, 0, 0, 999),
      minGapMs: clampInt((lim as any).minGapMs, 0, 0, 24 * 60 * MINUTE),
    }
  }
  return s
}

/**
 * 共享预算域：两个策略源抢同一份「按 ownerQQ 的逻辑发言额度」。
 *
 * 语义：
 *   · 占用口径 = `used`（已结算的逻辑发言数）+ `inFlight`（已预占未结算）；
 *   · 硬上限 `dailyMax` 默认不限（0），只由显式配置打开（config.ext.outboundPolicy.sharedDailyMax
 *     或构造参数 dailyMax）；各策略源自己的日额度由策略源自己判——否则一个源设得严就会
 *     把另一个源的额度一起削掉；
 *   · 同一时刻最多一个逻辑发言获授权（inFlight ≤ 1）→ 两个引擎不会同时开口；
 *   · 结算：`settle(id, {refund:false})` 记一次占用；`settle(id, {refund:true})` 只退还预占；
 *   · 重启：`used` 保留（额度不被重复授予），`inFlight` 丢弃（在途结果未知，不额外扣也不补发）。
 *
 * 单例：同进程内 `${dataDir}|${ownerQQ}` 唯一，两个策略源各建一次拿到的仍是同一份域。
 */
export function createSharedBudget({ ownerQQ, dataDir, now, log, dailyMax, minGapMs } : CreateSharedBudgetOptions = {}) {
  const clock = clockOf(now)
  const dir = resolveDir(dataDir)
  const owner = String(ownerQQ ?? '')
  const regKey = `${dir || '<memory>'}|${owner}`
  if (BUDGET_REGISTRY.has(regKey)) return BUDGET_REGISTRY.get(regKey)

  const file = () => (dir ? join(dir, 'shared-budget.json') : '')
  const t0 = clock()
  const state = normalizeBudgetState(readJsonFile(file(), null), t0, owner)
  if (Number(dailyMax) > 0) state.dailyMax = Math.round(Number(dailyMax))
  if (Number(minGapMs) > 0) state.minGapMs = Math.round(Number(minGapMs))

  const persist = () => writeJsonFile(file(), { ...state, inFlight: [] }, log)

  function rollDay(at) {
    const day = localDateKey(at)
    if (state.day !== day) {
      state.day = day
      state.used = 0
      state.lastSettledAt = 0
    }
  }

  /** 硬上限快照：globalDailyMax = 共享域自己的上限；minGapMs = 全局最小间隔。 */
  function limits() {
    return {
      dailyMax: state.dailyMax > 0 ? state.dailyMax : Infinity,
      minGapMs: Math.max(0, Number(state.minGapMs) || 0),
    }
  }

  /**
   * 记录/更新某个策略源的自报额度（只做记账与面板展示，不参与共享硬上限判定）。
   * sharedDailyMax：显式给共享域设上限（传 0 表示恢复不限）。
   */
  function setLimits({ source, dailyMax: srcDailyMax, minGapMs: srcMinGap, sharedDailyMax } : SetLimitsOptions = {}) {
    const name = String(source ?? '').trim() || 'unknown'
    state.sourceLimits[name] = {
      dailyMax: clampInt(srcDailyMax, 0, 0, 999),
      minGapMs: clampInt(srcMinGap, 0, 0, 24 * 60 * MINUTE),
    }
    if (sharedDailyMax !== undefined && sharedDailyMax !== null) {
      const n = Number(sharedDailyMax)
      state.dailyMax = Number.isFinite(n) && n > 0 ? Math.round(n) : 0
    }
    return limits()
  }

  /**
   * 原子预占一份共享逻辑发言额度（同步）。
   * 判定顺序：日额度 → 冷却 → 并发（最多一个在途）。额度先于并发检查，
   * 这样「抢最后一个额度」失败的一方拿到的是 budget 而不是笼统的 busy。
   */
  function tryAcquire({ reserveId, source, at } : TryAcquireOptions = {}) {
    const t = Number(at) || clock()
    rollDay(t)
    const lim = limits()
    const usedTotal = state.used + state.inFlight.length
    if (usedTotal >= lim.dailyMax) {
      return { ok: false, reason: 'budget', detail: `shared:${usedTotal}/${lim.dailyMax}`, source: String(source ?? '') }
    }
    if (lim.minGapMs > 0 && state.lastSettledAt > 0 && t - state.lastSettledAt < lim.minGapMs) {
      return { ok: false, reason: 'cooldown', detail: 'shared:min-gap', source: String(source ?? '') }
    }
    if (state.inFlight.length >= 1) {
      return { ok: false, reason: 'busy', detail: 'shared:in-flight', source: String(source ?? '') }
    }
    state.inFlight.push({ reserveId: String(reserveId ?? ''), source: String(source ?? ''), at: t })
    persist()
    return { ok: true, day: state.day, used: state.used }
  }

  /**
   * 结算一份预占。
   * refund=true  → 退还预占（未发送释放；不计占用）
   * refund=false → 计入一次逻辑发言占用（sent/queued/uncertain/策略源自定的失败口径）
   */
  function settle(reserveId, { refund = false, at } : SettleOptions = {}) {
    const t = Number(at) || clock()
    rollDay(t)
    const idx = state.inFlight.findIndex((x) => x.reserveId === String(reserveId ?? ''))
    if (idx < 0) return { ok: false, reason: 'settled', detail: 'unknown-reserve' }
    state.inFlight.splice(idx, 1)
    if (!refund) {
      state.used += 1
      state.lastSettledAt = t
    }
    persist()
    return { ok: true, used: state.used, refund: Boolean(refund) }
  }

  function snapshot() {
    const lim = limits()
    return {
      ownerQQ: owner,
      day: state.day,
      used: state.used,
      inFlight: state.inFlight.map((x) => ({ ...x })),
      remaining: Math.max(0, lim.dailyMax - (state.used + state.inFlight.length)),
      limits: lim,
      sourceLimits: JSON.parse(JSON.stringify(state.sourceLimits)),
      file: file(),
    }
  }

  const budget = {
    ownerQQ: owner,
    kind: 'shared-budget',
    limits,
    setLimits,
    tryAcquire,
    settle,
    snapshot,
  }
  BUDGET_REGISTRY.set(regKey, budget)
  return budget
}

/** 重启/测试用：清掉进程内共享预算单例（不影响已落盘文件）。 */
export function resetSharedBudgets() {
  BUDGET_REGISTRY.clear()
}