// 今日统计：按日期落盘，同一天重启继续累计，跨天自动重置；只在脏了时节流写盘。
import { readJson, writeJson } from '../../core/store/index.ts'

export interface HubStats {
  received: number
  sent: number
  voice: number
  stickers: number
  errors: number
  day: string
}

const KEYS = ['received', 'sent', 'voice', 'stickers', 'errors'] as const

const empty = (day: string): HubStats => ({ received: 0, sent: 0, voice: 0, stickers: 0, errors: 0, day })

export function createStats ({ file, log }) {
  let value: HubStats = (() => {
    const today = new Date().toDateString()
    try {
      const saved = readJson(file, null)
      if (saved && typeof saved === 'object' && saved.day === today) {
        const next = empty(today)
        for (const k of KEYS) {
          const n = Number(saved[k])
          if (Number.isFinite(n) && n >= 0) next[k] = Math.floor(n)
        }
        return next
      }
    } catch (error) { log.debug('今日统计读不出来，从零开始：', error.message) }
    return empty(today)
  })()

  let dirty = false
  let timer = null

  function save (force = false) {
    if (!dirty && !force) return
    dirty = false
    try { writeJson(file, value) } catch (error) { log.debug('今日统计写盘失败：', error.message) }
  }

  function schedule () {
    if (timer) return
    timer = setTimeout(() => { timer = null; save() }, 5000)
    timer.unref?.()
  }

  function bump (key: keyof Omit<HubStats, 'day'>) {
    const day = new Date().toDateString()
    if (value.day !== day) value = empty(day)
    value[key]++
    dirty = true
    schedule()
  }

  return { get value () { return value }, bump, save }
}
