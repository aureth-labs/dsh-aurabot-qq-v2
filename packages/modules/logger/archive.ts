import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry } from '../../../src/core/support/log/logger.ts'

const logName = /^aurabot-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.log$/
const maxTail = 2 * 1024 * 1024

export function createArchive(directory: string, retainDays: () => number, maxBytes = 8 * 1024 * 1024) {
  mkdirSync(directory, { recursive: true })
  let current = { day: '', part: 1, bytes: 0 }
  let nextCleanup = 0
  const path = () => join(directory, 'aurabot-' + current.day + (current.part > 1 ? '-' + current.part : '') + '.log')

  function files() {
    return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && logName.test(entry.name))
      .map(({ name }) => {
        const stat = statSync(join(directory, name))
        return { name, size: stat.size, mtime: stat.mtimeMs }
      }).sort((a, b) => b.mtime - a.mtime)
  }

  function write(entry: LogEntry) {
    const date = new Date(entry.t)
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-')
    if (current.day !== day) {
      current = { day, part: 1, bytes: 0 }
      for (const file of files()) {
        const [, fileDay, suffix] = logName.exec(file.name)!
        const part = Number(suffix ?? 1)
        if (fileDay === day && part >= current.part) current = { day, part, bytes: file.size }
      }
    }
    const line = `${day} ${entry.time} [${entry.level}] [${entry.area}] ${entry.text}\n`
    const bytes = Buffer.byteLength(line)
    if (current.bytes && current.bytes + bytes > maxBytes) {
      current.part++
      current.bytes = 0
    }
    appendFileSync(path(), line, 'utf8')
    current.bytes += bytes
    if (entry.t < nextCleanup) return
    nextCleanup = entry.t + 6 * 3600_000
    const deadline = entry.t - retainDays() * 86400_000
    for (const file of files()) if (file.mtime < deadline) unlinkSync(join(directory, file.name))
  }

  function tail(name: string, limit = 200) {
    if (!logName.test(name)) throw new Error('日志文件名无效')
    const file = join(directory, name)
    const size = statSync(file).size
    const buffer = Buffer.alloc(Math.min(maxTail, size))
    const fd = openSync(file, 'r')
    let read: number
    try { read = readSync(fd, buffer, 0, buffer.length, size - buffer.length) }
    finally { closeSync(fd) }
    const lines = buffer.toString('utf8', 0, read).split(/\r?\n/)
    if (size > buffer.length) lines.shift()
    return lines.filter(Boolean).slice(-Math.max(1, Math.min(2000, Math.floor(limit) || 200)))
  }

  return { write, files, tail, dir: () => directory }
}
