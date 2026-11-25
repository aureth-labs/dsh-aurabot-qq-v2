// 日志：按天写文件 + 内存里留最近几百条给面板看。所有文本先脱敏。

import { appendFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, ensureDir } from './store.ts'
import { redact } from './redact.ts'

const RING = 500
const LEVELS = ['debug', 'info', 'warn', 'error'] as const

/** 日志级别。 */
export type LogLevel = typeof LEVELS[number]

/** 一条日志（面板「日志」页读的就是它）。 */
export interface LogEntry { t: number; time: string; level: LogLevel; area: string; text: string }

/** 过滤条件：级别不低于 level，区域相等。 */
export interface LogFilter { level?: LogLevel; area?: string }

/** 某个区域的日志器：每个方法都把参数脱敏后拼成一行。 */
export interface AreaLogger {
  debug: (...args: unknown[]) => LogEntry
  info: (...args: unknown[]) => LogEntry
  warn: (...args: unknown[]) => LogEntry
  error: (...args: unknown[]) => LogEntry
}

/** 宿主给的日志器（DSH 的 dsh.logger），有哪个级别就用哪个。 */
interface HostLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
}

/** createLogger 的入参。 */
export interface CreateLoggerOptions {
  dsh?: { logger?: HostLogger } | null
  retainDays?: number
}

/** createLogger 的产物。 */
export interface Logger extends AreaLogger {
  child (area: string): AreaLogger
  recent (limit?: number, filter?: LogFilter): LogEntry[]
  onEntry (fn: (entry: LogEntry) => void): () => void
}

export function createLogger ({ dsh, retainDays = 14 }: CreateLoggerOptions = {}): Logger {
  const ring: LogEntry[] = []
  const listeners = new Set<(entry: LogEntry) => void>()
  const dir = (): string => ensureDir(dataDir('logs'))
  let lastCleanup = 0

  function cleanup (): void {
    const now = Date.now()
    if (now - lastCleanup < 6 * 3600_000) return
    lastCleanup = now
    try {
      for (const name of readdirSync(dir())) {
        const p = join(dir(), name)
        if (now - statSync(p).mtimeMs > retainDays * 86400_000) unlinkSync(p)
      }
    } catch { /* 日志目录被占 / 没权限：不影响写日志本身 */ }
  }

  function write (level: LogLevel, area: string, message: string): LogEntry {
    const text = redact(message)
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const entry: LogEntry = { t: d.getTime(), time, level, area, text }
    ring.push(entry)
    if (ring.length > RING) ring.shift()
    try {
      appendFileSync(join(dir(), `aurabot-${day}.log`), `${day} ${time} [${level}] [${area}] ${text}\n`, 'utf8')
    } catch { /* 写不进磁盘还有内存环和宿主日志 */ }
    try {
      const fn = level === 'error' ? dsh?.logger?.error : level === 'warn' ? dsh?.logger?.warn : dsh?.logger?.info
      if (level !== 'debug') fn?.call(dsh?.logger, `aurabot[${area}]: ${text}`)
    } catch { /* 宿主日志坏了不影响我们自己的 */ }
    for (const l of listeners) {
      try { l(entry) } catch { /* 一个监听器抛错不影响别的 */ }
    }
    cleanup()
    return entry
  }

  const api: Logger = {
    debug: (...args) => write('debug', 'core', args.map(fmt).join(' ')),
    info: (...args) => write('info', 'core', args.map(fmt).join(' ')),
    warn: (...args) => write('warn', 'core', args.map(fmt).join(' ')),
    error: (...args) => write('error', 'core', args.map(fmt).join(' ')),
    child (area: string): AreaLogger {
      const c = {} as AreaLogger
      for (const lv of LEVELS) c[lv] = (...args: unknown[]) => write(lv, area, args.map(fmt).join(' '))
      return c
    },
    recent (limit = 200, filter: LogFilter = {}): LogEntry[] {
      return ring
        .filter((e) => (!filter.level || LEVELS.indexOf(e.level) >= LEVELS.indexOf(filter.level)) && (!filter.area || e.area === filter.area))
        .slice(-limit)
    },
    onEntry (fn: (entry: LogEntry) => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
  return api
}

function fmt (v: unknown): string {
  if (v instanceof Error) return v.message
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}
