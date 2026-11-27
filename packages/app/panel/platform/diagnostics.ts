import { tcpOpen } from '../../support.ts'
import { defaultOneBotId } from '../../onebot.ts'

export function registerDiagnostics({ http, getConfig, endpoint, onebot, primaryBot, warmSince, warmPhase, mods, hub }) {
  const { route } = http

  /** 一键诊断：把「连不上 OneBot」卡在哪一步逐项列出来，用户发截图就能定位。 */
  route('/diagnose', async () => {
    const items = []
    const add = (id, label, ok, detail, hint = '') =>
      items.push({ id, label, ok: Boolean(ok), detail: String(detail || ''), hint })
    add(
      'bot-qq',
      '机器人 QQ',
      Boolean(endpoint().selfId),
      endpoint().selfId || '还没填',
      '在「连接」页填机器人号',
    )
    const ep = endpoint()
    const hasOneBot = Boolean(ep.wsUrl)
    add(
      'onebot-config',
      'OneBot 地址',
      hasOneBot,
      `WS ${ep.wsUrl || '—'} / HTTP ${ep.httpUrl || '—'}`,
      '在「连接」页填 OneBot v11 正向 WebSocket 地址（收消息靠它；HTTP 可选）',
    )
    for (const [kind, url, label] of [
      ['http', ep.httpUrl, 'OneBot HTTP'],
      ['ws', ep.wsUrl, 'OneBot WebSocket'],
    ]) {
      if (!url) continue
      let port = 0
      try {
        port = Number(new URL(url).port || 80)
      } catch (error) {}
      if (!port) continue
      const open = await tcpOpen(port)
      add(
        `${kind}-port`,
        `${label} 端口 ${port}`,
        open,
        open ? '端口正在监听' : '端口没有监听',
        '确认你的 OneBot 服务（NapCat / LLOneBot / Lagrange 等）已启动并监听该端口',
      )
    }
    const connected = onebot.state === 'connected'
    add(
      'gateway',
      '插件 ↔ OneBot 网关',
      connected,
      connected ? '已连接' : String(onebot.state || '未连接'),
      '连不上时看上面几项，或者点「重新连接」',
    )
    const problem = connected ? '' : await connectionProblem()
    return { ok: items.every((item) => item.ok), items, problem }
  })
  /** 连不上 OneBot 时，按顺序找卡在哪一步，给一句人话。 */
  async function connectionProblem() {
    if (!getConfig().enabled) return '总开关关着（右上角），打开后才会连'
    if (!endpoint().selfId) return '还没填机器人 QQ 号'
    const ep = endpoint()
    if (!ep.wsUrl)
      return '还没填 OneBot 的 WebSocket 地址：在「连接」页填你的 OneBot v11 正向 WebSocket 地址（收消息要靠它；HTTP 可以不填）'
    if (onebot.wrongAccount)
      return `连上的是 ${onebot.wrongAccount}，不是机器人号 ${endpoint().selfId}，已经断开：让你的 OneBot 服务登录机器人号，再点「重新连接」`
    if (warmSince() && Date.now() - warmSince() < 300_000) {
      const sec = Math.max(1, Math.round((Date.now() - warmSince()) / 1000))
      const label = warmPhase().label || '正在等 OneBot 会话'
      return `网关预热中（已等 ${sec} 秒）：${label}。OneBot 就绪后会自动连上；想看每一步点「一键诊断」`
    }
    return `连 ${ep.wsUrl || ep.httpUrl} 没连上：确认你的 OneBot 服务开着、地址和 token 填对了（Docker 里的话，地址要用 DSH 能访问到的主机名 / 端口）`
  }
  route('/onebot/reconnect', async () => {
    if (!getConfig().enabled) return { ok: false, message: await connectionProblem() }
    if (getConfig().modules?.[defaultOneBotId]?.enabled === false)
      return { ok: false, message: 'OneBot 适配器已停用' }
    if (onebot.verified || onebot.state === 'stopped' || onebot.state === 'unconfigured')
      await mods.reload(defaultOneBotId)
    // 等几秒看结果，别只回一句「正在重连」
    for (let i = 0; i < 16 && !(onebot.state === 'connected' && onebot.verified); i++)
      await new Promise((r) => setTimeout(r, 500))
    if (onebot.state === 'connected' && onebot.verified) return { ok: true, message: '连上了' }
    return { ok: false, message: '没连上：' + (await connectionProblem()) }
  })
  route('/onebot/test', async () => {
    try {
      const info = await primaryBot().internal('get_login_info', {}, { timeoutMs: 8000 })
      const uin = String(info?.user_id ?? '')
      return {
        ok: uin === endpoint().selfId,
        message:
          uin === endpoint().selfId
            ? `连上了：${info.nickname}（${uin}）`
            : `连上的是 ${uin}，不是机器人号 ${endpoint().selfId}！`,
        info,
      }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/test-send', async () => {
    if (!getConfig().enabled) return { ok: false, message: '先打开总开关' }
    const r = await hub.sendText(`private:${getConfig().ownerQQ}`, '【Aurabot 自测】大肥鱼到此一游～')
    return r ? { ok: true, message: '发给主人了，去 QQ 看看' } : { ok: false, message: '没发出去（看日志）' }
  })

  route('/sessions/reset', async () => {
    const n = hub.resetSessions()
    return { ok: true, message: n ? `归档了 ${n} 个会话，下一条消息起她会重新开始` : '本来就没有会话' }
  })
  return { connectionProblem }
}
