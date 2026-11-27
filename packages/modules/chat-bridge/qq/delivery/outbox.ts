import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { dataDir, ensureDir } from '../../../../../src/core/store/index.ts'

type CreateOutboxOptions = Partial<Record<'file' | 'log' | 'now' | 'maxItems' | 'maxBytes', any>>
type AddOptions = Partial<Record<'message' | 'chatId' | 'note' | 'kind' | 'ttlMs' | 'incomingReply' | 'deliveryScope' | 'proactive', any>>

const DEFAULT_TTL = 5 * 60_000
const DEFAULT_MAX_ITEMS = 100
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

export interface OutboxItem {
  id: string
  message: Array<{ type: string; attrs?: Record<string, unknown> }>
  chatId: string
  note: string
  kind: string
  incomingReply?: boolean
  deliveryScope?: unknown
  proactive?: string
  createdAt: number
  expiresAt: number
  attempts: number
  nextAt: number
  lastError?: string
}

const ttlForKind = (kind) => {
  if (kind === 'proactive') return 60_000
  if (kind === 'diary' || kind === 'qzone') return 10 * 60_000
  return DEFAULT_TTL
}

export function createOutbox ({ file = dataDir('outbox', 'queue.json'), log, now = Date.now, maxItems = DEFAULT_MAX_ITEMS, maxBytes = DEFAULT_MAX_BYTES } : CreateOutboxOptions = {}) {
  let items: OutboxItem[] = []
  let loaded = false

  function load () {
    if (loaded) return
    loaded = true
    try {
      if (!existsSync(file)) return
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      items = Array.isArray(parsed) ? parsed.filter((x) => x && x.id && Array.isArray(x.message) && x.chatId) : []
    } catch (error) {
      log?.warn?.('发送队列读不出来，已忽略旧文件：', error.message)
      items = []
    }
  }

  function save () {
    try {
      ensureDir(dirname(file))
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(items), { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(tmp, 0o600) } catch (error) {}
      renameSync(tmp, file)
    } catch (error) {
      log?.warn?.('发送队列落盘失败：', error.message)
    }
  }

  function prune (at = now()) {
    load()
    const before = items.length
    items = items.filter((x) => Number(x.expiresAt) > at)
    if (items.length !== before) save()
  }

  function list () {
    prune()
    return items.map((x) => ({ ...x }))
  }

  function add ({ message, chatId = '', note = '', kind = 'reply', ttlMs, incomingReply = false, deliveryScope, proactive = '' } : AddOptions = {}) {
    const parts = Array.isArray(message) ? message : []
    if (!chatId || !parts.length) return { ok: false, message: '不是可补发的消息' }
    if (parts.some((part) => !part || !['text', 'at', 'quote', 'face'].includes(part.type))) {
      return { ok: false, message: '媒体消息不放进补发队列' }
    }
    load()
    const text = JSON.stringify(parts)
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, message: '消息太大，不放进补发队列' }
    prune()
    if (items.length >= maxItems) {
      // 丢最旧的一条，保证不无限增长
      items.shift()
      log?.warn?.(`发送队列已满（${maxItems}），丢弃最旧一条`)
    }
    const at = now()
    const item = {
      id: randomUUID(),
      message: parts,
      chatId: String(chatId || ''),
      note: String(note || '').slice(0, 120),
      kind,
      ...(incomingReply ? { incomingReply: true } : {}),
      ...(deliveryScope ? { deliveryScope } : {}),
      ...(proactive ? { proactive: String(proactive).slice(0, 40) } : {}),
      createdAt: at,
      expiresAt: at + Math.max(10_000, Number(ttlMs) || ttlForKind(kind)),
      attempts: 0,
      nextAt: at,
    }
    items.push(item)
    save()
    return { ok: true, id: item.id, expiresAt: item.expiresAt }
  }

  function remove (id) {
    load()
    const before = items.length
    items = items.filter((x) => x.id !== id)
    if (items.length !== before) save()
  }

  async function flush (
    call: (item: OutboxItem) => Promise<unknown>,
    maySend: (item: OutboxItem) => boolean = () => true,
    onFlushed?: (item: OutboxItem, result: unknown) => void,
  ) {
    load()
    let sent = 0
    let dropped = 0
    for (const item of list()) {
      const at = now()
      if (item.expiresAt <= at) {
        remove(item.id)
        dropped++
        log?.warn?.(`补发过期，丢弃：${item.note || item.chatId}`)
        continue
      }
      if (!maySend(item)) {
        remove(item.id)
        dropped++
        continue
      }
      if (Number(item.nextAt) > at) continue
      try {
        const result = await call(item)
        remove(item.id)
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
          dropped++
          continue
        }
        sent++
        log?.info?.(`补发成功：${item.note || item.chatId}`)
        try { onFlushed?.(item, result) } catch (error) { log?.warn?.('补发回执通知失败：', error?.message || error) }
      } catch (error) {
        if (error?.uncertain) {
          remove(item.id)
          dropped++
          log?.warn?.(`补发结果不确定，丢弃避免重复：${item.note || item.chatId}`)
          continue
        }
        if (!error?.transport) {
          remove(item.id)
          dropped++
          log?.warn?.(`补发失败（非网络）：${error?.message || error}`)
          continue
        }
        item.attempts = Number(item.attempts || 0) + 1
        item.nextAt = at + Math.min(60_000, 2 ** Math.min(item.attempts, 5) * 1000)
        const raw = items.find((x) => x.id === item.id)
        if (raw) {
          raw.attempts = item.attempts
          raw.nextAt = item.nextAt
          save()
        }
        log?.warn?.(`补发时网关仍不可用，留队重试：${item.note || item.chatId}`)
        break
      }
    }
    return { sent, dropped, left: list().length }
  }

  function status () {
    prune()
    return { count: items.length, oldestAt: items.length ? Math.min(...items.map((x) => x.createdAt)) : 0 }
  }

  return { add, list, remove, prune, flush, status }
}
