import { clone } from '../api/api.ts'

// /save 回执的 committedPaths / unchangedPaths 是 JSON Pointer（如 /voice/enabled）；
// 草稿内部用点路径（voice.enabled），这里换算（~0/~1 转义按 RFC 6901 还原）。
const ptrToDots = (ptr) => String(ptr || '').split('/').filter(Boolean)
  .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~')).join('.')

const setPath = (obj, path, value) => {
  const next = clone(obj)
  let cur = next
  const ks = path.split('.')
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] = cur[ks[i]] || {}
  cur[ks[ks.length - 1]] = value
  return next
}

// ---------------- token 用量显示 ----------------
// Compact display only; accounting always retains the original integers.
const fmtTokens = (n) => {
  const v = Math.max(0, Math.round(Number(n) || 0))
  const units = ['', 'K', 'M', 'B']
  let unit = 0
  while (unit < units.length - 1 && v >= 1000 ** (unit + 1)) unit++
  let scaled = Number((v / 1000 ** unit).toFixed(2))
  // Rounding at a boundary should read 1M, not 1000K.
  if (scaled >= 1000 && unit < units.length - 1) { scaled = Number((scaled / 1000).toFixed(2)); unit++ }
  return String(scaled) + units[unit]
}
/**
 * 花费：「0.05 元」——「元」放后面（中文习惯），货币符号（¥ / $）才放前面。
 * 小于 1 分保留 4 位并去掉多余的 0（0.008 元），别显示成 0.00。
 */

const fmtCost = (n, currency = '元') => {
  const v = Number(n) || 0
  if (v > 0 && v < 0.0001) return '< ' + fmtCost(0.0001, currency)
  const text = v === 0 ? '0' : v < 0.01 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(2)
  return /[\u3400-\u9fff]/.test(String(currency)) ? text + ' ' + currency : String(currency) + text
}
/** chatId → 好认的名字：group:602656027 → 「群 602656027」，system:bili → 「后台 · bili」 */

const chatLabel = (k) => {
  if (!k || k === '（未知）') return '其他后台任务'
  const [kind, id] = String(k).split(':')
  if (kind === 'group') return '群 ' + id
  if (kind === 'private') return '私聊 ' + id
  if (kind === 'system') return '后台 · ' + String(id || '').replace(/^ext-/, '')
  return String(k)
}

const getPath = (obj, path, fallback?) => {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  return v === undefined ? fallback : v
}

const pct = (v) => Math.round((Number(v) || 0) * 100)

const timeAgo = (t) => {
  if (!t) return '—'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return new Date(t).toLocaleDateString()
}

const copy = (text, toast, msg?) => { try { navigator.clipboard.writeText(text); if (msg) toast(msg, 'ok') } catch (e) { toast('复制失败，手动选中复制吧', 'err') } }

const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : (n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1) + ' MB')

const fmtDur = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec >= 60 ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒' }

/** 装到哪里：列出每个盘和剩余空间，点一下选；也可以自己填路径。 */

export { ptrToDots, setPath, fmtTokens, fmtCost, chatLabel, getPath, pct, timeAgo, copy, fmtBytes, fmtDur }
