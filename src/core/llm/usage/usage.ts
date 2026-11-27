import { dataDir, ensureDir } from '../../store/index.ts'
import { beijingDayKey } from './offpeak.ts'
import { openUsage, count } from './store.ts'

export const KEEP_DAYS = 90
const DAY_MS = 86_400_000
let store: ReturnType<typeof openUsage> | undefined
let writeFailed = false

export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface UsageRow {
  at: number
  module: string
  chat: string
  provider: string
  model: string
  in: number
  out: number
  cached: number
  written?: number
  runs?: number
  task?: string
  id?: string
}

/** 会话游标：同一轮/同一步的结算互相覆盖，重试算新账。 */
export interface SessionCursor {
  seq: number
  at: number
  model: string
  provider: string
  last: { turn?: number; step?: number; id: string } | null
  tool?: { module: string; turn?: number } | null
}

/** DSH 会话事件里我们会读的字段。 */
interface SessionEventData {
  provider?: string
  model?: string
  name?: string
  turn?: number
  step?: number
  usage?: ModelUsage
  stream?: Array<{ type?: string; usage?: ModelUsage }> | { chunks?: Array<{ type?: string; usage?: ModelUsage }> }
  header?: { config?: { provider?: string; model?: string } }
}

/** 一条 DSH 会话事件。 */
interface SessionEvent { seq: number; time?: number; type: string; data?: SessionEventData }

const MODULE_LABELS = {
  memory: '记忆', mood: '心情', diary: '空间日记', purpose: '目的引擎', 'purpose-nudge': '目的引擎（追问）',
  stickers: '表情包', imagegen: '生图', bili: '刷 B 站', video: '生视频',
  voice: '语音', song: '翻唱', pet: '桌宠', profile: '改资料', contacts: '好友申请',
  'qq-tools': 'QQ 工具', 'qq-api': 'QQ 接口', 'group-admin': '群管', 'qzone-social': '空间互动',
  speakup: '主动搭话', bridge: '联动接口', 'bili-vision': 'B 站看画面', persona: '人格生成', 'model-ping': '模型测试', background: '其他后台任务',
}

/**
 * 聊天轮次里「是某个工具干的活」时，把这一步的用量记到工具所属模块名下，别全算成「聊天」。
 * 例：聊天里让她刷 B 站 → 她调 `bili_watch` → 下一步读字幕/热评那次调用算「刷 B 站」。
 * 返回 '' 表示这个工具不属于任何记账模块（就还按「聊天」算）。
 */
export function moduleOfTool (name: unknown): string {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return ''
  // 名字前缀猜归属（bili_watch → bili）；前缀不是模块 id 的，再看这两张表
  const owner = (TOOL_MODULES as Record<string, string>)[n] || n.split('_')[0]
  return MODULE_LABELS[owner] || ''
}

// 工具名 → 模块 id：只收「前缀猜不出来」和「前缀会猜错」的，其余走前缀
const TOOL_MODULES = {
  // bili 模块注册的，但名字是 qq_ 开头（B 站截图）
  qq_send_shot: 'bili',
  qq_list_shots: 'bili',
  qq_draw_image: 'imagegen',
  qq_generate_video: 'video',
  generate_video: 'video',
  generate_image: 'imagegen',
  qq_send_sticker: 'stickers',
  qq_collect_sticker: 'stickers',
  qq_add_sticker: 'stickers',
  qq_edit_sticker: 'stickers',
  qq_save_sticker: 'stickers',
  qq_import_qq_stickers: 'stickers',
}

/**
 * 把「聊天 id」或「模块 id」变成记账用的名字。
 *   group:123 / private:456 → 聊天
 *   system:diary / system:bili → 空间日记（后台）/ 刷 B 站（后台）
 *   memory / mood / … → 记忆 / 心情 …
 */
export function moduleLabel (key: unknown): string {
  const s = String(key || '').trim()
  if (!s) return '其他后台任务'
  if (s.startsWith('system:')) {
    const id = s.slice(7).replace(/^ext-/, '')
    return (MODULE_LABELS[id] || id) + '（后台）'
  }
  if (s.startsWith('group:') || s.startsWith('private:')) return '聊天'
  return MODULE_LABELS[s] || s
}

// 分不出来的就一律记「其他后台任务」，别在主表里摊成一堆看不懂的名字：
//   「后台任务」/「后台会话」/「其它后台」/ 空 → 其他后台任务
//   （打标签之前那批带模型名的 askModel 调用回查下来是记忆模块，单独给个「记忆（回查）」）
export const OTHER_BACKGROUND = '其他后台任务'
const LEGACY_MODULES = {
  后台任务: OTHER_BACKGROUND,
  后台会话: OTHER_BACKGROUND,
  其它后台: OTHER_BACKGROUND,
  其他后台: OTHER_BACKGROUND,
  '旧数据（未分模块）': OTHER_BACKGROUND, // 之前那版归置时写进文件的，统一收回来
}

/** 一行记录该归到哪个模块名下（兼容旧标签；认不出的一律「其他后台任务」）。 */
export function moduleOf (row: UsageRow | null | undefined): string {
  const m = String(row?.module || '').trim()
  if (!m) return OTHER_BACKGROUND
  return LEGACY_MODULES[m] || m
}


function totalsOf(rows: UsageRow[]) {
  const t = { runs: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cacheHitRate: null as number | null }
  for (const row of rows) {
    t.runs += count(row.runs) || 1
    t.promptTokens += count(row.in) + count(row.cached) + count(row.written)
    t.completionTokens += count(row.out)
    t.cachedTokens += count(row.cached)
    t.cacheWriteTokens += count(row.written)
  }
  t.totalTokens = t.promptTokens + t.completionTokens
  t.cacheHitRate = t.promptTokens ? t.cachedTokens / t.promptTokens : null
  return t
}
function groupBy (rows: UsageRow[], keyOf: (row: UsageRow) => string) {
  const groups = new Map<string, UsageRow[]>()
  for (const r of rows) {
    const key = keyOf(r)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups].map(([key, rs]) => ({ key, ...totalsOf(rs) })).sort((a,b) => b.totalTokens-a.totalTokens || a.key.localeCompare(b.key))
}
export function closeUsage() { store?.close(); store = undefined }

export function initUsage() {
  closeUsage()
  try {
    store = openUsage(ensureDir(dataDir()))
    store.prune(dayStart(beijingDayKey(Date.now())) - (KEEP_DAYS - 1) * DAY_MS)
    writeFailed = false
  } catch (error) {
    writeFailed = true
    process.emitWarning('用量数据库打开失败：' + String(error))
  }
}

export interface RecordUsageOptions {
  module?: string
  task?: string
  chat?: string
  provider?: string
  model?: string
  usage?: ModelUsage | null
  at?: number
  id?: string
}

function persistUsage ({ module = '其他后台任务', task = '', chat = '', provider = '', model = '', usage, at = Date.now(), id = '' }: RecordUsageOptions = {}): UsageRow | null {
  if (!store || !usage || !Number.isFinite(at)) return null
  const row: UsageRow = { at, module, chat: String(chat || ''), provider: String(provider || ''), model: String(model || ''),
    in: count(usage.inputTokens), out: count(usage.outputTokens), cached: count(usage.cacheReadTokens), written: count(usage.cacheWriteTokens) }
  if (!row.in && !row.out && !row.cached && !row.written && !(id && store.module(id) !== undefined)) return null
  if (module === '记忆' && task) row.task = task
  if (id) row.id = id
  store.put(row)
  return row
}

export function recordUsage(options: RecordUsageOptions = {}) {
  try { return persistUsage(options) }
  catch { writeFailed = true; return null }
}

export function recordRetrievalUsage (task: string, model: string, usage: { prompt_tokens?: number; total_tokens?: number } | null | undefined): void {
  const tokens = usage?.prompt_tokens ?? usage?.total_tokens
  if (count(tokens)) recordUsage({ module: '记忆', task, model, usage: { inputTokens: tokens } })
}

// Mirrors DSH's tokenUsage fold: last settlement wins within a turn/step; retry starts a new charge.
// Stored cursors make a repeated event / a resumed session idempotent without retaining chat content.
export function recordSessionUsage (sessionId: string, chat: string, event: SessionEvent | null | undefined, target: { model?: string; provider?: string } = {}): void {
  if (!store || !sessionId || !event || !Number.isSafeInteger(event.seq)) return
  if (!observed.has(event.type)) return
  try {
    store.transaction(() => fold(sessionId, chat, event, target))
  } catch { writeFailed = true }
}

const observed = new Set(['model/selection','request/header','tool/call','llm/retry-started','assistant/message','assistant/attempt','compaction/summary'])
function fold(sessionId: string, chat: string, event: SessionEvent, target: { model?: string; provider?: string }) {
  const old = store.cursor(sessionId)
  if (old && event.seq <= old.seq) return
  const c: SessionCursor = old || { seq: -1, at: 0, model: '', provider: '', last: null }
  c.seq = event.seq
  c.at = Number.isFinite(event.time) ? event.time : Date.now()
  const d = event.data || {}
  if (event.type === 'model/selection') { c.provider = d.provider || ''; c.model = d.model || '' }
  if (event.type === 'request/header') {
    const cfg = d.header?.config
    if (cfg?.provider) c.provider = cfg.provider
    if (cfg?.model) c.model = cfg.model
  }
  if (event.type === 'tool/call') c.tool = { module: moduleOfTool(d.name), turn: d.turn }
  if (event.type === 'llm/retry-started' && c.last?.turn === d.turn && c.last?.step === d.step) c.last = null
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt' || event.type === 'compaction/summary') {
    const chunks = Array.isArray(d.stream) ? d.stream : (d.stream as { chunks?: Array<{ type?: string; usage?: ModelUsage }> } | undefined)?.chunks
    const usage = d.usage ?? (Array.isArray(chunks) ? chunks.findLast(x => x?.type === 'usage')?.usage : null)
    const summary = event.type === 'compaction/summary'
    if (usage) {
      const replaces = !summary && c.last && c.last.turn === d.turn && c.last?.step === d.step
      const id = replaces ? c.last.id : sessionId + ':' + event.seq
      const module = summary ? '对话整理' : (replaces ? store.module(id) : '') || (!chat.startsWith('system:') && c.tool && c.tool.turn === d.turn ? c.tool.module : '') || moduleLabel(chat)
      persistUsage({ id, chat, module,
        model: summary ? d.model || '' : c.model || target.model || '',
        provider: summary ? d.provider || '' : c.provider || target.provider || '', usage, at: c.at })
      if (!summary) { c.last = { turn: d.turn, step: d.step, id }; c.tool = null }
    }
  }
  // Only numeric accounting metadata is persisted, never event messages or headers.
  store.save(sessionId, c)
}

function dayStart(date: string): number {
  const at = Date.parse(date + 'T00:00:00+08:00')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(at) || beijingDayKey(at) !== date) throw RangeError('日期须为有效的 YYYY-MM-DD')
  return at
}
interface Query { now?: number; range?: string; from?: string; to?: string }
export function usageReport({ now = Date.now(), range = '7', from = '', to = '' }: Query = {}) {
  const today = dayStart(beijingDayKey(now)), first = today - (KEEP_DAYS - 1) * DAY_MS
  store?.prune(first)
  const bounds: Record<string, [number, number]> = { today: [today, now], yesterday: [today - DAY_MS, today - 1],
    '7': [today - 6 * DAY_MS, now], '30': [today - 29 * DAY_MS, now], all: [first, now] }
  if (range === 'custom') {
    const start = dayStart(from), end = dayStart(to) + DAY_MS - 1
    if (end < start) throw RangeError('结束日期须大于或等于开始日期')
    bounds.custom = [Math.max(start, first), Math.min(end, now)]
  }
  if (!Object.hasOwn(bounds, range)) range = '7'
  const rows = store?.rows(...bounds[range]) || []
  const days = store?.days(first, now) || []
  const ranges = Object.fromEntries(Object.entries({ today: 'today', yesterday: 'yesterday', last7: '7', last30: '30', all: 'all' }).map(([key,id]) => {
    const [a,b] = bounds[id]
    return [key, totalsOf(days.filter(d => d.day >= beijingDayKey(a) && d.day <= beijingDayKey(b)))]
  }))
  const conversation = (row: UsageRow) => Boolean(row.chat && !row.chat.startsWith('system:'))
  return { range, days: KEEP_DAYS, startedAt: store?.startedAt, firstRecordAt: store?.first() ?? null, writeFailed, ranges,
    current: { ...totalsOf(rows),
      byChat: groupBy(rows.filter(conversation), row => row.chat), background: totalsOf(rows.filter(row => !conversation(row))),
      byModule: groupBy(rows, moduleOf), byMemoryTask: groupBy(rows.filter(row => moduleOf(row) === '记忆'), row => row.task || '未细分'),
      byModel: groupBy(rows, row => [row.provider, row.model].filter(Boolean).join(' / ') || '未记录模型'),
    },
  }
}
