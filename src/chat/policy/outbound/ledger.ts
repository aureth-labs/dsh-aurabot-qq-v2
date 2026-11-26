// 出站账本：deliveryId → 条目，负责落盘、过期清理、上限裁剪与作废。

import fs from 'node:fs'
import { join } from 'node:path'
import { KNOWN_STATES, LEDGER_FILE, LEDGER_MAX_ITEMS, LEDGER_VERSION } from './constants.ts'
import type { LedgerItem, OutboundStats } from './helpers.ts'

export interface CreateLedgerOptions {
  dataDir: string | null
  log: (message: string) => void
  now: () => number
  fsEnabled: boolean
  stats: OutboundStats
}

export function createLedger({ dataDir, log, now, fsEnabled, stats }: CreateLedgerOptions) {
  const items = new Map<string, LedgerItem>()

  /** 读账本文件；任何异常都退回空账本（服务不因磁盘问题挂掉）。 */
  function loadLedger(): void {
    items.clear()
    if (!fsEnabled) return
    try {
      const file = join(dataDir as string, LEDGER_FILE)
      if (!fs.existsSync(file)) return
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const list: unknown[] = Array.isArray(parsed && parsed.items) ? parsed.items : []
      for (const raw of list) {
        const it = raw as LedgerItem
        if (!it || !it.deliveryId) continue
        const state = KNOWN_STATES.includes(String(it.state)) ? it.state : 'pending'
        items.set(String(it.deliveryId), { ...it, state })
      }
    } catch (err) {
      stats.errors++
      log(`[outbound-policy] 账本读取失败，按空账本继续：${err instanceof Error ? err.message : err}`)
      items.clear()
    }
  }

  /** 同步落盘账本；失败只记日志不抛（契约：持久化不得阻塞/打断调用）。 */
  function saveLedger(): void {
    if (!fsEnabled) return
    try {
      if (!fs.existsSync(dataDir as string)) fs.mkdirSync(dataDir as string, { recursive: true })
      const payload = { version: LEDGER_VERSION, items: ledgerArray() }
      const file = join(dataDir as string, LEDGER_FILE)
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      fs.renameSync(tmp, file)
    } catch (err) {
      stats.errors++
      log(`[outbound-policy] 账本落盘失败：${err instanceof Error ? err.message : err}`)
    }
  }

  function getItem(deliveryId: unknown): LedgerItem | null {
    if (deliveryId === null || deliveryId === undefined) return null
    return items.get(String(deliveryId)) || null
  }

  function ledgerArray(): LedgerItem[] {
    return Array.from(items.values()).sort((a, b) => (a.at || 0) - (b.at || 0))
  }

  function putItem(entry: LedgerItem): LedgerItem {
    items.set(entry.deliveryId, entry)
    return entry
  }

  /** 状态迁移：只改内存，调用方决定何时落盘。 */
  function setState(item: LedgerItem | null, state: string, extra: Record<string, unknown> = {}): LedgerItem | null {
    if (!item) return null
    item.state = state
    item.updatedAt = now()
    Object.assign(item, extra)
    return item
  }

  /** TTL 过期清理：pending 超 TTL 置 expired。 */
  function sweepExpired(): boolean {
    const t = now()
    let dirty = false
    for (const it of items.values()) {
      if (it.state !== 'pending' || !it.ttl) continue
      const exp = Number(it.at || 0) + Number(it.ttl)
      if (Number.isFinite(exp) && t >= exp) {
        setState(it, 'expired')
        dirty = true
      }
    }
    return dirty
  }

  /** 上限裁剪：超 200 条时优先清最老的非 pending（pending 受 TTL 保护）。 */
  function trimLedger(): boolean {
    if (items.size <= LEDGER_MAX_ITEMS) return false
    const all = ledgerArray()
    const evictOrder = [
      ...all.filter((it) => it.state !== 'pending'),
      ...all.filter((it) => it.state === 'pending'),
    ]
    let removed = false
    for (const it of evictOrder) {
      if (items.size <= LEDGER_MAX_ITEMS) break
      items.delete(it.deliveryId)
      removed = true
    }
    return removed
  }

  /** 作废：模块卸载 / ownerQQ 变更 → 相关 pending 置 dropped。predicate 为真且仍 pending 的条目才动。 */
  function dropPending(predicate: (item: LedgerItem) => boolean, reason: string): number {
    let changed = 0
    for (const it of items.values()) {
      if (it.state !== 'pending') continue
      if (!predicate(it)) continue
      setState(it, 'dropped', { dropReason: reason })
      changed++
    }
    return changed
  }

  /** 同源合并：同幂等键且旧条目仍 pending → 旧条目 dropped(superseded)。 */
  function supersede(key: string): number {
    let dropped = 0
    for (const it of items.values()) {
      if (it.state !== 'pending') continue
      if (it.key !== key) continue
      setState(it, 'dropped', { dropReason: 'superseded' })
      dropped++
    }
    return dropped
  }

  loadLedger()

  return { items, loadLedger, saveLedger, getItem, ledgerArray, putItem, setState, sweepExpired, trimLedger, dropPending, supersede }
}
