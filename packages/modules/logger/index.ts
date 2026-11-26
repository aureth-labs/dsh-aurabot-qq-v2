import { dataDir } from '../../../src/core/store/index.ts'
import type { Logger } from '../../../src/core/support/log/logger.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { createArchive } from './archive.ts'

export { Config, Config as config } from './config.ts'
export const name = '日志'
export const version = '3.0.0'
export const description = '按级别查看运行日志，日志文件按日期和大小轮转'
export const inject = ['log-stream']

export function apply(ctx: PluginContext) {
  const stream = ctx.require<Logger>('log-stream')
  const archive = createArchive(dataDir('logs'), () => Number(ctx.config.retainDays) || 14)
  const service = { ...stream.child(ctx.id), child: stream.child, recent: stream.recent,
    files: archive.files, tail: archive.tail, dir: archive.dir }
  ctx.provide('logger', service)
  ctx.effect(stream.onEntry(archive.write, { replayStartup: true }))
  ctx.server.get('/logs/files', () => ({ ok: true, dir: archive.dir(), files: archive.files() }))
  ctx.server.get('/logs/tail', req => {
    const query = new URL(req.url || '/', 'http://localhost').searchParams
    const name = query.get('name') || ''
    try {
      return { ok: true, name, lines: archive.tail(name, Number(query.get('limit')) || Number(ctx.config.pageSize)) }
    } catch (error) {
      return { ok: false, message: String(error?.message || error) }
    }
  })
  return service
}
