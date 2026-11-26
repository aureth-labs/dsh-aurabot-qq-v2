import { redact } from './redact.ts'

const levels = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = typeof levels[number]
export interface LogEntry { t: number; time: string; level: LogLevel; area: string; text: string }
export interface LogFilter { level?: LogLevel; area?: string }
export type AreaLogger = Record<LogLevel, (...args: unknown[]) => LogEntry>
type Listener = (entry: LogEntry) => void

export interface Logger extends AreaLogger {
  child(area: string): AreaLogger
  recent(limit?: number, filter?: LogFilter): LogEntry[]
  onEntry(listener: Listener, options?: { replayStartup?: boolean }): () => void
}

export interface CreateLoggerOptions {
  dsh?: { logger?: Partial<Record<LogLevel, (message: string) => void>> }
  debugEnabled?: () => boolean
}

export function createLogger({ dsh, debugEnabled }: CreateLoggerOptions = {}): Logger {
  const ring: LogEntry[] = []
  const listeners = new Set<Listener>()
  let startup = true

  function write(level: LogLevel, area: string, args: unknown[]) {
    const now = new Date()
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
    const text = redact(args.map(format).join(' '))
    const entry = { t: now.getTime(), time, level, area, text }
    if (level === 'debug' && !debugEnabled?.()) return entry
    ring.push(entry)
    if (ring.length > 500) ring.shift()
    try {
      dsh?.logger?.[level]?.(`aurabot[${area}]: ${text}`)
    } catch {}
    for (const listener of listeners) {
      try { listener(entry) } catch {}
    }
    return entry
  }

  function child(area: string): AreaLogger {
    return {
      debug: (...args) => write('debug', area, args), info: (...args) => write('info', area, args),
      warn: (...args) => write('warn', area, args), error: (...args) => write('error', area, args),
    }
  }

  return {
    ...child('core'), child,
    recent(limit = 200, filter = {}) {
      const count = Math.max(0, Math.min(500, Math.trunc(limit) || 0))
      if (!count) return []
      return ring.filter(entry => (!filter.area || filter.area === entry.area)
        && (entry.level !== 'debug' || debugEnabled?.())
        && (!filter.level || levels.indexOf(entry.level) >= levels.indexOf(filter.level))).slice(-count)
    },
    onEntry(listener, options) {
      if (startup && options?.replayStartup) {
        startup = false
        for (const entry of ring) listener(entry)
      }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

function format(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}
