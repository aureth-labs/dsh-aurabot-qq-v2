import { ownerRoom } from '../../../core/config/owners.ts'
// 出站治理的纯函数与类型：不碰状态，只做收敛与判定。

import { CAUSES, DEFAULT_TIER, TIERS } from './constants.ts'

export interface LedgerItem {
  deliveryId: string
  state: string
  key?: string
  at?: number
  ttl?: number
  updatedAt?: number
  moduleId?: string
  policySource?: string
  dropReason?: string
  failReason?: string
  [extra: string]: unknown
}

export interface Cause {
  kind: string
  raw: Record<string, any> | null
}

export interface OutboundStats {
  admitted: number
  allowed: number
  denied: number
  deferred: number
  passThrough: number
  committed: number
  released: number
  submitted: number
  errors: number
}

/** 从任意配置形状里取全局配置；外面传对象、函数、都没给都兜得住。 */
export function resolveConfig(getConfig: unknown): Record<string, any> {
  try {
    if (typeof getConfig === 'function') return getConfig() || {}
    return (getConfig as Record<string, any>) || {}
  } catch {
    return {}
  }
}

/** 读档位：只认 config.outboundPolicy.tier（兼容旧变量名 config.ext.outboundPolicy.tier），其余一律回落 pass。 */
export function readTier(cfg: Record<string, any>): string {
  const c = cfg || {}
  const raw = (c.outboundPolicy && c.outboundPolicy.tier) ??
    (c.ext && c.ext.outboundPolicy && c.ext.outboundPolicy.tier)
  const tier = String(raw ?? DEFAULT_TIER).trim().toLowerCase()
  return TIERS.includes(tier) ? tier : DEFAULT_TIER
}

export function readOwner(cfg: Record<string, any>): string {
  return ownerRoom(cfg || {})
}

export function normalizeTarget(to: unknown): string {
  if (to === null || to === undefined) return ''
  const s = String(to).trim()
  const m = /^private\s*:\s*(.*)$/i.exec(s)
  if (m) return `private:${String(m[1]).trim()}`
  return s
}

/** 幂等键：moduleId|itemId|to|channel（契约 L97）。 */
export function idempotentKey(moduleId: unknown, itemId: unknown, to: unknown, channel: unknown): string {
  return [moduleId, itemId, to, channel].map((x) => String(x ?? '')).join('|')
}

/** 文本字节数（按 UTF-8 计，8KB 上限用）。 */
export function textBytes(text: unknown): number {
  if (text === null || text === undefined) return 0
  return Buffer.byteLength(String(text), 'utf8')
}

let seq = 0
/** 生成一个稳定前缀的 id（不需要加密强度，够本地唯一即可）。 */
export function makeId(prefix: string, at?: number): string {
  seq = (seq + 1) % 1e9
  const stamp = Number.isFinite(at) ? Math.floor(at as number) : Date.now()
  return `${prefix}_${stamp.toString(36)}_${seq.toString(36)}`
}

/** 因果分类：无 cause / unknown 一律按 background 保守处理（契约 L87）。 */
export function normalizeCause(cause: unknown): Cause {
  if (!cause || typeof cause !== 'object') return { kind: 'background', raw: null }
  const source = cause as { kind?: unknown }
  const kindRaw = typeof source.kind === 'string' ? source.kind.trim().toLowerCase() : ''
  const kind = CAUSES.includes(kindRaw) ? kindRaw : 'background'
  return { kind, raw: cause }
}

/**
 * 判定一次发送是否「在治理范围内」。
 * 治理范围：发给主人私聊；delegation 与 reply 另有专门规则。
 */
export function isGovernedTarget(to: unknown, owner: string): boolean {
  return Boolean(owner) && normalizeTarget(to) === owner
}
