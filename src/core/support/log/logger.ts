// 日志：按天写文件 + 内存里留最近几百条给面板看。所有文本先脱敏。

import { appendFileSync, closeSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, ensureDir } from '../../store/index.ts'
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
  /** 调试模式开关：关着时 debug 不入环、不落盘（面板日志页也就看不到）。 */
  debugEnabled?: () => boolean
}

/** createLogger 的产物。 */
export interface Logger extends AreaLogger {
  child (area: string): AreaLogger
  recent (limit?: number, filter?: LogFilter): LogEntry[]
  onEntry (fn: (entry: LogEntry) => void): () => void
  dir (): string
  files (): Array<{ name: string; size: number; mtime: number }>
  tail (name: string, limit?: number): string[]
}

export function createLogger ({ dsh, retainDays = 14, debugEnabled }: CreateLoggerOptions = {}): Logger {
  const ring: LogEntry[] = []
  const listeners = new Set<(entry: LogEntry) => void>()
  const dir = (): string => ensureDir(dataDir('logs'))
  let lastCleanup = 0
  let writes = 0
  let rotated: { day: string; index: number; size: number } = { day: '', index: 1, size: 0 }
  const MAX_FILE_BYTES = 8 * 1024 * 1024

  /** 当天第几份文件：超过 8 MB 就换下一条，避免单文件无限长。 */
  function fileOf (day: string): string {
    if (rotated.day !== day) rotated = { day, index: 1, size: 0 }
    if (!rotated.size) {
      try { rotated.size = statSync(join(dir(), `aurabot-${day}.log`)).size } catch { rotated.size = 0 }
    }
    const name = rotated.index > 1 ? `aurabot-${day}-${rotated.index}.log` : `aurabot-${day}.log`
    return join(dir(), name)
  }

  function rotateIfNeeded (): void {
    writes += 1
    if (writes % 200 !== 0) return
    try {
      const p = fileOf(rotated.day || new Date().toISOString().slice(0, 10))
      if (statSync(p).size >= MAX_FILE_BYTES) rotated = { day: rotated.day, index: rotated.index + 1, size: 0 }
    } catch { /* 文件还没建或没权限：下次再说 */ }
  }

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
    // debug 只在调试模式里存在：关着时不占内存环、不写文件，面板也不会翻出噪声
    if (level === 'debug' && !debugEnabled?.()) return entry
    ring.push(entry)
    if (ring.length > RING) ring.shift()
    try {
      const line = `${day} ${time} [${level}] [${area}] ${text}\n`
      appendFileSync(fileOf(day), line, 'utf8')
      rotated.size += Buffer.byteLength(line)
      rotateIfNeeded()
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
      const debugOn = debugEnabled?.() ?? false
      return ring
        .filter((e) => (debugOn || e.level !== 'debug') && (!filter.level || LEVELS.indexOf(e.level) >= LEVELS.indexOf(filter.level)) && (!filter.area || e.area === filter.area))
        .slice(-limit)
    },
    onEntry (fn: (entry: LogEntry) => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    dir,
    files (): Array<{ name: string; size: number; mtime: number }> {
      try {
        return readdirSync(dir())
          .filter((name) => /^aurabot-.*\.log$/.test(name))
          .map((name) => {
            const s = statSync(join(dir(), name))
            return { name, size: s.size, mtime: s.mtimeMs }
          })
          .sort((a, b) => b.mtime - a.mtime)
      } catch { return [] }
    },
    tail (name: string, limit = 200): string[] {
      const safe = String(name || '')
      if (!/^aurabot-[0-9-]+(-\d+)?\.log$/.test(safe)) throw new Error('日志文件名不对')
      const file = join(dir(), safe)
      const size = statSync(file).size
      const max = Math.min(2 * 1024 * 1024, size)
      const count = Math.min(2000, Math.max(1, Number(limit) || 200))
      const buf = Buffer.allocUnsafe(max)
      const fd = openSync(file, 'r')
      try {
        readSync(fd, buf, 0, max, Math.max(0, size - max))
      } finally {
        closeSync(fd)
      }
      return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-count)
    },
  }
  return api
}

function fmt (v: unknown): string {
  if (v instanceof Error) return v.message
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}
