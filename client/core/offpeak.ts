

// ---------------- DeepSeek 峰谷（前端只读展示，逻辑与 src/core/offpeak.js 保持一致） ----------------
const BJ_OFFSET = 8 * 3600_000 // 北京时间 = UTC+8（中国无夏令时）

const pad2 = (n) => String(n).padStart(2, '0')

const bjKeyOf = (ms) => { const d = new Date(ms + BJ_OFFSET); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` }

const bjPartsOf = (ms) => { const d = new Date(ms + BJ_OFFSET); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() } }

// 峰时：工作日北京时间 09:00–12:00 / 14:00–18:00（= UTC 01–04 / 06–10）；周末和节假日全天谷价
const isPeakAt = (ms, holidays) => {
  const p = bjPartsOf(ms)
  if (p.dow === 0 || p.dow === 6) return false
  if ((holidays || []).includes(bjKeyOf(ms))) return false
  const hh = new Date(ms).getUTCHours()
  return (hh >= 1 && hh < 4) || (hh >= 6 && hh < 10)
}

const nextChangeAt = (ms, holidays) => {
  const nowPeak = isPeakAt(ms, holidays)
  const p = bjPartsOf(ms)
  const cands = []
  for (let off = 0; off <= 8; off++) {
    const dayStart = Date.UTC(p.y, p.m - 1, p.d + off) - BJ_OFFSET // 北京时间当天 0 点
    for (const hh of [0, 6, 9, 12, 14, 18]) { const at = dayStart + hh * 3600_000; if (at > ms) cands.push(at) }
  }
  cands.sort((a, b) => a - b)
  for (const at of cands) if (isPeakAt(at, holidays) !== nowPeak) return at
  return null
}

const fmtNextChange = (at, now) => {
  const bj = new Date(at + BJ_OFFSET)
  const hm = pad2(bj.getUTCHours()) + ':' + pad2(bj.getUTCMinutes())
  const a = bjPartsOf(at)
  const n = bjPartsOf(now)
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86400_000)
  if (days <= 0) return hm
  if (days === 1) return '明天 ' + hm
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][a.dow] + ' ' + hm
}

export { BJ_OFFSET, pad2, bjKeyOf, bjPartsOf, isPeakAt, nextChangeAt, fmtNextChange }
