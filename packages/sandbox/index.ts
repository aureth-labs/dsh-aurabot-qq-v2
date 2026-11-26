// 内置模块：聊天沙盒。起一个本地 Satori 服务端 + 网页聊天室，
// 不接 QQ 也能把整套消息管线跑起来：浏览器发消息 → 适配器 → 机器人 → 网页里看到回复。

import { createSandboxServer } from './server.ts'
import { satoriAdapter } from '../adapters/satori/src/index.ts'
export { Config } from './config.ts'

export const name = '聊天沙盒'

export const version = '1.0.0'

export const description = '本地 Satori 服务端 + 网页聊天室：不用 QQ 也能和机器人对话，用来联调插件'

export function apply(ctx, config) {
  const settings = ctx.config as Record<string, any>
  const cfg = ctx.root.config
  const server = createSandboxServer({
    host: String(settings.host || '127.0.0.1'),
    port: Number(settings.port) || 5140,
    token: String(settings.token || ''),
    selfId: String(settings.selfId || 'sandbox-bot'),
    selfName: String(settings.selfName || '沙盒机器人'),
    platform: String(settings.platform || 'sandbox'),
    defaultUserId: String(settings.defaultUserId || cfg.ownerQQ || 'sandbox-user'),
    defaultUserName: String(settings.defaultUserName || cfg.ownerName || '沙盒用户'),
    log: (message) => ctx.logger.info(message),
  })
  ctx.page({
    path: '/sandbox',
    name: '聊天沙盒',
    icon: '🧪',
    order: 40,
    url: `http://${String(settings.host || '127.0.0.1')}:${Number(settings.port) || 5140}/`,
  })
  let handle = null
  let stopped = false
  const ready = server.start()
    .then(() => {
      if (stopped || settings.autoConnect === false) return
      return ctx.host.adapters
        .start(satoriAdapter(), { endpoint: server.url, token: String(settings.token || ''), platform: String(settings.platform || 'sandbox') })
        .then((started) => {
          if (stopped) {
            started.dispose?.().catch?.(() => {})
            return
          }
          handle = started
        })
        .catch((error) => ctx.logger.warn(`沙盒没接上自己的适配器：${error?.message || error}`))
    })
    .catch((error) => ctx.logger.warn(`聊天沙盒没起来：${error?.message || error}`))
  ctx.server.get('/sandbox/status', async () => ({
    ok: true,
    running: server.running,
    url: server.url,
    endpoint: `${server.url}`,
    platform: String(settings.platform || 'sandbox'),
    connected: Boolean(handle),
    hint: '在「机器人」里加一个 Satori 适配器，endpoint 填这个地址，就能在沙盒网页里聊天',
  }))
  return {
    server,
    ready,
    dispose: () => {
      stopped = true
      handle?.dispose?.().catch?.(() => {})
      server.close().catch(() => {})
    },
  }
}
