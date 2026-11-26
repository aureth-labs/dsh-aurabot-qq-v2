// One scheduler per running voice backend. Key material never appears in errors or logs.

/** 支持「多账号轮换」的云端语音后端。 */
export const cloudProviders = ['fish-free', 'breeze', 'minimax', 'volcano', 'http'] as const
export type CloudProvider = typeof cloudProviders[number]

/** 池子里的一条账号。 */
export interface KeyAccount {
  id: string
  name: string
  /** 只有 http 引擎用：这个账号对应的接口地址。 */
  origin?: string
  apiKey: string
  /** 面板回显用：这个账号有没有填过密钥（回显时 apiKey 会被清空）。 */
  apiKeySet?: boolean
}

/** 一个后端的账号池。 */
export interface KeyPool {
  strategy: 'balanced' | 'ordered'
  accounts: KeyAccount[]
}

/** 所有后端的池子；没配的后端就是没有键。 */
export type KeyPools = Partial<Record<CloudProvider, KeyPool>>

/** 配置文件里可能出现的任意形状（手改过的配置）。 */
export type RawPool = { strategy?: unknown; accounts?: unknown } | null | undefined
export type RawPools = Partial<Record<CloudProvider, RawPool>>

/** 面板传来的账号行（未校验）。 */
interface RawAccount { id?: unknown; name?: unknown; origin?: unknown; apiKey?: unknown }

/** 语音服务返回的错误上我们会读这几个字段。 */
export interface ProviderError {
  status?: number
  retryAfter?: string | null
  shared?: boolean
}

/** 一个 key 的调度状态。 */
interface KeySlot { busy: number; turn: number; until: number }

export function normalizePools (raw: RawPools | null | undefined): KeyPools {
  const out: KeyPools = {}
  for (const id of cloudProviders) {
    const pool = raw?.[id]
    if (!pool || typeof pool !== 'object') continue
    const seen = new Set<string>()
    const accounts: KeyAccount[] = []
    for (const row of (Array.isArray(pool.accounts) ? pool.accounts : []) as RawAccount[]) {
      if (!row || typeof row.id !== 'string' || !/^[\w-]{1,80}$/.test(row.id) || seen.has(row.id)) continue
      seen.add(row.id)
      accounts.push({
        id: row.id,
        name: String(row.name || '').trim().slice(0, 80),
        ...(id === 'http' && { origin: String(row.origin || '') }),
        apiKey: String(row.apiKey || '').trim(),
      })
    }
    out[id] = { strategy: pool.strategy === 'ordered' ? 'ordered' : 'balanced', accounts }
  }
  return out
}

export function maskPools (pools: KeyPools | undefined): void {
  for (const p of Object.values(pools || {})) {
    for (const a of p?.accounts || []) { a.apiKeySet = Boolean(a.apiKey); a.apiKey = '' }
  }
}

// A blank password means unchanged for this (provider, row ID), never the row at the same index.
export function restorePoolKeys (next: KeyPools, previous: KeyPools | undefined, incoming: RawPools | null | undefined): void {
  for (const id of cloudProviders) {
    const pool = incoming?.[id]
    const rows = Array.isArray(pool?.accounts) ? pool.accounts as RawAccount[] : null
    if (!rows) continue
    const old = new Map((previous?.[id]?.accounts || []).map(a => [a.id, a.apiKey]))
    const previousRows = previous?.[id]?.accounts || []
    next[id] = {
      ...next[id],
      strategy: next[id]?.strategy || 'balanced',
      accounts: rows.map(a => ({
        id: String(a?.id ?? ''),
        name: String(a?.name ?? ''),
        ...(id === 'http' && !a?.apiKey && { origin: previousRows.find(x => x.id === a?.id)?.origin || String(a?.origin ?? '') }),
        apiKey: a?.apiKey === null ? '' : String(a?.apiKey || old.get(String(a?.id ?? '')) || ''),
      })),
    }
  }
}

export function retryDelay (header: unknown, now: number): number | null {
  const h = String(header ?? '').trim()
  if (/^\d+(?:\.\d+)?$/.test(h)) { const ms = Number(h) * 1000; if (Number.isFinite(ms)) return ms }
  const date = /[a-z]/i.test(h) ? Date.parse(h) : NaN
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

/** 请求的回率信息：状态码、Retry-After、是不是全局共享额度。 */
export interface RateMeta { status: number; retryAfter: string | null; shared: boolean }

export function rateMeta (response: Response, status = response.status): RateMeta {
  const scope = response.headers.get('x-ratelimit-scope') || response.headers.get('ratelimit-scope') || ''
  return {
    status,
    retryAfter: response.headers.get('retry-after'),
    shared: /^(?:global|shared|service|org(?:anization)?|ip)$/i.test(scope) || response.headers.get('x-ratelimit-global') === 'true',
  }
}

/** 一次带 key 的请求；key 为空表示不轮换，直接用后端自己的配置。 */
export type KeyRequest<T> = (key?: string) => Promise<T>

export function createKeyRouter (now: () => number = Date.now) {
  const states = new Map<string, { keys: Map<string, KeySlot>; until: number }>()
  let serial = 0
  return async function run<T> (id: string, primary: string | undefined, pool: KeyPool | undefined, request: KeyRequest<T>, trackSingle = false): Promise<T> {
    // Without additional accounts preserve the original provider's own errors and retry behavior.
    const extra = (pool?.accounts?.map(a => a.apiKey?.trim()).filter(Boolean) || []) as string[]
    if (!extra.length && (!primary || (!trackSingle && !states.has(id)))) return request(primary)
    const keys = [...new Set([primary?.trim(), ...extra].filter(Boolean))] as string[]
    let state = states.get(id)
    if (!state) { state = { keys: new Map(), until: 0 }; states.set(id, state) }
    for (const key of state.keys.keys()) {
      const slot = state.keys.get(key)
      if (!keys.includes(key) && slot && !slot.busy && slot.until <= now()) state.keys.delete(key)
    }
    const entries = keys.map(key => {
      let slot = state.keys.get(key)
      if (!slot) { slot = { busy: 0, turn: 0, until: 0 }; state.keys.set(key, slot) }
      return { key, slot }
    })
    const tried = new Set<KeySlot>()
    const start = now()
    let last: number | undefined
    while (now() >= state.until) {
      const candidates = entries.filter(({ slot }) => !tried.has(slot) && slot.until <= now())
      if (pool?.strategy !== 'ordered') candidates.sort((a, b) => a.slot.busy - b.slot.busy || a.slot.turn - b.slot.turn)
      if (!candidates.length || tried.size >= 4 || (tried.size && now() - start >= 5000)) break
      const { key, slot } = candidates[0]
      tried.add(slot)
      slot.busy++
      slot.turn = ++serial
      try { return await request(key) } catch (error) {
        const e = error as ProviderError
        const at = now()
        const ms = retryDelay(e?.retryAfter, at)
        const code = Number(e?.status ?? 0)
        if ((e?.shared && code === 429) || code >= 500) {
          state.until = Math.max(state.until, at + (ms ?? (code === 429 ? 30000 : 5000)))
          throw error
        }
        if (![401, 402, 429].includes(code)) throw error // ambiguous completion, invalid text, permissions or service fault
        slot.until = Math.max(slot.until, at + (ms ?? (code === 429 ? 30000 : code === 401 ? 300000 : 900000)))
        last = code
      } finally { slot.busy-- }
    }
    // Per-key state owns this cooldown. Do not turn one exhausted account into a provider-wide chain cooldown.
    throw new Error(state.until > now() ? '语音服务暂时限流，请稍后再试' : '当前没有可用的语音账号' + (last ? `（HTTP ${last}）` : '，请稍后再试'))
  }
}
