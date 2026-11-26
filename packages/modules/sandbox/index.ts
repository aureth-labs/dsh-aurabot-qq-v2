import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import type { AdapterHandle } from '../../../src/types/adapter/adapter.ts'
import { satoriAdapter } from '../../adapters/satori/src/index.ts'
import { createSandboxServer, type SandboxServerOptions } from './server.ts'

export { Config, Config as config } from './config.ts'
export const name = '聊天沙盒'
export const version = '1.0.0'
export const description = '通过本地 Satori 连接测试指令、插件与 AI 对话'
export const reloadOnConfig = true

export function apply(ctx: PluginContext, settings: SandboxServerOptions & { autoConnect: boolean }) {
  const platform = settings.platform || 'sandbox'
  const server = createSandboxServer({ ...settings, log: message => ctx.logger.info(message) })
  let adapter: AdapterHandle | undefined
  let disposed = false
  let error = ''
  async function start() {
    await server.start()
    if (disposed) return
    ctx.page({ path: '/sandbox', name, order: 40, url: server.url })
    if (!settings.autoConnect) return
    adapter = await ctx.adapter(satoriAdapter(), { endpoint: server.url, token: settings.token, platform })
    if (disposed) await adapter.dispose()
  }

  const ready = start().catch(cause => {
    if (disposed) return
    error = cause instanceof Error ? cause.message : String(cause)
    ctx.logger.warn('沙盒启动失败', error)
  })
  ctx.server.get('/sandbox/status', () => ({
    ok: !error, error, running: server.running, url: server.url, endpoint: server.url, platform,
    connected: adapter?.bot.status === 'online',
  }))
  return {
    server, ready,
    async dispose() {
      disposed = true
      try { await adapter?.dispose() } finally { await server.close() }
    },
  }
}
