// 内置模块：聊天沙盒。起一个本地 Satori 服务端 + 网页聊天室，
// 不接 QQ 也能把整套消息管线跑起来：浏览器发消息 → 适配器 → 机器人 → 网页里看到回复。

import { createSandboxServer } from './server.ts'
import { satoriAdapter } from '../../adapters/satori/src/index.ts'

export default {
  id: 'sandbox',
  name: '聊天沙盒',
  version: '1.0.0',
  description: '本地 Satori 服务端 + 网页聊天室：不用 QQ 也能和机器人对话，用来联调插件',
  files: ['packages/modules/sandbox/index.js', 'packages/modules/sandbox/server.js', 'packages/modules/sandbox/ui.js'],
  defaults: {
    host: '127.0.0.1',
    port: 5140,
    token: '',
    selfId: 'sandbox-bot',
    selfName: '沙盒机器人',
    platform: 'sandbox',
    defaultUserId: '',
    defaultUserName: '',
    autoConnect: true,
  },
  settings: [
    { key: 'host', type: 'string', label: '监听地址（默认只监听本机）' },
    { key: 'port', type: 'number', label: '端口' },
    { key: 'token', type: 'password', label: '访问令牌（留空则不校验）' },
    { key: 'selfName', type: 'string', label: '机器人昵称' },
    { key: 'platform', type: 'string', label: '平台名（进 Target.platform）' },
    { key: 'defaultUserName', type: 'string', label: '网页里默认的昵称（留空用主人名）' },
    { key: 'autoConnect', type: 'boolean', label: '自动用 Satori 适配器连上自己' },
  ],
  setup(api) {
    const settings = api.settings() as Record<string, any>
    const cfg = api.config()
    const server = createSandboxServer({
      host: String(settings.host || '127.0.0.1'),
      port: Number(settings.port) || 5140,
      token: String(settings.token || ''),
      selfId: String(settings.selfId || 'sandbox-bot'),
      selfName: String(settings.selfName || '沙盒机器人'),
      platform: String(settings.platform || 'sandbox'),
      defaultUserId: String(settings.defaultUserId || cfg.ownerQQ || 'sandbox-user'),
      defaultUserName: String(settings.defaultUserName || cfg.ownerName || '沙盒用户'),
      log: (message) => api.log.info(message),
    })
    let handle = null
    let stopped = false
    const ready = server.start()
      .then(() => {
        if (stopped || settings.autoConnect === false) return
        return api.core.adapters
          .start(satoriAdapter(), { endpoint: server.url, token: String(settings.token || ''), platform: String(settings.platform || 'sandbox') })
          .then((started) => {
            if (stopped) {
              started.dispose?.().catch?.(() => {})
              return
            }
            handle = started
          })
          .catch((error) => api.log.warn(`沙盒没接上自己的适配器：${error?.message || error}`))
      })
      .catch((error) => api.log.warn(`聊天沙盒没起来：${error?.message || error}`))
    api.route('/sandbox/status', async () => ({
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
  },
}
