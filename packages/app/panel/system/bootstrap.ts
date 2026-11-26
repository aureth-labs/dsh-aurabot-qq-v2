import { configRevision, publicConfig } from '../../../../src/core/config/index.ts'
import { browserStatus } from '../../../../src/core/runtime/browser.ts'

export function registerBootstrap({
  getConfig,
  onebot,
  warmSince,
  mods,
  coreIsReady,
  http,
  bootId,
  VERSION,
  areModulesReady,
  adapterRegistry,
}) {
  const { send, route } = http

  // ---------- 面板首屏：三条轻量只读接口（GET /panel/bootstrap|pulse|config，方案 §二/§2.1） ----------
  // 铁规矩：只读宿主内存——绝不触发 OneBot 网络探测、不启动网关、不重扫模块目录。
  // 鉴权/Host/CSRF 与其它管理面一致（route() 内统一过闸）；no-store 由 send() 统一带上。
  // 常用开关的界面显示值（调试模式口径与 publicConfig 相同：调试开着时调试模式显示为关）。
  const controlsView = () => ({
    enabled: Boolean(getConfig().enabled),
    debug: Boolean(getConfig().debug),
    safeMode: Boolean(getConfig().safeMode),
  })
  // 连接快照：QQ 直连只用事件状态（onebot.state）+ 已核验登录快照（checkLogin 顺带缓存），
  // 原因码只给可公开的机器值（reason），不给内部细节。
  const connectionsView = () => {
    const connected = onebot.state === 'connected'
    const verified = connected && onebot.verified
    let stage = 'connecting'
    let reason = 'gateway_connecting'
    if (!getConfig().enabled) {
      stage = 'disabled'
      reason = 'disabled_in_config'
    } else if (connected && verified) {
      stage = 'connected'
      reason = 'ok'
    } else if (connected) {
      stage = 'verifying'
      reason = onebot.wrongAccount ? 'wrong_account' : 'verifying_login'
    } else if (onebot.state === 'unconfigured') {
      stage = 'unconfigured'
      reason = 'gateway_unconfigured'
    } else if (onebot.state === 'stopped') {
      stage = 'disconnected'
      reason = 'gateway_disconnected'
    } else if (warmSince()) {
      reason = 'gateway_warming'
    }
    return [
      {
        platform: 'qq',
        instanceId: 'onebot',
        enabled: Boolean(getConfig().enabled),
        stage, // connected | verifying | connecting | disconnected | unconfigured | disabled
        verified,
        reason, // ok | wrong_account | verifying_login | gateway_warming | gateway_connecting | gateway_disconnected | gateway_unconfigured | disabled_in_config
        login: verified ? { uin: onebot.login.uin, nickname: onebot.login.nickname } : null,
        warmupSeconds: warmSince() ? Math.max(0, Math.round((Date.now() - warmSince()) / 1000)) : 0,
      },
    ]
  }
  // 导航摘要：mods 尚未装配时给空表（bootstrap 用 modulesReady=false 提示面板先占位）。
  const navSummary = () => (mods ? mods.summarizeModules() : { navigationRevision: 0, modules: [] })
  const navRevision = () => (mods ? mods.navigationRevision() : 0)
  // 核心配置/路由未就绪：三条轻量 GET 统一回 503 BOOTSTRAPPING（方案 §2.1「启动与失败」）。
  const bootstrapping = (res) => {
    if (coreIsReady()) return false
    send(res, 503, { ok: false, code: 'BOOTSTRAPPING', bootId })
    return true
  }
  route('/panel/bootstrap', async (req, res) => {
    if (bootstrapping(res)) return
    const nav = navSummary()
    return {
      ok: true,
      bootId,
      configRevision: configRevision(),
      version: VERSION,
      controls: controlsView(),
      connections: connectionsView(),
      modulesReady: areModulesReady(),
      navigationRevision: nav.navigationRevision,
      modules: nav.modules,
      pages: mods ? mods.pages() : [],
    }
  })
  route('/panel/pulse', async (req, res) => {
    if (bootstrapping(res)) return
    return {
      ok: true,
      bootId,
      configRevision: configRevision(),
      navigationRevision: navRevision(),
      controls: controlsView(),
      connections: connectionsView(),
    }
  })
  // 机器人列表：内置 QQ + 插件通过 ctx.adapter() 挂上来的平台，面板「机器人」页用它
  route('/panel/bots', async () => {
    return { ok: true, bots: adapterRegistry.list() }
  })
  // 本机找到的浏览器：扫码登录 B 站 / 网易云时用，面板「浏览器」页展示
  route('/panel/browser', async () => {
    return { ok: true, ...browserStatus() }
  })
  route('/panel/config', async (req, res) => {
    if (bootstrapping(res)) return
    // 面板草稿唯一的初始化/刷新来源：现有 publicConfig 的脱敏结果（密码/token 不回传原文）。
    return {
      ok: true,
      bootId,
      configRevision: configRevision(),
      config: publicConfig(getConfig(), mods?.fields),
    }
  })
}
