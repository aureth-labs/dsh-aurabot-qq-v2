// 插件配置：默认值在 ./defaults.ts，这里做归一化、读写与面板视图。
// 配置文件 ~/.dsh/plugins-data/aurabot/config.json

import { randomUUID } from 'node:crypto'
import { normalizePools, maskPools, restorePoolKeys } from '../../voice/tts/key-pool.ts'
import type { RawPools } from '../../voice/tts/key-pool.ts'
import { normalizeMemberFilter } from '../../chat/inbound/filter/member-filter.ts'
import { normalizeChatEfforts } from '../../chat/commands/effort-command.ts'
import { normalizeChatModels } from '../../chat/hub/model/chat-model.ts'
import { DEFAULT_GROUP_POLICY } from '../../chat/policy/group.ts'
import { LEVELS, PROFILE_PERM_KEYS, PROFILE_PERM_LEVELS, profilePermDefault } from '../../chat/policy/access.ts'
import { DELEGATED_COMMANDS, isDelegatedCommandKey } from '../../chat/commands/delegated-commands.ts'
import { DIARY_AUDIENCES } from '../../features/qzone/audience.ts'
import { DEFAULT_TIER_DAYS } from '../../features/memory/query/rules.ts'
import { normalizeEmotions } from '../../features/mood/emotions.ts'
import { dataDir, readJson, writeJson } from '../store/index.ts'
import { DEFAULTS } from './defaults.ts'

export * from './defaults.ts'

import type { AurabotConfig, ImageFallback, NoticeWorkspace } from './defaults.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type BuildBiliCookieOptions = Partial<Record<'sessdata' | 'biliJct' | 'buvid3' | 'buvid4' | 'dedeUserId', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type SplitBiliCookieOptions = Partial<Record<'sessdata' | 'biliJct' | 'cookie' | 'buvid3' | 'buvid4' | 'dedeUserId', any>>

/** 从磁盘读进来的配置：形状未知，要过一遍 normalize。 */
type RawConfig = Record<string, unknown>

const isObj = (v: unknown): v is RawConfig => !!v && typeof v === 'object' && !Array.isArray(v)

function deepMerge<T> (base: T, over: unknown): T {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base) as RawConfig
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out as T
}

const BIG = 1e6 // 没有天然上限的数值：只防手滑填出离谱值，不当真限制
const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const qq = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const qqList = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,，;；]+/)).map(qq).filter(Boolean))]
const hhmm = (v: unknown, d: string): string => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v) : d)
// 严格校验 'YYYY-MM-DD'（面板手填/配置文件手改都可能乱），非法日期当没填。
const dateKey = (v: unknown): string => {
  const s = String(v ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : ''
}
// 请求头：正常是字符串（一行一个）；手写成对象 / 数组时展开成同样的多行文本，
// 免得下游按行解析时认不出来，静默把头全丢掉。
const headerLines = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).join('\n')
  if (isObj(v)) return Object.entries(v).map(([k, x]) => `${k}: ${x ?? ''}`).join('\n')
  return v == null ? '' : String(v)
}
// 请求体：正常是字符串；手写成对象 / 数组时序列化回去（占位符 {text} / {reqid} 照样能替换）
const bodyText = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (isObj(v) || Array.isArray(v)) return JSON.stringify(v, null, 2)
  return v == null ? '' : String(v)
}

// 上报开关：总开关 + 按工作区的覆盖。工作区路径原样当键（调用方会先规范化），
// 覆盖项只认布尔值，别的（0、''、null）一律当「没写」，跟随总开关。
function normalizeNotice (v: unknown, legacyNotify: unknown): AurabotConfig['notice'] {
  const o = isObj(v) ? v : {}
  const approvalDefault = legacyNotify === false ? false : true
  const out: AurabotConfig['notice'] = { enabled: bool(o.enabled, true), approval: typeof o.approval === 'boolean' ? o.approval : approvalDefault, question: bool(o.question, true), windowSec: 8, workspaces: {} }
  // 合并窗口：审批/选项请求到齐后等多久再推 QQ。范围 1 ~ 60 秒，默认 8（够几条一起到，又不至于太慢）
  const winSec = Number(o.windowSec)
  out.windowSec = Number.isFinite(winSec) ? Math.min(60, Math.max(1, Math.round(winSec))) : 8
  const ws = isObj(o.workspaces) ? o.workspaces : {}
  for (const [key, val] of Object.entries(ws)) {
    const path = String(key || '').trim()
    if (!path) continue
    const w = isObj(val) ? val : {}
    const item: NoticeWorkspace = {}
    if (typeof w.approval === 'boolean') item.approval = w.approval
    if (typeof w.question === 'boolean') item.question = w.question
    out.workspaces[path] = item
  }
  return out
}

export function normalize (raw: RawConfig | null | undefined): AurabotConfig {
  const c = deepMerge<AurabotConfig>(DEFAULTS, raw)
  // v1 的 snowluma 段只保留连接地址，迁到通用的 onebot 段；其余启动/注入字段一律丢弃。
  const legacySnow = isObj(raw?.snowluma) ? raw.snowluma : {}
  const rawOnebot = isObj(raw?.onebot) ? raw.onebot : legacySnow
  c.onebot = {
    httpUrl: String(rawOnebot.httpUrl || '').trim(),
    wsUrl: String(rawOnebot.wsUrl || '').trim(),
    httpToken: String(rawOnebot.httpToken || '').trim(),
    wsToken: String(rawOnebot.wsToken || '').trim(),
  }
  delete (c as RawConfig).snowluma
  delete (c as RawConfig).gateway
  // 几个老字段是从原始配置里直接读的（不经过 deepMerge），先摘出来，免得每处都判一遍
  const rawMemory = isObj(raw?.memory) ? raw.memory : {} as RawConfig
  const rawDouyin = isObj(raw?.douyin) ? raw.douyin : {} as RawConfig
  c.enabled = bool(c.enabled, false)
  c.dryRun = bool(c.dryRun, true)
  c.debug = bool(c.debug, false)
  if (c.debug) c.dryRun = true
  // 指令前缀：只认字符串和 null（null = 无前缀），去重、去空串；坏数据落回默认
  const prefixes = Array.isArray(c.commandPrefixes) ? c.commandPrefixes : []
  const cleaned = []
  for (const item of prefixes) {
    if (item === null) { if (!cleaned.includes(null)) cleaned.push(null); continue }
    const p = String(item ?? '').trim()
    if (p && !cleaned.includes(p)) cleaned.push(p)
  }
  c.commandPrefixes = cleaned.length ? cleaned : [null, '/']
  c.middlewareAfterCommand = bool(c.middlewareAfterCommand, false)
  c.conversationContext = { enabled: bool(c.conversationContext?.enabled, false) }
  c.botQQ = qq(c.botQQ)
  c.ownerQQ = qq(c.ownerQQ)
  c.approvalNotify = bool(c.approvalNotify, true)
  // 老配置只有 approvalNotify：没写过 notice 时用它当审批上报的默认值，免得更一次版本被重新打开
  c.notice = normalizeNotice(isObj(raw?.notice) ? raw.notice : null, raw?.approvalNotify)
  c.approvalViaQQ = bool(c.approvalViaQQ, true)
  // 等主人回复授权的时长：坏数据一律回 5 分钟；范围夹在 30 秒 ~ 30 分钟（太短来不及看，太长把回合堵死）
  const approvalSec = Number(c.approvalTimeoutSec)
  c.approvalTimeoutSec = Number.isFinite(approvalSec) ? Math.min(1800, Math.max(30, Math.round(approvalSec))) : 300
  c.qqApi.enabled = bool(c.qqApi.enabled, true)
  // 只认绝对路径（Windows 的 D:\\… 或 Linux 的 /…），别的当没填
  c.workspaceDir = String(c.workspaceDir || '').trim()
  if (c.workspaceDir && !/^([a-zA-Z]:[\\/]|\/)/.test(c.workspaceDir)) c.workspaceDir = ''
  // 视觉能力：auto = 问 DSH 的模型元数据；on / off = 主人手动声明（覆盖元数据）
  c.model.vision = c.model.vision === 'on' || c.model.vision === 'off' ? c.model.vision : 'auto'
  c.setupDone = bool(c.setupDone, false)
  c.ownerLevel = LEVELS.includes(c.ownerLevel) ? c.ownerLevel : 'full'
  c.longTasks = bool(c.longTasks, true)
  c.subagentBackground = bool(c.subagentBackground, false)
  c.chatModels = normalizeChatModels(c.chatModels)
  c.chatEfforts = normalizeChatEfforts(c.chatEfforts)
  c.profilePerms = Object.fromEntries(PROFILE_PERM_KEYS.map((k) => [k, PROFILE_PERM_LEVELS.includes(c.profilePerms?.[k]) ? c.profilePerms[k] : profilePermDefault(k)])) as AurabotConfig['profilePerms']
  c.capabilityAllow = Object.fromEntries(['image', 'song', 'video'].map((key) => {
    const ids = Array.isArray(c.capabilityAllow?.[key]) ? c.capabilityAllow[key] : []
    return [key, [...new Set(ids.map(String).map((id) => id.trim()).filter((id) => /^\d{5,}$/.test(id)))]]
  })) as AurabotConfig['capabilityAllow']
  const commandKeys = [...new Set([...DELEGATED_COMMANDS, ...Object.keys(c.commandAllow || {}).filter(isDelegatedCommandKey)])]
  c.commandAllow = Object.fromEntries(commandKeys.map((key) => {
    const ids = Array.isArray(c.commandAllow?.[key]) ? c.commandAllow[key] : []
    return [key, [...new Set(ids.map(String).map((id) => id.trim()).filter((id) => /^\d{5,}$/.test(id)))]]
  }))
  // 旧版 douyinDm 是「回别人私信」的权限，含义已不同（现在是主动发私信），老配置一律回到默认「仅主人」
  if (isObj(raw?.profilePerms) && 'douyinDm' in raw.profilePerms) c.profilePerms.douyinDm = profilePermDefault('douyinDm')
  c.allow = { private: qqList(c.allow.private), groups: qqList(c.allow.groups) }
  // 发文件：开关、大小上限、额外允许的目录（只认绝对路径；空行忽略）
  if (!isObj(c.files)) c.files = structuredClone(DEFAULTS.files)
  if (!isObj(c.security)) c.security = structuredClone(DEFAULTS.security)
  c.security.dangerConfirm = bool(c.security.dangerConfirm, true)
  c.security.ssrfMode = c.security.ssrfMode === 'loose' ? 'loose' : 'strict'
  // 远端管理开关与可信反代：放 security 段（顶层对象，不会被下面「ext 只留对象」的规则删掉）
  c.security.panelRemoteAccess = bool(c.security.panelRemoteAccess, false)
  c.security.trustedProxy = String(c.security.trustedProxy || '').trim()
  c.security.publicHostname = String(c.security.publicHostname || '').trim().toLowerCase()
  // 浏览器后端开关（老配置没有 browser 段也要补出默认值）
  if (!isObj(c.browser)) c.browser = structuredClone(DEFAULTS.browser)
  c.browser.useDshSidebar = bool(c.browser.useDshSidebar, false)
  // DeepSeek 峰谷省钱模式：默认关；节假日列表去重、只留合法的 'YYYY-MM-DD'（北京时间日期）
  if (!isObj(c.cost)) c.cost = structuredClone(DEFAULTS.cost)
  c.cost.offPeak = bool(c.cost.offPeak, false)
  const rawHolidays = Array.isArray(c.cost.offPeakHolidays) ? c.cost.offPeakHolidays : String(c.cost.offPeakHolidays || '').split(/[\n,，;；\s]+/)
  c.cost.offPeakHolidays = [...new Set(rawHolidays.map(dateKey).filter(Boolean))].sort().slice(0, 60)
  c.update = { unstable: typeof c.update?.unstable === 'boolean' ? c.update.unstable : null }
  c.files.enabled = bool(c.files.enabled, true)
  c.files.maxMB = num(c.files.maxMB, 50, 1, BIG)
  c.files.imageByPath = bool(c.files.imageByPath, true)
  c.files.dirs = (Array.isArray(c.files.dirs) ? c.files.dirs : String(c.files.dirs || '').split(/[\n,，;；]+/))
    .map((s) => String(s).trim()).filter((s) => /^([a-zA-Z]:[\\/]|\/)/.test(s)).slice(0, 20)
  const g = c.group
  g.privateCommandsEnabled = bool(g.privateCommandsEnabled, true)
  g.moduleOnlyGroups = qqList(g.moduleOnlyGroups)
  g.wakeWords = (Array.isArray(g.wakeWords) ? g.wakeWords : String(g.wakeWords || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.proactiveEnabled = bool(g.proactiveEnabled, true)
  g.engagedEnabled = typeof g.engagedEnabled === 'boolean' ? g.engagedEnabled : null
  g.interjectChance = num(g.interjectChance, 0.15, 0, 1)
  g.cooldownSec = num(g.cooldownSec, 90, 0, BIG)
  g.maxPerHour = num(g.maxPerHour, 6, 0, BIG)
  g.mustMaxPerHour = num(g.mustMaxPerHour, 100, 0, BIG)
  g.minRecentMessages = num(g.minRecentMessages, 3, 0, BIG)
  g.activeWindowSec = num(g.activeWindowSec, 300, 1, BIG)
  if (!Array.isArray(g.quietHours) || g.quietHours.length !== 2) g.quietHours = DEFAULT_GROUP_POLICY.quietHours
  g.quietHours = g.quietHours.map((h) => num(h, 0, 0, 23))
  // 对外静默窗口：这段内只有主人叫得醒她。两个数字相同（或没写）一律当不启用
  const clockHour = (v: unknown): string | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
    if (!m) return null
    const h = Number(m[1])
    const mi = Number(m[2])
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0')
  }
  g.guestQuietFrom = clockHour(g.guestQuietFrom)
  g.guestQuietTo = clockHour(g.guestQuietTo)
  if (!g.guestQuietFrom || !g.guestQuietTo || g.guestQuietFrom === g.guestQuietTo) {
    g.guestQuietFrom = null
    g.guestQuietTo = null
  }
  delete g.guestQuietHours
  if (!isObj(g.overrides)) g.overrides = {}
  for (const o of Object.values(g.overrides)) {
    if (!isObj(o)) continue
    for (const key of ['proactiveEnabled', 'engagedEnabled']) {
      if (typeof o[key] !== 'boolean') delete o[key] // 没写 / 非法值跟随全局，不把 'false' 当开
    }
  }
  if (!isObj(g.ownerBrief)) g.ownerBrief = { enabled: true, lines: 24, groups: [] }
  g.ownerBrief.enabled = bool(g.ownerBrief.enabled, true)
  g.ownerBrief.lines = num(g.ownerBrief.lines, 24, 1, 30)
  g.ownerBrief.groups = qqList(g.ownerBrief.groups)
  // 群聊里的本机工具：默认关；只有明确写了 owner 才开（all 已移除，写 all 也按 off 处理）
  g.ownerTools = g.ownerTools === 'owner' ? 'owner' : 'off'
  g.ownerToolsGroups = qqList(g.ownerToolsGroups)
  c.memory.adaptStyle = c.memory.adaptStyle !== false
  c.voice.autoChance = num(c.voice.autoChance, 0.15, 0, 1)
  c.voice.autoMaxChars = num(c.voice.autoMaxChars, 80, 1, BIG)
  c.voice.emojiSeparate = c.voice.emojiSeparate !== false
  // 通用 HTTP 引擎（接火山 / 阿里 / 讯飞这类云 TTS）：method 只认 GET / POST，其余当 GET；
  // 地址、请求头、请求体一律转成字符串——手改 config.json 写成对象、数组或数字时，也按原意
  // 拼得出去，不会变成 "[object Object]" 或者带着填错的空格。
  if (!isObj(c.voice.http)) c.voice.http = structuredClone(DEFAULTS.voice.http)
  c.voice.http.urlTemplate = String(c.voice.http.urlTemplate ?? '').trim()
  c.voice.http.method = String(c.voice.http.method ?? '').trim().toUpperCase() === 'POST' ? 'POST' : 'GET'
  c.voice.http.headers = headerLines(c.voice.http.headers)
  c.voice.http.body = bodyText(c.voice.http.body)
  c.voice.http.sampleRate = num(c.voice.http.sampleRate, 24000, 8000, 48000)
  // 豆包预设：Key 去两端空白并限长（粘整段文件时不会把整个配置撑爆），音色 id 也限长；
  // resourceId 只认这两个合法值，填别的当没填（留空时按音色自己认）
  if (!isObj(c.voice.volcano)) c.voice.volcano = structuredClone(DEFAULTS.voice.volcano)
  c.voice.volcano.apiKey = String(c.voice.volcano.apiKey ?? '').trim().slice(0, 400)
  c.voice.volcano.voiceType = String(c.voice.volcano.voiceType ?? '').trim().slice(0, 120) || DEFAULTS.voice.volcano.voiceType
  c.voice.volcano.resourceId = ['seed-tts-1.0', 'seed-tts-2.0'].includes(String(c.voice.volcano.resourceId))
    ? String(c.voice.volcano.resourceId)
    : ''
  c.voice.volcano.speedRatio = num(c.voice.volcano.speedRatio, 1, 0.5, 2)
  // Breeze 语音：地址 / 音色 id / 语气说明；Key 不回显（publicConfig 里换成 keySet）
  if (!isObj(c.voice.breeze)) c.voice.breeze = structuredClone(DEFAULTS.voice.breeze)
  const bz = c.voice.breeze
  bz.mode = ['cloud', 'local'].includes(String(bz.mode)) ? String(bz.mode) : 'cloud'
  bz.url = String(bz.url ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.url
  bz.key = String(bz.key ?? '').trim().slice(0, 400)
  bz.voiceId = String(bz.voiceId ?? '').trim().slice(0, 200)
  bz.siteUrl = String(bz.siteUrl ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.siteUrl
  bz.email = String(bz.email ?? '').trim().slice(0, 200)
  bz.password = String(bz.password ?? '').slice(0, 400)
  bz.autoClaim = bz.autoClaim !== false
  bz.model = String(bz.model ?? '').trim().slice(0, 100) || DEFAULTS.voice.breeze.model
  bz.languageCode = String(bz.languageCode ?? '').trim().slice(0, 20) || DEFAULTS.voice.breeze.languageCode
  bz.instructions = String(bz.instructions ?? '').trim().slice(0, 500)
  bz.outputFormat = String(bz.outputFormat ?? '').trim().slice(0, 60) || DEFAULTS.voice.breeze.outputFormat
  bz.guidanceScale = num(bz.guidanceScale, 0, 0, 20)
  bz.timeoutMs = num(bz.timeoutMs, 60000, 5000, 600000)
  // MiniMax 语音：地址 / 音色 id / 模型 / 情绪；Key 不回显（publicConfig 里换成 apiKeySet）
  if (!isObj(c.voice.minimax)) c.voice.minimax = structuredClone(DEFAULTS.voice.minimax)
  c.voice.minimax.apiKey = String(c.voice.minimax.apiKey ?? '').trim().slice(0, 400)
  c.voice.minimax.baseUrl = String(c.voice.minimax.baseUrl ?? '').trim().slice(0, 400) || DEFAULTS.voice.minimax.baseUrl
  c.voice.minimax.voiceId = String(c.voice.minimax.voiceId ?? '').trim().slice(0, 200) || DEFAULTS.voice.minimax.voiceId
  c.voice.minimax.model = ['speech-2.8-turbo', 'speech-2.8-hd', 'speech-2.6-turbo', 'speech-2.6-hd'].includes(String(c.voice.minimax.model))
    ? String(c.voice.minimax.model)
    : DEFAULTS.voice.minimax.model
  c.voice.minimax.emotion = ['auto', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].includes(String(c.voice.minimax.emotion))
    ? String(c.voice.minimax.emotion)
    : 'auto'
  c.voice.minimax.speed = num(c.voice.minimax.speed, 1, 0.5, 2)
  c.voice.minimax.pitch = num(c.voice.minimax.pitch, 0, -12, 12)
  // 云端语音识别：provider 只认内置两项和 custom；地址/模型留空时由 asr.js 用预置默认值
  if (!isObj(c.voice.asrApi)) c.voice.asrApi = structuredClone(DEFAULTS.voice.asrApi)
  const asrApi = c.voice.asrApi
  asrApi.provider = ['', 'siliconflow', 'openai', 'custom'].includes(asrApi.provider) ? asrApi.provider : ''
  for (const k of ['baseUrl', 'model', 'apiKey', 'language']) asrApi[k] = String(asrApi[k] ?? '').trim()
  asrApi.baseUrl = asrApi.baseUrl.replace(/\/+$/, '')
  asrApi.prefer = ['qq', 'cloud'].includes(asrApi.prefer) ? asrApi.prefer : 'qq'
  c.voice.http.fallback = ['edge', 'text'].includes(c.voice.http.fallback) ? c.voice.http.fallback : 'windows'
  c.stickers.autoChance = num(c.stickers.autoChance, 0.35, 0, 1)
  c.stickers.limitTagged = bool(c.stickers.limitTagged, false)
  c.stickers.keywordExemption = bool(c.stickers.keywordExemption, false)
  // 主动贴表情：自己的概率（默认 0.15），不从 autoChance 取值；老配置里存成 null 的按默认算
  c.stickers.reactChance = num(c.stickers.reactChance ?? 0.15, 0.15, 0, 1)
  c.stickers.reactMaxPerHour = num(c.stickers.reactMaxPerHour, 10, 0, BIG)
  c.stickers.react = bool(c.stickers.react, false)
  c.stickers.faces = c.stickers.faces !== false
  c.stickers.collectMode = ['ask', 'auto', 'owner'].includes(c.stickers.collectMode) ? c.stickers.collectMode : 'ask'
  c.stickers.maxPerHour = num(c.stickers.maxPerHour, 20, 0, BIG)
  c.stickers.maxLibrary = num(c.stickers.maxLibrary, 300, 1, BIG)
  c.stickers.maxSide = num(c.stickers.maxSide, 520, 80, 4096)
  // 起名单独挑的模型：两半都填了才认；填一半 / 脏数据都当没填（回落到聊天模型）
  c.stickers.captionModel = (() => {
    const m = isObj(c.stickers.captionModel) ? c.stickers.captionModel : {} as RawConfig
    const provider = String(m.provider || '').trim()
    const model = String(m.model || '').trim()
    return provider && model ? { provider, model } : { provider: '', model: '' }
  })()
  const lookModel = isObj(c.personaLook?.visionModel) ? c.personaLook.visionModel : {} as RawConfig
  const lookProvider = typeof lookModel.provider === 'string' ? lookModel.provider.trim() : ''
  const lookName = typeof lookModel.model === 'string' ? lookModel.model.trim() : ''
  c.personaLook = { visionModel: lookProvider && lookName ? { provider: lookProvider, model: lookName } : { provider: '', model: '' } }
  c.diary.timesPerDay = num(c.diary.timesPerDay, 2, 0, 48)
  c.diary.windowStart = hhmm(c.diary.windowStart, '10:00')
  c.diary.windowEnd = hhmm(c.diary.windowEnd, '23:30')
  c.diary.minGapMinutes = num(c.diary.minGapMinutes, 180, 0, 1440)
  c.diary.attachImage = bool(c.diary.attachImage, true)
  if (!isObj(c.diary.rich)) c.diary.rich = { ...DEFAULTS.diary.rich }
  for (const key of ['enabled', 'stickers', 'browsing', 'local']) c.diary.rich[key] = bool(c.diary.rich[key], DEFAULTS.diary.rich[key])
  c.diary.rich.folder = typeof c.diary.rich.folder === 'string' ? c.diary.rich.folder.trim() : ''
  if (c.diary.rich.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.rich.folder)) c.diary.rich.folder = ''
  delete c.diary.rich.cards
  c.diary.rich.maxImages = Math.round(num(c.diary.rich.maxImages, 2, 1, 9))
  if (!isObj(c.diary.archive)) c.diary.archive = { ...DEFAULTS.diary.archive }
  c.diary.archive.enabled = bool(c.diary.archive.enabled, false)
  c.diary.archive.folder = typeof c.diary.archive.folder === 'string' ? c.diary.archive.folder.trim() : ''
  if (c.diary.archive.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.archive.folder)) c.diary.archive.folder = ''
  c.diary.minChars = num(c.diary.minChars, 60, 1, BIG)
  c.diary.maxChars = num(c.diary.maxChars, 140, 1, BIG)
  c.diary.visibility = DIARY_AUDIENCES.includes(c.diary.visibility) ? c.diary.visibility : 'all'
  c.diary.audienceQQs = qqList(c.diary.audienceQQs).slice(0, 200).join('\n')
  c.speakUp.idleMinutes = num(c.speakUp.idleMinutes, 40, 1, BIG)
  c.speakUp.nudge = bool(c.speakUp.nudge, true)
  c.speakUp.minIntervalMinutes = num(c.speakUp.minIntervalMinutes, 90, 1, BIG)
  c.speakUp.maxIntervalMinutes = Math.max(c.speakUp.minIntervalMinutes, num(c.speakUp.maxIntervalMinutes, 240, 1, BIG))
  // 留空就是 20，上限不封顶
  const perDayRaw = c.speakUp.maxPerDay as unknown
  c.speakUp.maxPerDay = perDayRaw === '' || perDayRaw == null ? 20 : num(perDayRaw, 20, 0, BIG)
  c.speakUp.reminderEnabled = bool(c.speakUp.reminderEnabled, false)
  c.speakUp.reminderLimit = Math.min(10, Math.max(1, Math.round(num(c.speakUp.reminderLimit, 5, 1, 10))))
  c.speakUp.reminderRetry = bool(c.speakUp.reminderRetry, true)
  c.speakUp.allow = [...new Set((Array.isArray(c.speakUp.allow) ? c.speakUp.allow : []).map((q) => String(q).trim()).filter((q) => /^\d{5,}$/.test(q)))]
  const q = c.qzoneSocial
  q.enabled = bool(q.enabled, true)
  q.replyOwn = bool(q.replyOwn, true)
  q.commentFriends = bool(q.commentFriends, true)
  q.like = bool(q.like, true)
  q.friendChance = num(q.friendChance, 0.3, 0, 1)
  q.ownerChance = num(q.ownerChance, 0.7, 0, 1)
  q.maxPerDay = num(q.maxPerDay, 8, 0, BIG)
  q.intervalMin = num(q.intervalMin, 30, 1, BIG)
  c.mood.halfLifeHours = num(c.mood.halfLifeHours, 3, 0.1, BIG)
  c.mood.base = num(c.mood.base, 60, 0, 100)
  c.mood.judge = bool(c.mood.judge, true)
  // 心情项：坏项/重复键丢弃、一条不剩回落到出厂十项；老的存档里没有这个键时也是十项
  // （normalize 只补缺省，不会把用户删到只剩两项的配置洗回十项）。
  c.mood.emotions = normalizeEmotions(c.mood.emotions)
  for (const k of ['tts', 'image', 'song', 'asr', 'video']) c.local[k] = bool(c.local[k], false)
  c.local.videoTimeoutMin = num(c.local.videoTimeoutMin, 20, 1, BIG)
  const b = c.bili
  Object.assign(b, splitBiliCookie(b))
  for (const k of ['enabled', 'autoBrowse', 'offpeak', 'comment', 'reply', 'shareToOwner', 'like', 'vision', 'danmakuEnabled', 'autoDanmaku']) b[k] = bool(b[k], DEFAULTS.bili[k])
  b.visionFrames = Math.round(num(b.visionFrames, 6, 1, 100))
  b.ffmpegPath = String(b.ffmpegPath || '').trim()
  b.shotChance = num(b.shotChance, 0.35, 0, 1)
  b.shotLibrary = Math.round(num(b.shotLibrary, 300, 1, BIG))
  if (!isObj(b.groupShare)) b.groupShare = structuredClone(DEFAULTS.bili.groupShare)
  b.groupShare.enabled = bool(b.groupShare.enabled, false)
  b.groupShare.groupId = qq(b.groupShare.groupId)
  b.groupShare.groups = [...new Set((Array.isArray(b.groupShare.groups) ? b.groupShare.groups : []).map(qq).filter(Boolean))].slice(0, 20)
  b.groupShare.dailyLimit = Math.round(num(b.groupShare.dailyLimit, 3, 0, BIG))
  b.groupShare.pendingTtlHours = Math.round(num(b.groupShare.pendingTtlHours, 24, 1, 24 * 30))
  b.groupShare.queueLimit = Math.round(num(b.groupShare.queueLimit, 1, 1, 20))
  b.intervalHours = num(b.intervalHours, 4, 0.1, BIG)
  b.maxRunsPerDay = num(b.maxRunsPerDay, 3, 0, BIG)
  b.perRun = num(b.perRun, 3, 1, BIG)
  b.minViews = num(b.minViews, 5000, 0, BIG * 1e6)
  b.maxAgeDays = num(b.maxAgeDays, 60, 0, BIG)
  b.maxCommentsPerDay = num(b.maxCommentsPerDay, 3, 0, BIG)
  b.maxRepliesPerDay = num(b.maxRepliesPerDay, 6, 0, BIG)
  b.maxDanmakuPerDay = Math.round(num(b.maxDanmakuPerDay, 3, 1, 20))
  b.keywords = (Array.isArray(b.keywords) ? b.keywords : String(b.keywords || '').split(/[\n,，]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 30)
  const hb = c.heybox
  hb.shareToOwner = bool(hb.shareToOwner, true)
  hb.shareBias = ['stingy', 'normal', 'proactive'].includes(hb.shareBias) ? hb.shareBias : 'normal'
  hb.shareDaily = Math.round(num(hb.shareDaily, 3, 0, BIG))
  hb.cookie = String(hb.cookie || '').trim()
  hb.topicMode = hb.topicMode === 'auto' ? 'auto' : 'manual'
  hb.postWordsMin = Math.round(num(hb.postWordsMin, 0, 0, 2000))
  hb.postWordsMax = Math.round(num(hb.postWordsMax, 0, 0, 3000))
  if (hb.postWordsMax && hb.postWordsMin && hb.postWordsMax < hb.postWordsMin) [hb.postWordsMin, hb.postWordsMax] = [hb.postWordsMax, hb.postWordsMin]
  // 每天每篇的排期：最多 5 篇；hashtags 和 hashtagsText 都保留（面板靠 Text 回显，模块靠数组发帖）
  hb.dailyPosts = Array.isArray(hb.dailyPosts) ? hb.dailyPosts.slice(0, 5).map((p) => {
    const o = (p && typeof p === 'object' ? p : {}) as RawConfig
    const splitH = (v: unknown): string[] => String(v ?? '').split(/[\s,，、]+/).map((x) => String(x).trim()).filter(Boolean)
    const hash = (Array.isArray(o.hashtags) ? o.hashtags : splitH(o.hashtagsText)).map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
    return {
      style: ['diary', 'news', 'mix', 'deal'].includes(String(o.style ?? '')) ? String(o.style) : '',
      topic: /^\d{3,7}$/.test(String(o.topic ?? '')) ? String(o.topic) : '',
      hashtags: hash,
      hashtagsText: hash.join(','),
      wordsMin: Math.round(num(o.wordsMin, 0, 0, 2000)),
      wordsMax: Math.round(num(o.wordsMax, 0, 0, 3000)),
      hint: String(o.hint || '').trim().slice(0, 120),
    }
  }) : []   // ⚠ 不能在这里过滤全空项：排期是按下标取的（module 侧 currentPostPlan 用 postsToday() 索引），
             //    过滤掉「第 1 篇留空跟全局、第 2 篇单独配」里的空项，会让第 2 篇的配置被当成第 1 篇用。
             //    空项就代表「这一篇走全局设置」，原样保留位置。
  hb.offPeakOnly = bool(hb.offPeakOnly, false)
  hb.peakStartAM = num(hb.peakStartAM, 9, 0, 23)
  hb.peakEndAM = num(hb.peakEndAM, 12, 0, 24)
  hb.peakStartPM = num(hb.peakStartPM, 14, 0, 23)
  hb.peakEndPM = num(hb.peakEndPM, 18, 0, 24)
  hb.peakWeekend = bool(hb.peakWeekend, false)
  const d = c.douyin
  d.enabled = bool(d.enabled, false)
  d.autoBrowse = bool(d.autoBrowse, true)
  d.intervalHours = num(d.intervalHours, 4, 0.1, BIG)
  d.maxRunsPerDay = num(d.maxRunsPerDay, 3, 0, BIG)
  d.perRun = num(d.perRun, 5, 1, BIG)
  d.maxWatchPerDay = num(d.maxWatchPerDay, 30, 0, BIG)
  d.dwellMin = num(d.dwellMin, 8, 1, BIG)
  d.dwellMax = Math.max(d.dwellMin, num(d.dwellMax, 40, 1, BIG))
  d.browserPath = String(d.browserPath || '').trim()
  d.shareTo = ['douyin', 'qq', 'both'].includes(d.shareTo) ? d.shareTo : 'douyin'
  d.ownerDm = bool(d.ownerDm, true)
  d.dmPollMinutes = num(d.dmPollMinutes, 3, 1, BIG)
  d.shareBias = ['stingy', 'normal', 'proactive'].includes(d.shareBias) ? d.shareBias : d.shareBias === 'off' ? 'stingy' : 'proactive'
  if (!isObj(d.caps)) d.caps = structuredClone(DEFAULTS.douyin.caps)
  const rawDouyinCaps = isObj(rawDouyin.caps) ? rawDouyin.caps : {} as RawConfig
  if (rawDouyinCaps.share == null && rawDouyinCaps.shareOwner != null) d.caps.share = num(rawDouyinCaps.shareOwner, 5, 0, BIG) // 1.0.x 叫 shareOwner
  d.caps = { like: num(d.caps.like, 30, 0, BIG), comment: num(d.caps.comment, 3, 0, BIG), share: num(d.caps.share, 5, 0, BIG), atOwner: num(d.caps.atOwner, 3, 0, 30) }
  if (!isObj(d.owner)) d.owner = structuredClone(DEFAULTS.douyin.owner)
  d.owner = Object.fromEntries(['input', 'secUid', 'uid', 'nickname', 'confirmedInput'].map((k) => [k, String(d.owner[k] ?? '').trim().slice(0, 400)])) as AurabotConfig['douyin']['owner']
  if (!isObj(d.gate)) d.gate = structuredClone(DEFAULTS.douyin.gate)
  d.gate = { maxWritesPerDay: num(d.gate.maxWritesPerDay, 40, 1, BIG), minWriteGapSec: num(d.gate.minWriteGapSec, 20, 0, BIG), newAccountDays: num(d.gate.newAccountDays, 3, 0, 30) }
  // 1.0.x 的 douyin-im / 私信相关设置都不用了
  for (const k of ['atOwnerOnLikeChance', 'minimize', 'socialInterruptBrowse', 'replyPollMinutes']) delete d[k]

  delete c.mood.maxInjectPerDay // 旧版的「每天最多提醒几次」，现在心情明显时每轮都会带上
  // 老配置只有一个 consolidateAt：换成两个时间点（它 + 12 小时后）
  if (!Array.isArray(rawMemory.consolidateTimes) && rawMemory.consolidateAt) {
    const [hh, mm] = hhmm(rawMemory.consolidateAt, '04:00').split(':').map(Number)
    c.memory.consolidateTimes = [`${hh}:${String(mm).padStart(2, '0')}`, `${(hh + 12) % 24}:${String(mm).padStart(2, '0')}`]
  }
  delete c.memory.consolidateAt
  c.memory.consolidateTimes = [...new Set((Array.isArray(c.memory.consolidateTimes) ? c.memory.consolidateTimes : String(c.memory.consolidateTimes || '').split(/[\s,，]+/)).map((t) => hhmm(t, '')).filter(Boolean).map((t) => t.padStart(5, '0')))].sort().slice(0, 4)
  if (!c.memory.consolidateTimes.length) c.memory.consolidateTimes = ['04:00', '16:00']
  if (!isObj(c.chat)) c.chat = structuredClone(DEFAULTS.chat)
  c.chat.seedHistory = bool(c.chat.seedHistory, false)
  c.chat.seedHistoryCount = num(c.chat.seedHistoryCount, 20, 1, BIG)
  // 'auto' = 按本轮有无工具调用来决定（纯对话轮分条发、带工具的轮只发最后一段）
  c.chat.everyStep = c.chat.everyStep === 'auto' ? 'auto' : bool(c.chat.everyStep, false)
  // 近似去重阈值：面板给的是 0–1，配置被手改出界（负数 / >1）时会让「相似度 ≥ 阈值」恒真或恒假，这里收一下。
  const dupRaw = c.chat.dupSimilarity as unknown
  c.chat.dupSimilarity = dupRaw === undefined || dupRaw === null || dupRaw === ''
    ? 0.45
    : (Number.isFinite(Number(dupRaw)) ? Math.min(1, Math.max(0, Number(dupRaw))) : 0.45)
  c.chat.rescueFromThinking = bool(c.chat.rescueFromThinking, false)
  c.chat.thinkingGuard = { enabled: bool(c.chat.thinkingGuard?.enabled, true) }
  c.chat.replyMarker = { enabled: bool(c.chat.replyMarker?.enabled, false) }
  // ACP 标记净化：enabled 默认开（零成本正则）；modelFallback 默认关（要花 token 与延迟）。
  c.chat.acpSanitize = {
    enabled: bool(c.chat.acpSanitize?.enabled, true),
    modelFallback: bool(c.chat.acpSanitize?.modelFallback, false),
    modelMaxChars: Math.round(num(c.chat.acpSanitize?.modelMaxChars, 800, 100, 4000)),
    modelTimeoutMs: Math.round(num(c.chat.acpSanitize?.modelTimeoutMs, 4000, 500, 15000)),
  }
  c.chat.turnTimeoutMinutes = num(c.chat.turnTimeoutMinutes, 30, 0, 180)
  c.memory.recallCount = num(c.memory.recallCount, 6, 0, BIG)
  // 总数护栏：0 表示不限制（直接 recallCount + 联想 assoc.recall）；设了就封顶，防止上下文爆掉
  c.memory.recallTotal = Math.round(num(c.memory.recallTotal, 0, 0, BIG))
  // beta 侧新增：召回最低相关度门槛
  c.memory.recallMinRelevance = num(c.memory.recallMinRelevance, DEFAULTS.memory.recallMinRelevance, 0, 1)
  c.memory.recallMode = c.memory.recallMode === 'trigger' ? 'trigger' : 'always'
  // 遗忘基数：1~365 天。超出范围或非数字回默认 20，不让脏配置把记忆一夜清空。
  c.memory.retentionBase = Math.round(num(c.memory.retentionBase, 20, 1, 365))
  c.memory.recallTriggers = [...new Set((Array.isArray(c.memory.recallTriggers) ? c.memory.recallTriggers : String(c.memory.recallTriggers || '').split(/[\n,，;；]+/)).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 100)
  for (const k of ['chatImpression', 'gistEnabled', 'shortTerm', 'followUp', 'profileOnlyAcquainted']) c.memory[k] = bool(c.memory[k], true)
  c.memory.dislikeSilence = num(c.memory.dislikeSilence, 0.85, 0, 1)
  c.memory.shortTermHours = num(c.memory.shortTermHours, 2, 0.1, BIG)
  c.memory.shortTermIdleMinutes = num(c.memory.shortTermIdleMinutes, 3, 0, BIG)
  c.memory.shortTermChars = Math.round(num(c.memory.shortTermChars, 150, 1, BIG))
  c.memory.recallHintMaxChars = Math.round(num(c.memory.recallHintMaxChars, 900, 300, 4000))
  for (const k of ['profileFieldChars', 'profilePeople', 'profileChars', 'chatImpressionChars', 'gistDays', 'impressionDays', 'gistDailyBatches']) c.memory[k] = Math.round(num(c.memory[k], DEFAULTS.memory[k], 0, BIG))
  if (!isObj(c.memory.tierDays)) c.memory.tierDays = {}
  for (const k of Object.keys(DEFAULT_TIER_DAYS)) c.memory.tierDays[k] = Math.round(num(c.memory.tierDays[k], DEFAULT_TIER_DAYS[k], 0, BIG))
  // 老版本的 0 是当时的默认值，不是谁选的：升级后改成留 7 天，以后面板里再选 0 才算数
  c.memory.passiveGroups = qqList(c.memory.passiveGroups)
  const keepUnset = rawMemory.keepChatlogDays === 0 && !rawMemory.keepChatlogSet
  c.memory.keepChatlogDays = keepUnset ? 7 : num(c.memory.keepChatlogDays, 7, -1, 3650)
  c.memory.keepChatlogSet = true
  c.memory.mergeGroups = bool(c.memory.mergeGroups, false)
  c.memory.residentMaxChars = num(c.memory.residentMaxChars, 1200, 200, 4000)
  c.memory.preferPersonal = bool(c.memory.preferPersonal, true)
  for (const k of ['instantCommands', 'groupMemory', 'searchRrf']) c.memory[k] = bool(c.memory[k], true)
  c.memory.crossContext = bool(c.memory.crossContext, false)
  c.memory.extractIdleMinutes = num(c.memory.extractIdleMinutes, 30, 0, BIG)
  c.memory.extractMinLines = Math.round(num(c.memory.extractMinLines, 20, 1, BIG))
  c.memory.extractDailyBatches = Math.round(num(c.memory.extractDailyBatches, 24, 0, BIG))
  if (!isObj(c.memory.capacity)) c.memory.capacity = structuredClone(DEFAULTS.memory.capacity)
  for (const k of ['auto', 'event', 'diary']) c.memory.capacity[k] = Math.round(num(c.memory.capacity[k], DEFAULTS.memory.capacity[k], 0, BIG))
  c.memory.eventExpireDays = num(c.memory.eventExpireDays, 90, -1, BIG)
  // 记忆压缩：具体的事慢慢淡忘、概括成长期印象（默认开；可以关；多少天以前的细节才参与概括）
  c.memory.compress = bool(c.memory.compress, true)
  c.memory.compressAfterDays = Math.round(num(c.memory.compressAfterDays, 14, 1, 365))
  if (!isObj(c.memory.vector)) c.memory.vector = structuredClone(DEFAULTS.memory.vector)
  const vector = c.memory.vector
  vector.enabled = bool(vector.enabled, false)
  vector.provider = ['siliconflow', 'ark', 'openai', 'ollama', 'custom'].includes(vector.provider) ? vector.provider : 'siliconflow'
  for (const k of ['baseUrl', 'model', 'apiKey']) vector[k] = String(vector[k] || '').trim()
  vector.baseUrl = vector.baseUrl.replace(/\/+$/, '')
  vector.dimensions = Math.round(num(vector.dimensions, 0, 0, 8192))
  vector.batchSize = Math.round(num(vector.batchSize, 10, 1, 64))
  vector.queryTimeoutMs = Math.round(num(vector.queryTimeoutMs, 3000, 500, 15000))
  vector.headers = headerLines(vector.headers)
  // 检索方式：本地小模型（离线，推荐）或自己配的在线服务。
  // 老配置只有 baseUrl、没有 mode（DEFAULTS 会补上 'local'，所以要拿原始输入判断），
  // 这时按「填了地址就是在用在线服务」跑，不然升级后向量检索会悄悄失效。
  const rawVec = isObj(rawMemory.vector) ? rawMemory.vector : {} as RawConfig
  const declaredMode = String(rawVec.mode || '').trim().toLowerCase()
  // mode 是**派生值**（本地小模型 / 在线服务），不是用户直接填的配置项：
  // 定义成不可枚举属性，这样 Object.entries / deepEqual 看不到它（升级兼容测试要求
  // 配置结构和 DEFAULTS 完全一致），也不会被写进配置文件「变成用户显式选择」，
  // 但 cfg.memory.vector.mode 仍能正常读。
  // rawVec.modeExplicit === false 表示这是 normalize 出来的对象（不是用户原始输入）：
  // 再 normalize 时不要把派生 mode 误当成显式选择（#520 旧客户端兼容）。
  const explicitMode = (declaredMode === 'remote' || declaredMode === 'local') && rawVec.modeExplicit !== false
  Object.defineProperty(vector, 'mode', {
    value: explicitMode ? declaredMode : (vector.baseUrl ? 'remote' : 'local'),
    enumerable: false,
    writable: true,
    configurable: true,
  })
  // 区分「用户明确选了 local/remote」和「没写 mode、按 baseUrl 推出来的默认」。
  // 前者在 partial 保存时必须保留；后者要让老客户端只传 baseUrl 仍能切到 remote（#520 兼容）。
  Object.defineProperty(vector, 'modeExplicit', { value: explicitMode, enumerable: false, writable: true, configurable: true })
  if (!isObj(c.memory.rerank)) c.memory.rerank = structuredClone(DEFAULTS.memory.rerank)
  const rerank = c.memory.rerank
  rerank.enabled = bool(rerank.enabled, false)
  for (const k of ['baseUrl', 'model', 'apiKey']) rerank[k] = String(rerank[k] || '').trim()
  rerank.baseUrl = rerank.baseUrl.replace(/\/+$/, '').replace(/\/rerank$/i, '')
  rerank.model = rerank.model || DEFAULTS.memory.rerank.model
  rerank.topN = Math.round(num(rerank.topN, 20, 2, 50))
  rerank.timeoutMs = Math.round(num(rerank.timeoutMs, 2000, 500, 10_000))
  // 向量联想：建边阈值、每个节点最多几条边、每次召回最多带几条
  if (!isObj(c.memory.assoc)) c.memory.assoc = structuredClone(DEFAULTS.memory.assoc)
  c.memory.assoc.enabled = bool(c.memory.assoc.enabled, true)
  c.memory.assoc.minSim = num(c.memory.assoc.minSim, DEFAULTS.memory.assoc.minSim, 0.3, 0.95)
  c.memory.assoc.limit = Math.round(num(c.memory.assoc.limit, DEFAULTS.memory.assoc.limit, 1, 8))
  c.memory.assoc.recall = Math.round(num(c.memory.assoc.recall, DEFAULTS.memory.assoc.recall, 0, 5))
  // 跳数：0 = 只建边不联想，1 = A→B，2 = A→B→C。**封顶 3**，再多就是套娃了。
  c.memory.assoc.hops = Math.round(num(c.memory.assoc.hops, DEFAULTS.memory.assoc.hops, 0, 3))
  c.memory.assoc.hopDecay = num(c.memory.assoc.hopDecay, DEFAULTS.memory.assoc.hopDecay, 0.1, 1)
  // 想起总数护栏：0 = 不额外限制（= 直接 recallCount + 联想 assoc.recall）
  c.memory.recallTotal = Math.round(num(c.memory.recallTotal, 0, 0, BIG))
  // 行为驱动的档位升档
  if (!isObj(c.memory.tierGrow)) c.memory.tierGrow = structuredClone(DEFAULTS.memory.tierGrow)
  c.memory.tierGrow.enabled = bool(c.memory.tierGrow.enabled, true)
  c.memory.tierGrow.perDay = num(c.memory.tierGrow.perDay, DEFAULTS.memory.tierGrow.perDay, 0, 0.2)
  c.memory.tierGrow.minHitDays = Math.round(num(c.memory.tierGrow.minHitDays, DEFAULTS.memory.tierGrow.minHitDays, 0, 60))
  c.memory.tierGrow.cap = num(c.memory.tierGrow.cap, DEFAULTS.memory.tierGrow.cap, 0, 1)
  // 几次联想折算成一天。1 表示联想和直接命中一样重；默认 2 表示联想更轻。
  c.memory.tierGrow.assocPerHitDay = Math.round(num(c.memory.tierGrow.assocPerHitDay, DEFAULTS.memory.tierGrow.assocPerHitDay, 1, 20))
  for (const key of ['tier2', 'tier3']) {
    if (!isObj(c.memory.tierGrow[key])) c.memory.tierGrow[key] = { ...DEFAULTS.memory.tierGrow[key] }
    c.memory.tierGrow[key].hitDays = Math.round(num(c.memory.tierGrow[key].hitDays, DEFAULTS.memory.tierGrow[key].hitDays, 0, 365))
    c.memory.tierGrow[key].imp = num(c.memory.tierGrow[key].imp, DEFAULTS.memory.tierGrow[key].imp, 0, 1)
  }
  g.interests = (Array.isArray(g.interests) ? g.interests : String(g.interests || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.minRelevance = num(g.minRelevance, 0.25, 0, 1)
  // @ 了别人时不算叫她（只挡必回，仍然可以插话）；默认关，保持原行为
  g.ignoreAtOthers = bool(g.ignoreAtOthers, false)
  // 看白名单里别的群：off 关 / private 主人和私聊里的群成员（默认）/ group 群里的成员也行
  g.crossRead = ['off', 'group'].includes(g.crossRead) ? g.crossRead : 'private'
  c.merge.enabled = bool(c.merge.enabled, true)
  c.merge.waitSec = num(c.merge.waitSec, 2.5, 0, BIG)
  c.merge.maxSec = Math.max(c.merge.waitSec, num(c.merge.maxSec, 8, 0, BIG))
  c.merge.groupWaitSec = num(c.merge.groupWaitSec, 5, 0, BIG)
  c.merge.groupMaxSec = Math.max(c.merge.groupWaitSec, num(c.merge.groupMaxSec, 15, 0, BIG))
  if (!isObj(c.forward)) c.forward = structuredClone(DEFAULTS.forward)
  c.forward.expandEarly = bool(c.forward.expandEarly, false)
  c.forward.expandHistory = bool(c.forward.expandHistory, false)
  c.memberFilter = normalizeMemberFilter(c.memberFilter)
  c.titleFilter.enabled = bool(c.titleFilter.enabled, true)
  c.titleFilter.groups = qqList(c.titleFilter.groups) // 和群白名单同一套规则
  c.titleFilter.title = String(c.titleFilter.title ?? '').replace(/[​-‍﻿]/g, '').trim().slice(0, 30) || '大肥鱼'
  g.burstMax = num(g.burstMax, 8, 1, BIG)
  g.engagedMax = num(g.engagedMax, 6, 0, BIG)
  g.burstWindowSec = num(g.burstWindowSec, 120, 1, BIG)
  if (c.voice.keyPools) c.voice.keyPools = normalizePools(c.voice.keyPools)
  c.voice.fishApiKey = String(c.voice.fishApiKey || '').trim()
  c.voice.fishReferenceId = String(c.voice.fishReferenceId || '').trim()
  if (!['auto', 'edge', 'windows', 'cosyvoice', 'gptsovits', 'http', 'volcano', 'breeze', 'minimax', 'fish-free'].includes(c.voice.engine)) c.voice.engine = 'auto'
  c.voice.songVoice = String(c.voice.songVoice || '').slice(0, 120)
  c.voice.songPitch = Math.max(-24, Math.min(24, Math.round(Number(c.voice.songPitch) || 0)))
  c.voice.cosyvoice.sampleRate = num(c.voice.cosyvoice.sampleRate, 22050, 8000, 48000)
  if (!['sft', 'instruct'].includes(c.voice.cosyvoice.mode)) c.voice.cosyvoice.mode = 'sft'
  // edge-tts 的语速 / 音调：只认 ±N% 和 ±NHz，写着玩的回落默认值，超范围的夹回来。
  // ⚠ 0 也必须带符号：面板的选项是 '+0%' / '+0Hz'，少了正号既对不上下拉框，
  //   又会让 `rate !== '+0%'` 成立、把 --rate=0% 传给 edge-tts（它会直接报错）。
  const signed = (n, unit) => (n < 0 ? '-' : '+') + Math.abs(n) + unit
  const pct = /^([+-]?\d{1,3})\s*%$/.exec(String(c.voice.rate || '').trim())
  c.voice.rate = signed(pct ? Math.max(-50, Math.min(50, Number(pct[1]))) : 0, '%')
  const hz = /^([+-]?\d{1,3})\s*Hz$/i.exec(String(c.voice.pitch || '').trim())
  c.voice.pitch = signed(hz ? Math.max(-80, Math.min(80, Number(hz[1]))) : 0, 'Hz')
  c.imageGen.fallbackEnabled = bool(c.imageGen.fallbackEnabled, false)
  c.imageGen.fallbacks = (Array.isArray(c.imageGen.fallbacks) ? c.imageGen.fallbacks : []).map(e => ({ id: String(e?.id || '').slice(0, 100), provider: e?.provider === 'codex' ? 'codex' : 'openai', baseUrl: String(e?.baseUrl || '').trim(), apiKey: String(e?.apiKey || ''), model: String(e?.model || '').trim() })).filter(e => e.id)
  c.imageGen.enabled = bool(c.imageGen.enabled, false)
  // 手工改配置文件 / 从旧版复制过来时，常见前后空格和换行：不归一化会让「看起来填了」的地址或
  // 模型名实际带空白，请求失败又很难查。Key 也去掉换行与首尾空格（不改变可见字符）。
  c.imageGen.baseUrl = String(c.imageGen.baseUrl || '').trim().slice(0, 500)
  c.imageGen.model = String(c.imageGen.model || '').trim().slice(0, 200)
  c.imageGen.apiKey = String(c.imageGen.apiKey || '').trim().slice(0, 500)
  c.imageGen.stylePrompt = String(c.imageGen.stylePrompt || '').trim().slice(0, 500)
  c.imageGen.ownerOnly = bool(c.imageGen.ownerOnly, true)
  c.imageGen.seeOwn = bool(c.imageGen.seeOwn, true)
  c.imageGen.img2img = bool(c.imageGen.img2img, true)
  c.imageGen.allowGif = bool(c.imageGen.allowGif, false)
  if (!/^\d{3,4}x\d{3,4}$/.test(String(c.imageGen.size))) c.imageGen.size = '1024x1024'
  c.imageGen.galleryShown = Math.min(50, Math.max(1, Math.round(Number(c.imageGen.galleryShown) || 20)))
  c.imageGen.shape = ['her', 'square', 'portrait', 'landscape', 'wide'].includes(c.imageGen.shape) ? c.imageGen.shape : 'her'
  // 生视频：接口选择 + 三种接口各自的参数
  if (!isObj(c.video)) c.video = structuredClone(DEFAULTS.video)
  if (!['local', 'minimax', 'custom'].includes(c.video.provider)) c.video.provider = 'local'
  c.video.confirm = bool(c.video.confirm, true)
  c.video.enhance = bool(c.video.enhance, true)
  c.video.selfView = bool(c.video.selfView, true)
  if (!isObj(c.video.minimax)) c.video.minimax = structuredClone(DEFAULTS.video.minimax)
  if (!isObj(c.video.custom)) c.video.custom = structuredClone(DEFAULTS.video.custom)
  if (!['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max'].includes(c.video.minimax.model)) c.video.minimax.model = 'MiniMax-H3'
  if (!['480P', '768P', '2K'].includes(c.video.minimax.resolution)) c.video.minimax.resolution = '768P'
  if (c.video.minimax.model !== 'MiniMax-H3' && c.video.minimax.resolution === '2K') c.video.minimax.resolution = '768P'
  if (!['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', 'adaptive'].includes(c.video.minimax.ratio)) c.video.minimax.ratio = '16:9'
  c.video.minimax.duration = num(c.video.minimax.duration, 5, 4, 15)
  c.video.minimax.pollMs = num(c.video.minimax.pollMs, 5000, 1000, 60000)
  c.video.minimax.apiKey = String(c.video.minimax.apiKey || '').trim()
  c.video.minimax.baseUrl = String(c.video.minimax.baseUrl || '').trim() || 'https://api.minimax.cn'
  c.video.custom.createUrl = String(c.video.custom.createUrl || '').trim()
  c.video.custom.queryUrl = String(c.video.custom.queryUrl || '').trim()
  c.video.custom.createMethod = String(c.video.custom.createMethod || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  c.video.custom.pollMs = num(c.video.custom.pollMs, 5000, 1000, 60000)
  for (const k of ['taskIdPath', 'statusPath', 'successValue', 'failValue', 'urlPath']) {
    c.video.custom[k] = String(c.video.custom[k] || '').trim() || DEFAULTS.video.custom[k]
  }

  // provider：custom = 自己填接口（GET/POST + 自定义参数），minimax = MiniMax H3 Image，其它按 OpenAI 兼容
  c.imageGen.provider = ['custom', 'codex', 'minimax'].includes(c.imageGen.provider) ? c.imageGen.provider : 'openai'
  // 「服务地址」下拉的用户自添地址：{ name, url }；只要 http(s) 链接，按地址去重，最多 20 条
  // （官方推荐的赞助商地址固定第一项，不存这里；旧版只存字符串的自动用域名当名字）
  c.imageGen.baseUrlOptions = (Array.isArray(c.imageGen.baseUrlOptions) ? c.imageGen.baseUrlOptions : [])
    .map((o) => typeof o === 'string' ? { name: '', url: o } : { name: String((o && o.name) || '').trim().slice(0, 60), url: String((o && o.url) || '').trim().slice(0, 500) })
    .filter((o) => /^https?:\/\//.test(o.url) && o.url !== 'https://ntmd.cn/v1')
    .map((o) => { if (o.name) return o; try { return { ...o, name: new URL(o.url).hostname } } catch { return { ...o, name: o.url } } })
    .filter((o, i, a) => a.findIndex((x) => x.url === o.url) === i)
    .slice(0, 20)
  if (!isObj(c.imageGen.codex)) c.imageGen.codex = { ...DEFAULTS.imageGen.codex }
  const igx = c.imageGen.codex
  // 只校验格式，不再按固定白名单改写：#256 —— 预设之外的合法模型名要原样保留，
  // 服务端到底支不支持由实际请求结果说话（静默换成别的模型比报错更难查）。
  igx.model = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(String(igx.model || '').trim())
    ? String(igx.model).trim() : DEFAULTS.imageGen.codex.model
  igx.quality = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(igx.quality) ? igx.quality : 'auto'
  igx.background = ['auto', 'transparent', 'opaque'].includes(igx.background) ? igx.background : 'auto'
  if (!c.imageGen.custom || typeof c.imageGen.custom !== 'object') c.imageGen.custom = { ...DEFAULTS.imageGen.custom }
  if (!isObj(c.imageGen.minimax || null)) c.imageGen.minimax = structuredClone(DEFAULTS.imageGen.minimax)
  const igm = c.imageGen.minimax
  igm.apiKey = String(igm.apiKey || '').trim().slice(0, 400)
  // 允许按 OpenAI 习惯填到 /v1；内部拼接口时只保留一个版本前缀（/v1/images/...）。
  igm.baseUrl = String(igm.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '').slice(0, 400) || DEFAULTS.imageGen.minimax.baseUrl
  igm.model = ['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed'].includes(String(igm.model)) ? String(igm.model) : DEFAULTS.imageGen.minimax.model
  igm.n = num(igm.n, 1, 1, 10)
  igm.area = ['1K', '2K', '4K'].includes(String(igm.area)) ? String(igm.area) : DEFAULTS.imageGen.minimax.area
  igm.enhance = bool(igm.enhance, true)
  const igc = c.imageGen.custom
  igc.method = String(igc.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  igc.bodyType = igc.bodyType === 'form' ? 'form' : 'json'
  igc.url = String(igc.url || '').trim().slice(0, 2000)
  igc.responsePath = String(igc.responsePath || '').trim().slice(0, 200)
  igc.params = (Array.isArray(igc.params) ? igc.params : [])
    .map((p) => ({ key: String((p && p.key) || '').trim().slice(0, 60), value: String(p && p.value != null ? p.value : '').slice(0, 500) }))
    .filter((p) => p.key)
    .slice(0, 30)

  c.song.enabled = bool(c.song.enabled, false)
  c.song.ownerOnly = bool(c.song.ownerOnly, true)
  c.song.pitch = num(c.song.pitch, 0, -24, 24)
  c.song.autoPitch = bool(c.song.autoPitch, true)
  if (!['female', 'male'].includes(c.song.selfVoice)) c.song.selfVoice = 'female'
  c.song.maxVoiceSec = num(c.song.maxVoiceSec, 120, 1, BIG)
  c.song.vocalVolume = num(c.song.vocalVolume, 1, 0, 10)
  c.song.instVolume = num(c.song.instVolume, 0.8, 0, 10)
  if (!['auto', 'head'].includes(c.song.clipStart)) c.song.clipStart = 'auto'
  // 老配置：'' 是以前的默认（没开），改成自动；tuna 是以前的「用镜像」
  c.song.pypiMirror = { '': 'auto', tuna: 'cn' }[c.song.pypiMirror] ?? c.song.pypiMirror
  if (!['auto', 'cn', 'off'].includes(c.song.pypiMirror)) c.song.pypiMirror = 'auto'
  c.song.root = String(c.song.root || '').trim()
  // 云备份：owner/repo 去空格，令牌按密钥处理（SECRETS 里有登记）。
  // owner/repo 只留 URL 白名单字符（@ : / ? # 空格等能改语义的直接去掉，push 时还有白名单硬校验兜底）；
  // branch 拒 .. 与 - 开头，防 refspec/选项注入。
  if (!isObj(c.backup)) c.backup = structuredClone(DEFAULTS.backup)
  if (!isObj(c.backup.remote)) c.backup.remote = { ...DEFAULTS.backup.remote }
  const br = c.backup.remote
  br.enabled = bool(br.enabled, false)
  br.owner = String(br.owner || '').trim().replace(/^https?:\/\//i, '').replace(/^gitee\.com\//i, '').split(/[/?]/)[0].replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.repo = String(br.repo || '').trim().replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.token = String(br.token || '').trim()
  br.branch = String(br.branch || '').trim().replace(/^refs\/heads\//, '').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^[.\-]+/, '').replace(/\.\.+/g, '.').slice(0, 100) || 'master'
  br.time = hhmm(br.time, '03:30')
  br.keep = Math.round(num(br.keep, 7, 1, 365))
  br.autoCreate = bool(br.autoCreate, true)
  br.forceOverwrite = bool(br.forceOverwrite, false)
  if (!isObj(c.modules)) c.modules = {}
  for (const [id, m] of Object.entries(c.modules)) {
    if (!isObj(m)) { delete c.modules[id]; continue }
    m.enabled = bool(m.enabled, true)
    m.useBuiltin = bool(m.useBuiltin, false)
  }
  if (!isObj(c.ext)) c.ext = {}
  for (const k of Object.keys(c.ext)) if (!isObj(c.ext[k])) delete c.ext[k] // 传 null = 删掉这个模块的设置
  // 兼容自驱引擎旧面板 bug（#512）：设置被写进 ext.autotelic[""]，把空键里的值并回父级。
  const autotelicExt = c.ext.autotelic
  if (isObj(autotelicExt) && isObj(autotelicExt[''])) {
    const legacy = autotelicExt['']
    delete autotelicExt['']
    for (const [k, v] of Object.entries(legacy)) if (!Object.hasOwn(autotelicExt, k)) autotelicExt[k] = v
  }
  c.safeMode = bool(c.safeMode, false)
  // 花费估算的价格表：仅用于渠道估算；留空不影响官方参考费用
  if (!isObj(c.usage)) c.usage = { pricing: {} }
  if (!isObj(c.usage.pricing)) c.usage.pricing = {}
  c.bridge.dshTools = bool(c.bridge.dshTools, false)
  c.bridge.http = bool(c.bridge.http, false)
  c.bridge.token = String(c.bridge.token || '')
  if (!['whitelist', 'owner'].includes(c.bridge.allowTargets)) c.bridge.allowTargets = 'whitelist'
  return c
}

// 面板里不回传原文的字段：路径（几层都行）
const SECRETS = [['voice', 'fishApiKey'], ['onebot', 'httpToken'], ['onebot', 'wsToken'], ['imageGen', 'apiKey'], ['imageGen', 'minimax', 'apiKey'], ['voice', 'asrApi', 'apiKey'], ['memory', 'vector', 'apiKey'], ['memory', 'rerank', 'apiKey'], ['song', 'neteaseCookie'], ['bili', 'cookie'], ['bili', 'sessdata'], ['bili', 'biliJct'], ['heybox', 'cookie'], ['bridge', 'token'], ['video', 'minimax', 'apiKey'], ['video', 'custom', 'headers'], ['voice', 'volcano', 'apiKey'], ['voice', 'breeze', 'key'], ['voice', 'breeze', 'password'], ['voice', 'minimax', 'apiKey'], ['backup', 'remote', 'token'], ['backup', 'remote', 'webdav', 'password']]
// 扩展模块设置里的密码类字段（模块加载时登记）：['ext', 模块id, 字段]
const extraSecrets = new Map()
export function registerSecretField(path) { extraSecrets.set(path.join('\u0000'), path) }
const allSecrets = () => [...SECRETS, ...extraSecrets.values()]
const parentOf = (obj, path, create) => {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) { if (!create) return null; cur[k] = {} }
    cur = cur[k]
  }
  return cur
}
const getAt = (obj, path) => { const p = parentOf(obj, path, false); return p ? p[path.at(-1)] : undefined }
// 这些密钥在面板里显示结尾几位（「已保存（结尾 …a1b2）」），方便认出存的是哪一份；完整值不回传
const HINTED = [['bili', 'sessdata'], ['bili', 'biliJct']]

/** 从一串 Cookie 里取某个值（「SESSDATA=xxx; bili_jct=yyy」）。 */
export function cookieValue(raw, key) {
  for (const part of String(raw || '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === key) return part.slice(i + 1).trim()
  }
  return ''
}

/**
 * 把票和设备指纹拼成接口要的 Cookie 串。字段顺序固定：SESSDATA → bili_jct → buvid3 → buvid4 → DedeUserID。
 * 扫码登录、配置归一化、手工粘贴三条路都走这里——各拼一份的话，字段或顺序漂移一次，票就和指纹对不上了。
 */
export function buildBiliCookie({ sessdata = '', biliJct = '', buvid3 = '', buvid4 = '', dedeUserId = '' } : BuildBiliCookieOptions = {}) {
  return [
    sessdata && `SESSDATA=${sessdata}`,
    biliJct && `bili_jct=${biliJct}`,
    buvid3 && `buvid3=${buvid3}`,
    buvid4 && `buvid4=${buvid4}`,
    dedeUserId && `DedeUserID=${dedeUserId}`,
  ].filter(Boolean).join('; ')
}

/**
 * B 站 Cookie 整理成完整指纹：粘了整串 / 带了「SESSDATA=」前缀的都认得；老配置只有整串的拆开。
 * 返回 {sessdata, biliJct, buvid3, buvid4, dedeUserId, cookie}，cookie 是拼好给接口用的。
 * 设备指纹三项优先用字段，为空时从整串 cookie 里补（扫码登录写回配置后，重启也沿用同一个指纹）。
 */
export function splitBiliCookie({ sessdata = '', biliJct = '', cookie = '', buvid3 = '', buvid4 = '', dedeUserId = '' } : SplitBiliCookieOptions = {}) {
  const a = String(sessdata || '').trim()
  const b = String(biliJct || '').trim()
  // 框里粘的是「xxx=…」这种整串或带前缀的：从里面取；纯值原样用
  const isRaw = (v) => /(^|;\s*)(SESSDATA|bili_jct)=/.test(v)
  let s = isRaw(a) ? '' : a
  let j = isRaw(b) ? '' : b
  for (const v of [a, b]) {
    if (!isRaw(v)) continue
    s = cookieValue(v, 'SESSDATA') || s
    j = cookieValue(v, 'bili_jct') || j
  }
  if (!s && !j && cookie) {
    s = cookieValue(cookie, 'SESSDATA')
    j = cookieValue(cookie, 'bili_jct')
  }
  // 指纹：字段优先；没填就从整串 cookie / 粘进来的整串里找。都没有就保持空串，不产生空段。
  let b3 = String(buvid3 || '').trim()
  let b4 = String(buvid4 || '').trim()
  let uid = String(dedeUserId || '').trim()
  if (!b3 || !b4 || !uid) {
    const sources = [cookie, isRaw(a) ? a : '', isRaw(b) ? b : ''].filter(Boolean)
    for (const src of sources) {
      if (!b3) b3 = cookieValue(src, 'buvid3')
      if (!b4) b4 = cookieValue(src, 'buvid4')
      if (!uid) uid = cookieValue(src, 'DedeUserID')
    }
  }
  return { sessdata: s, biliJct: j, buvid3: b3, buvid4: b4, dedeUserId: uid, cookie: buildBiliCookie({ sessdata: s, biliJct: j, buvid3: b3, buvid4: b4, dedeUserId: uid }) }
}

const FILE = () => dataDir('config.json')

/** 在某次更新里新增、会替她公开发东西的功能。以后再加这类功能，把配置键名加到这里。 */
export const OPT_IN_ON_UPDATE = ['qzoneSocial', 'bili', 'douyin']

export function loadConfig() {
  const raw = readJson(FILE(), {})
  // 老配置（向导上线前就填好了两个号）直接算向导已完成
  if (raw && raw.setupDone === undefined && raw.botQQ && raw.ownerQQ) raw.setupDone = true
  // 更新插件后新增的、会公开发东西的功能：老用户先关着，等他们自己在面板里打开（新安装照常默认开）
  if (raw && raw.setupDone) for (const k of OPT_IN_ON_UPDATE) if (raw[k] === undefined) raw[k] = { enabled: false }
  return normalize(raw)
}

export function ownerAuthorizationRevision(cfg) {
  const binding = cfg.ownerAuthorization
  return cfg.ownerQQ && binding?.owner === cfg.ownerQQ && typeof binding.revision === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(binding.revision) ? binding.revision : ''
}

// vector.mode 是 normalize 里的不可枚举派生值；JSON.stringify 会丢掉它，
// 面板切「本地/在线」就永远写不进 config.json（#520）。落盘前复制一份并把它变成可枚举字段。
function withVectorMode(c) {
  const mode = c?.memory?.vector?.mode
  // 只持久化用户显式选择过的 mode；默认 local 是从空 baseUrl 推出来的派生值，写盘后会
  // 在下次 load 被误当成 modeExplicit=true，导致旧客户端只传 baseUrl 永远切不到在线（#520）。
  if (!mode || c?.memory?.vector?.modeExplicit !== true) return c
  return { ...c, memory: { ...c.memory, vector: { ...c.memory.vector, mode } } }
}

export function saveConfig(cfg, previous = loadConfig()) {
  // 非枚举的 vector.mode 经 spread/structuredClone 会丢；调用方没显式带 mode 时，
  // 沿用上一份权威配置的 mode，避免一次无关保存把「本地」又推回 baseUrl 推断的 remote（#520 复审）。
  const input = (() => {
    const hasMode = cfg?.memory?.vector && Object.hasOwn(cfg.memory.vector, 'mode')
    const prevMode = previous?.memory?.vector?.mode
    if (hasMode || !prevMode || previous?.memory?.vector?.modeExplicit !== true) return cfg
    return { ...(cfg || {}), memory: { ...(cfg?.memory || {}), vector: { ...(cfg?.memory?.vector || {}), mode: prevMode } } }
  })()
  const c = normalize(input)
  // Only the previous authoritative configuration can carry an authorization forward.
  if (c.ownerQQ) {
    const revision = c.ownerQQ === previous.ownerQQ ? ownerAuthorizationRevision(previous) : ''
    c.ownerAuthorization = { owner: c.ownerQQ, revision: revision || randomUUID() }
  } else delete c.ownerAuthorization
  writeJson(FILE(), withVectorMode(c))
  return c
}

// ---------- 面板首屏提速：配置提交版本（方案 §2.2） ----------
// 「持久化落盘 + 发布新内存配置 + configRevision 递增」收敛为一个同步提交函数 commitConfig：
// 启动初始化、面板 /save、运行期模块/命令/面板写入等各路径统一走它，保证版本号在实例内单调递增。
let configRevisionCounter = 0
/** 当前已发布配置的版本号（本次宿主实例内单调递增；重启后随新 bootId 从头计）。 */
export function configRevision() { return configRevisionCounter }
/**
 * 同步提交一份配置：落盘 + 递增版本。归一化结果与已发布配置完全一致时，不重复落盘、不递增——
 * 「只提交了没变化的字段」的面板保存回执返回接纳时的版本。返回值语义与 saveConfig 一致
 * （归一化后的配置），既有调用方（含模块 API setConfig）不受影响。
 */
export function commitConfig(cfg, previous = loadConfig()) {
  const c = saveConfig(cfg, previous)
  // JSON.stringify 看不到不可枚举的 vector.mode；比较时要把它带上，否则只切本地/在线会被当成没变化。
  if (previous && JSON.stringify(withVectorMode(c)) === JSON.stringify(withVectorMode(previous))) return previous
  configRevisionCounter++
  return c
}

/** 给面板看的版本：密码 / token 不回传原文，只告诉有没有填。 */
export function publicConfig(cfg) {
  const c = structuredClone(cfg)
  maskPools(c.voice?.keyPools)
  // vector.mode 回传面板（#520）：面板切到「在线服务」后重载又回退「本地模型」。
  // 现在 mode 是 normalize 里直接赋值的常规字段，structuredClone 已能带上；这行留着兜住
  // 旧配置里从派生值过来的情形，不额外造字段。
  if (c.memory?.vector && cfg?.memory?.vector?.mode) c.memory.vector.mode = cfg.memory.vector.mode
  delete c.ownerAuthorization
  // 面板上的「试运行」只表示「试运行但不调试」：调试开着时它显示为关
  c.dryRun = Boolean(c.dryRun && !c.debug)
  // 面板要能显示/修改「单个聊天的思考档位」（chatEfforts），所以回传这份配置；
  // 它本来就不含敏感内容，只是「聊天 → 模型 → 档位」的映射。
  for (const [g, k] of HINTED) c[g][`${k}Hint`] = c[g][k] ? '…' + String(c[g][k]).slice(-4) : ''
  for (const path of allSecrets()) {
    const p = parentOf(c, path, false)
    if (!p) continue
    const k = path.at(-1)
    p[`${k}Set`] = Boolean(p[k])
    p[k] = ''
  }
  for (const e of c.imageGen.fallbacks || []) { e.apiKeySet = Boolean(e.apiKey); e.apiKey = '' }
  return c
}

/** 面板保存时：没改的密码字段（空串）保留原值。 */
export function mergeFromPanel (current: AurabotConfig, incoming: RawConfig | null | undefined): AurabotConfig {
  const next = deepMerge<AurabotConfig>(current, incoming || {})
  const incomingVoice = isObj(incoming?.voice) ? incoming.voice : {} as RawConfig
  if (incomingVoice.keyPools) {
    next.voice.keyPools = { ...next.voice.keyPools }
    restorePoolKeys(next.voice.keyPools, current.voice?.keyPools, incomingVoice.keyPools as RawPools)
  }
  // 面板局部保存不带 vector 时用上一份 mode 补回，否则 baseUrl 会把用户选中的 local
  // 在 normalize 里重新推成 remote（#520）。
  const incomingVector = isObj(incoming?.memory) && isObj(incoming.memory.vector) ? incoming.memory.vector : {} as RawConfig
  const incomingMode = incomingVector.mode
  const keepMode = incomingMode === 'local' || incomingMode === 'remote'
    ? incomingMode
    : (current?.memory?.vector?.modeExplicit === true ? current.memory.vector.mode : '')
  if (next.memory?.vector && keepMode) next.memory.vector.mode = keepMode
  // 面板明确带了非空 chatEfforts（面板上改过单个聊天的档位）就以面板为准；
  // 没带或带的是空对象（旧版面板 / 面板没动过）时保留当前值——QQ 里 /effort 设过的不被清掉。
  const incomingEfforts = incoming?.chatEfforts
  next.chatEfforts = incomingEfforts && typeof incomingEfforts === 'object' && Object.keys(incomingEfforts).length
    ? incomingEfforts as AurabotConfig['chatEfforts']
    : current.chatEfforts
  for (const path of allSecrets()) {
    const v = getAt(incoming || {}, path)
    const p = parentOf(next, path, v !== undefined)
    if (!p) continue
    const k = path.at(-1)
    if (v === null) p[k] = '' // 明确传 null = 清空
    else if (v === undefined || v === '') p[k] = getAt(current, path) ?? ''
    delete p[`${k}Set`]
    delete p[`${k}Hint`]
  }
  if (isObj(incoming?.imageGen) && Array.isArray(incoming.imageGen.fallbacks)) {
    const old = new Map((current.imageGen?.fallbacks || []).map(e => [e.id, e]))
    next.imageGen.fallbacks = (incoming.imageGen.fallbacks as Array<Partial<ImageFallback> | null>).map(e => ({
      id: e?.id ?? '',
      provider: e?.provider ?? '',
      baseUrl: e?.baseUrl ?? '',
      model: e?.model ?? '',
      apiKey: e?.apiKey === null ? '' : (e?.apiKey || old.get(e?.id ?? '')?.apiKey || ''),
    }))
  }
  // 主人的抖音 secUid / uid / 昵称只能由「核对」写入，面板存配置时保留原值
  next.douyin.owner = { ...next.douyin.owner, ...Object.fromEntries(['secUid', 'uid', 'nickname', 'confirmedInput'].map((k) => [k, current.douyin?.owner?.[k] ?? ''])) }
  // 联动密钥只由插件生成，面板不能改
  next.bridge.token = current.bridge?.token || ''
  // B 站：只改了其中一个值时，另一个保留；整串粘进来的会在 normalize 里拆开
  const incomingBili = isObj(incoming?.bili) ? incoming.bili : {} as RawConfig
  if (incomingBili.sessdata || incomingBili.biliJct) next.bili.cookie = ''
  const incomingGroup = isObj(incoming?.group) ? incoming.group : {} as RawConfig
  if (incomingGroup.overrides) next.group.overrides = incomingGroup.overrides as AurabotConfig['group']['overrides']
  // 按聊天选模型：两张表整张替换（deepMerge 会让删掉的条目又回来）
  const incomingChatModels = isObj(incoming?.chatModels) ? incoming.chatModels : {} as RawConfig
  if (incomingChatModels.privates) next.chatModels.privates = incomingChatModels.privates as AurabotConfig['chatModels']['privates']
  if (incomingChatModels.groups) next.chatModels.groups = incomingChatModels.groups as AurabotConfig['chatModels']['groups']
  if (isObj(incoming?.allow)) next.allow = { ...current.allow, ...incoming.allow }
  return normalize(next)
}

