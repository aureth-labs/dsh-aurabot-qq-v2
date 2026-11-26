import { spawn } from 'node:child_process'
import { join, basename } from 'node:path'


type RunOptions = Partial<Record<'cwd' | 'env' | 'log' | 'onLine' | 'timeoutMs', any>>

export function run(cmd, args, { cwd, env, log, onLine, timeoutMs = 30 * 60_000 } : RunOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let tail = ''
    const feed = (buf) => {
      const s = String(buf)
      tail = (tail + s).slice(-4000)
      for (const line of s.split(/\r?\n|\r/)) if (line.trim()) onLine?.(line.trim())
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const timer = setTimeout(() => { try { child.kill() } catch (error) {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(tail)
      else {
        log?.debug(`${basename(cmd)} 失败（code ${code}）：${tail.slice(-800)}`)
        reject(new Error(`${basename(cmd)} 退出码 ${code}：${tail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`))
      }
    })
  })
}