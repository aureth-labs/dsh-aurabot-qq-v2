export function registerBridgeRoutes({ http, getConfig, bridge }) {
  const { route, query, readBody } = http

  // 联动
  route('/bridge/token', async () => ({
    ok: true,
    token: getConfig().bridge.http ? bridge.ensureToken() : '',
  }))
  route('/bridge/token/reset', async () => ({
    ok: true,
    token: bridge.resetToken(),
    message: '换了新密钥，旧的立刻失效',
  }))
  route('/bridge/examples', async (req) => ({
    ok: true,
    ...bridge.examples(String(query(req).base || 'http://127.0.0.1:端口')),
  }))
  // 开放接口：都要带密钥。/open/* 给外部程序（curl/脚本）用，跨机 + 自定义 Host 是正常用法，
  // 且有自己的 Bearer 鉴权——跳过管理面的 Host 允许名单（复审 2·P1-2 的豁免原则同理）。
  const open = (path, fn) =>
    route(
      '/open' + path,
      async (req) => {
        if (!bridge.authorized(req))
          return {
            ok: false,
            code: 401,
            message: getConfig().bridge.http
              ? '密钥不对（请求头 Authorization: Bearer 密钥）'
              : '开放接口没打开（面板「扩展」→ 联动）',
          }
        return fn(req)
      },
      { skipHostCheck: true },
    )
  open('/info', async () => bridge.ops.info())
  open('/send', async (req) => bridge.ops.send(await readBody(req)))
  open('/think', async (req) => bridge.ops.think(await readBody(req)))
  open('/call', async (req) => bridge.ops.call(await readBody(req)))
  open('/events', async (req) => bridge.ops.events(query(req)))
}
