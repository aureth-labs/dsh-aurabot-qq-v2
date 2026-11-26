import { mergeFromPanel } from '../../../../src/core/config/index.ts'
import { assertPublicUrl, fetchGuarded } from '../../../../src/core/net/index.ts'

export function registerPetControls({
  http,
  setConfig,
  getConfig,
  log,
  petStatus,
  use,
  redactTokens,
  publicBaseUrlOf,
  ctx,
  PREFIX,
}) {
  const { route, readBody, isLoopbackAddr, answer, panelBlocked, adminHostBlocked, csrfBlocked, send } = http

  route('/panel/pet/config', async (req) => {
    const b = await readBody(req)
    const patch: Record<string, any> = {}
    for (const k of [
      'whisperEnabled',
      'whisperPauseOnPetCarrier',
      'workStatusEnabled',
      'workBubble',
      'workNotify',
    ]) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    if (b.whisperSource === 'model' || b.whisperSource === 'pool') patch.whisperSource = b.whisperSource
    for (const k of ['whisperMinMinutes', 'whisperMaxMinutes', 'whisperMaxPerDay']) {
      // 面板口径：间隔 1~9999 分钟、每日上限 0~9999 次（0 = 不发）
      if (Number.isFinite(b[k]))
        patch[k] =
          k === 'whisperMaxPerDay'
            ? Math.min(9999, Math.max(0, Math.floor(b[k])))
            : Math.min(9999, Math.max(1, Math.floor(b[k])))
    }
    // 人物大小倍率：0.5~2.0，步进 0.05；坏值忽略（别把桌宠缩没了）
    if (Number.isFinite(b.petScale))
      patch.petScale = Math.min(2, Math.max(0.5, Math.round(b.petScale * 20) / 20))
    // 松手后落地：布尔透传（模块侧缺省当开，别让老面板把抛掷关没）
    if (typeof b.petReleaseLand === 'boolean') patch.petReleaseLand = b.petReleaseLand
    // ---------- 物理三参数 + 余额开关 + 抓鼠标两开关（pet 1.0.14 起在模块库） ----------
    // 【教训 · 三处必须同步】模块 settings 里新增一个键 → 必须同时补
    //   ① 本白名单（否则保存被「没有可保存的字段」挡回）
    //   ② client 面板里的控件（面板是硬编码 React，不会按 settings 渲染）
    //   ③ 模块自己的 defaults/settings 声明
    // 三处缺一即「假控件」：面板上看得见、点了存不进去，而且因为写不进 ext.pet，
    // 8 秒轮询还会把刚拖好的值弹回原处。桌宠是内置模块，它的 settings 同样不渲染成表单。
    // 取值口径与模块那边一致：坏值/非有限值一律忽略（不写进 patch，保持原值），
    // 越界按模块 settings 的 min/max 夹边界；步进与取整的整形在前端做（面板已 round）。
    if (Number.isFinite(b.petGravity)) patch.petGravity = Math.min(4000, Math.max(200, b.petGravity))
    if (Number.isFinite(b.petRestitution))
      patch.petRestitution = Math.min(0.95, Math.max(0.3, b.petRestitution))
    if (Number.isFinite(b.petAnimRate)) patch.petAnimRate = Math.min(2, Math.max(0.5, b.petAnimRate))
    // 三个开关：布尔直接透传（余额默认开 = 模块侧 `!== false`；抓鼠标默认关 = `=== true`）
    for (const k of ['petShowBalance', 'petClickChase', 'petTeaseChase']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    // 对话框（pet 1.0.5 起在模块库，模块自己的 settings 同样不渲染成表单；这里仍是唯一写入通道）
    for (const k of ['petChatEnabled', 'petChatBlurHide']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    // 快捷键 / 关闭关键字 / 天气城市：纯文本，按模块 settings 的口径截断（空串合法 = 关掉该项）
    for (const [k, max] of [
      ['petChatHotkey', 40],
      ['petChatCloseKeyword', 20],
      ['petWeatherCity', 40],
    ] as Array<[string, number]>) {
      const value = b[k]
      if (typeof value === 'string') patch[k] = value.trim().slice(0, max)
    }
    // 天气接口模板：只收 http/https（留空 = 用模块内置默认 wttr.in）
    if (typeof b.petWeatherUrl === 'string') {
      const u = b.petWeatherUrl.trim().slice(0, 500)
      if (!u || /^https?:\/\//i.test(u)) patch.petWeatherUrl = u
    }
    // 历史上限与保留天数：与模块 settings 的 min/max 对齐（10~2000 条；0 天 = 永久保留）
    if (Number.isFinite(b.petChatMaxEntries))
      patch.petChatMaxEntries = Math.min(2000, Math.max(10, Math.round(b.petChatMaxEntries)))
    if (Number.isFinite(b.petChatRetentionDays))
      patch.petChatRetentionDays = Math.min(3650, Math.max(0, Math.round(b.petChatRetentionDays)))
    // ---------- 语音对讲（pet 1.2.0 起在模块库）：独立设置键的唯一写入通道 ----------
    // 同「三处必须同步」：模块 defaults/settings 已声明这些键，这里补白名单，
    // client 桌宠页另起一张独立的「语音对讲」卡（不塞进对话框卡）。
    // toggle 模式：按一下开始听、再按一下发送，不再需要 PTT 键与静音断句秒数，
    // 因此 callPttKey / callVadSilence 不再写入（旧配置里残留的值也不再被面板改动）。
    // 口径与现有键一致：类型/枚举/协议不对的坏值忽略（不写 patch，保持原值）；
    // 数值用有限数并 clamp 到模块 settings 的 min/max；文本 trim 后按上限截断（空串合法 = 关掉/回落默认）。
    if (b.callEngine === 'native' || b.callEngine === 'sovits' || b.callEngine === 'voice')
      patch.callEngine = b.callEngine
    // 说话方式固定 toggle；旧值 free/ptt 也收，仅为兼容旧配置读写，面板不再暴露该控件
    if (b.callTalkMode === 'free' || b.callTalkMode === 'ptt' || b.callTalkMode === 'toggle')
      patch.callTalkMode = b.callTalkMode
    if (typeof b.callRvc === 'boolean') patch.callRvc = b.callRvc
    for (const [k, max] of [
      ['callRvcVoice', 60],
      ['voiceHotkey', 40],
      ['callMicDeviceId', 200],
      ['callSpeakerDeviceId', 200],
    ] as Array<[string, number]>) {
      if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, max)
    }
    // 两个服务地址：只收 http/https，留空 = 回落模块内置默认（sovitsUrl 默认 9880 / callAsrUrl 默认 8000）
    for (const k of ['sovitsUrl', 'callAsrUrl']) {
      if (typeof b[k] === 'string') {
        const u = b[k].trim().slice(0, 300)
        if (!u || /^https?:\/\//i.test(u)) patch[k] = u
      }
    }
    // 一次最多字数 20~300（与模块 settings 的 min/max 对齐）；toggle 模式不再有「说完判定秒数」
    if (Number.isFinite(b.callMaxChars))
      patch.callMaxChars = Math.min(300, Math.max(20, Math.round(b.callMaxChars)))
    if (typeof b.whisperLines === 'string') patch.whisperLines = b.whisperLines.slice(0, 4000)
    // 素材包下载地址：内建模块的 settings 字段不渲染成表单（同上），这里是它唯一的写入通道。
    // 只收 http/https（或空 = 回到内置默认），别把 file:// 之类塞进来当下载源
    if (typeof b.petPackUrl === 'string') {
      const u = b.petPackUrl.trim().slice(0, 1000)
      if (!u || /^https?:\/\//i.test(u)) patch.petPackUrl = u
    }
    // Electron 下载镜像：同上（内建模块不渲染 settings）；留空 = 回落内置默认 npmmirror
    if (typeof b.electronMirror === 'string') {
      const u = b.electronMirror.trim().slice(0, 500)
      if (!u || /^https?:\/\//i.test(u)) patch.electronMirror = u
    }
    // 对外公网地址（远端直连）：只收 http/https 或空（空 = 关掉远端模式，回到同机）
    if (typeof b.publicBaseUrl === 'string') {
      const u = b.publicBaseUrl.trim().replace(/\/+$/, '').slice(0, 300)
      if (!u || /^https?:\/\//i.test(u)) patch.publicBaseUrl = u
    }
    // 安全项（2026-11-02）：明文 http 跨机开关 + 令牌有效期。同样因为内置模块的 settings 不渲染表单，
    // 这里是唯一写入通道。
    if (typeof b.allowInsecureRemote === 'boolean') patch.allowInsecureRemote = b.allowInsecureRemote
    if (Number.isFinite(b.tokenTtlDays))
      patch.tokenTtlDays = Math.min(3650, Math.max(0, Math.floor(b.tokenTtlDays)))
    // 行为大脑的模块级设置（AI 自己改不了，只有主人能改）。pet 是**内置模块**，
    // 它的 settings schema 不会渲染成表单（面板只给「用户自己复制出来的模块」生成），
    // 所以这里是这些开关唯一的写入通道——不补，关窗物理闸就永远打不开。
    for (const k of ['behaviorEnabled', 'behaviorIconMischiefEnabled', 'behaviorCloseWindowEnabled']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    for (const [k, lo, hi] of [
      ['behaviorMinMinutes', 1, 9999], // 铁律：最短 1 分钟
      ['behaviorMaxMinutes', 1, 9999],
      ['behaviorMaxPerDay', 0, 999999],
      ['behaviorIdleCursorMinutes', 1, 240],
      ['behaviorMoodCloseWindowBelow', 0, 100],
      ['behaviorIconQuarantineDays', 1, 365],
      ['chatBehaviorCooldownMinutes', 1, 1440], // 聊天联动冷却：1 分钟起，最长一天
      ['chatBehaviorMaxPerDay', 0, 9999], // 聊天联动每日上限：0 = 聊天时她也不动
    ]) {
      const value = Number(b[k])
      if (Number.isFinite(value)) patch[k] = Math.min(Number(hi), Math.max(Number(lo), Math.round(value)))
    }
    if (typeof b.behaviorWindowWhitelist === 'string')
      patch.behaviorWindowWhitelist = b.behaviorWindowWhitelist.slice(0, 2000)
    if (typeof b.behaviorDisabledActions === 'string')
      patch.behaviorDisabledActions = b.behaviorDisabledActions.slice(0, 500)
    // 聊天联动动作（1.2.0 起 pet 模块代码在 mods 仓；核心侧 /panel/pet/config 仍是这些键的面板写入通道）
    if (typeof b.chatBehaviorEnabled === 'boolean') patch.chatBehaviorEnabled = b.chatBehaviorEnabled
    if (typeof b.chatBehaviorWhitelist === 'string')
      patch.chatBehaviorWhitelist = b.chatBehaviorWhitelist.slice(0, 2000)
    if (!Object.keys(patch).length) return { ok: false, message: '没有可保存的字段' }
    setConfig(mergeFromPanel(getConfig(), { ext: { pet: patch } }))
    log.info(
      `面板已保存桌宠设置｜${Object.keys(patch)
        .map((k) => k + '=' + String(patch[k]).slice(0, 20))
        .join(' ')}`,
    )
    return { ok: true, pet: petStatus() }
  })
  // 「现在碎碎念一句」：绕过排程与开关，但仍尊重专注模式（force 只跳排程类闸门）
  route('/panel/pet/whisper', async (req) => {
    const pet = use('pet')
    if (typeof pet?.whisperNow !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，碎碎念不了' }
    const r = await pet.whisperNow({ force: true, reason: '面板' })
    const msg =
      r && r.ok
        ? `她嘟囔了一句：${r.text}`
        : {
            focus: '专注模式开着，先关掉再来',
            'pet-offline': '桌宠没在跑，气泡发不出去',
            'plugin-off': '插件总开关是关的',
            thinking: '上一句她还在想（工作区那条会话还没结束），等几秒再来',
          }[r && r.reason] || '这轮没说出来'
    return { ok: Boolean(r && r.ok), message: msg, result: redactTokens(r) }
  })
  route('/panel/pet/download', async () => {
    const pet = use('pet')
    if (typeof pet?.download !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，装不了客户端' }
    return { ok: true, result: redactTokens(await pet.download()) }
  })
  // 素材包：手动重下默认形象包（换镜像地址后用；force=true 表示已有也重下）
  route('/panel/pet/fetch-pack', async () => {
    const pet = use('pet')
    if (typeof pet?.ensureDefaultPack !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，下不了素材包' }
    return { ok: true, result: await pet.ensureDefaultPack(true), pet: petStatus() }
  })
  route('/panel/pet/focus', async (req) => {
    const enabled = Boolean((await readBody(req)).enabled)
    const pet = use('pet')
    if (typeof pet?.setFocus !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，改不了专注模式' }
    return { ok: true, result: redactTokens(await pet.setFocus(enabled)) }
  })
  // Electron 三键：安装（npmmirror 镜像）→ 启动（清 ELECTRON_RUN_AS_NODE 分离进程）→ 停止（杀 pid）
  // 远端直连模式（配了 publicBaseUrl）下安装/启动不再执行——服务器无桌面，spawn 无头 Electron 的坑从入口上消失，
  // 面板据 remoteClient:true 把这两键换成「下载客户端包」（/panel/pet/client-package）。
  // 【首审 P2】还要看模块具备不具备 clientPackage 能力：装上的是旧版 pet（1.0.8 及以前）时，
  // 面板如果照旧提示「点下载客户端包」，用户点下去只会拿到 404/降级文案。这种情况下要说清楚是版本问题。
  const remotePetHint = () => {
    const pet = use('pet')
    const canPackage = typeof pet?.clientPackage === 'function'
    if (!canPackage) {
      return {
        ok: false,
        available: false,
        remoteClient: true,
        needModuleUpgrade: true,
        message:
          '已配置对外地址（远端直连模式），但当前桌宠模块太旧、不具备「打包客户端」能力（需要 pet 1.0.10+）：请先在模块市场把桌宠更新到最新版',
      }
    }
    return {
      ok: false,
      available: false,
      remoteClient: true,
      message:
        '已配置对外地址（远端直连模式）：服务器上不再安装/启动 Electron。请在「桌宠」页点「下载客户端包」，在你自己的电脑上解压运行',
    }
  }
  route('/panel/pet/electron-install', async () => {
    if (publicBaseUrlOf()) return remotePetHint()
    const pet = use('pet')
    if (typeof pet?.electronInstall !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，装不了 Electron' }
    return { ok: true, result: redactTokens(await pet.electronInstall()) }
  })
  route('/panel/pet/launch', async () => {
    if (publicBaseUrlOf()) return remotePetHint()
    const pet = use('pet')
    if (typeof pet?.launch !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，启动不了桌宠' }
    return { ok: true, result: redactTokens(await Promise.resolve(pet.launch())) }
  })
  route('/panel/pet/stop', async () => {
    const pet = use('pet')
    if (typeof pet?.stop !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，停不了桌宠' }
    return { ok: true, result: redactTokens(await Promise.resolve(pet.stop())) }
  })
  // 轮换令牌（安全）：旧的立即失效，客户端必须重新下载包。跨机部署时这是唯一的应急手段
  // （令牌一旦泄露，只有换掉它才收得回口子）。
  route('/panel/pet/rotate-token', async () => {
    const pet = use('pet')
    if (typeof pet?.rotateToken !== 'function')
      return {
        ok: false,
        available: false,
        message: '桌宠模块还没就绪 / 版本太旧（需要 1.0.10+），换不了令牌',
      }
    const r = pet.rotateToken()
    log.info(`面板轮换桌宠令牌｜${r.ok ? '成功' : '失败：' + r.message}`)
    return { ok: Boolean(r && r.ok), message: r?.message || '', issuedAt: r?.issuedAt || null }
  })
  // 对外公网地址：保存 + 验证。验证 = 服务端向 <publicBaseUrl>/aurabot/api/state 发一次请求，
  // 回 200 且响应带本插件标识才算通；hairpin NAT 打不通自己的公网地址时可显式确认跳过验证。
  // 【首审 P1-5 + 复审 P1-4】SSRF 收口，全部复用 core/net.js 的判定（不再手写正则）：
  //   ① `assertPublicUrl`：域名要 **DNS 解析后**逐个 IP 校验——`https://[::ffff:127.0.0.1]`、
  //      解析到内网的公网域名都拦得住（旧手写正则只看字符串，这两条都漏）；
  //   ② 跨机必须 https（明文只放行本机回环，自测用）；
  //   ③ 验证请求走 `fetchGuarded`：手动跟重定向，**每一跳都重新做 SSRF 校验**——302 到内网照样拦；
  //   ④ 响应必须带本插件标识（ok + version/apiVersion），不能只看 200；
  //   ⑤ `force` 不再跳过安全校验：它只表示「跳过连通性验证」，要内网/本机地址必须再加
  //      `confirm: true` 显式二次确认，并写审计日志。这满足「内网自测」的合法场景
  //      （局域网部署 + allowInsecureRemote），但不再是无声的 SSRF 旁路。
  route('/panel/pet/public-base', async (req) => {
    const b = await readBody(req)
    const raw = String(b.publicBaseUrl ?? '')
      .trim()
      .replace(/\/+$/, '')
      .slice(0, 300)
    if (!raw) {
      setConfig(mergeFromPanel(getConfig(), { ext: { pet: { publicBaseUrl: '' } } }))
      log.info('面板已清空桌宠对外地址：回到同机模式')
      return { ok: true, publicBaseUrl: '', message: '已清空：回到同机模式（host.json 恢复回环地址）' }
    }
    if (!/^https?:\/\//i.test(raw))
      return { ok: false, message: '要填 http(s):// 开头的完整地址，如 https://bot.example.com' }
    // ① 安全校验（DNS 解析后逐 IP 判私网/本机）——force 也不跳过这一步的**判定**，
    //    只是把「判定为内网」从拒绝变成「confirm 后审计放行」（局域网自测的合法场景）。
    let privateHit = ''
    try {
      await assertPublicUrl(raw)
    } catch (error) {
      if (b.force !== true || b.confirm !== true) {
        return {
          ok: false,
          publicBaseUrl: raw,
          verified: false,
          message: `这个地址不允许作为对外地址（${error.message}）。它指向本机/内网，只适合局域网自测：确实要保存，请带 force + confirm 显式确认（面板会弹二次确认）`,
        }
      }
      privateHit = error.message
    }
    // ② 明文检查：**公网**地址必须 https（令牌与聊天内容走明文等于送人，这条没有确认通道）；
    //    内网明文已在上面走 force+confirm 审计通道放行。
    if (!privateHit) {
      const u = new URL(raw)
      if (u.protocol === 'http:' && !isLoopbackAddr(u.hostname)) {
        return {
          ok: false,
          publicBaseUrl: raw,
          message:
            '跨机对外地址必须用 https：令牌与聊天内容走明文等于送人。局域网自测请直接填内网地址并走 force + confirm',
        }
      }
    }
    let detail = ''
    let ok = false
    if (!privateHit) {
      // ③ 验证请求：手动跟重定向，每一跳都重新做 SSRF 校验；④ 响应要带本插件标识
      try {
        const r = await fetchGuarded(raw + '/aurabot/api/state', { timeoutMs: 8000 })
        if (!r.ok) {
          detail = `HTTP ${r.status}`
        } else {
          let body = null
          try {
            body = await r.json()
          } catch {
            body = null
          }
          if (body && body.ok === true && (body.version || body.apiVersion)) {
            ok = true
            detail = 'HTTP 200 + 插件标识匹配'
          } else {
            detail = 'HTTP 200 但响应不像本插件（缺少 version/apiVersion 标识）'
          }
        }
      } catch (error) {
        detail = error?.name === 'AbortError' ? '请求超时' : String(error?.message || error)
      }
      if (!ok && b.force !== true) {
        return {
          ok: false,
          publicBaseUrl: raw,
          verified: false,
          message: `验证没过（${detail}）：确认反代已把 ${raw} 指到本插件。地址确实打不通自己的公网（如 hairpin NAT）可再点一次「跳过验证保存」`,
        }
      }
    }
    setConfig(mergeFromPanel(getConfig(), { ext: { pet: { publicBaseUrl: raw } } }))
    if (privateHit) {
      // 审计：内网/本机地址被显式确认保存了，必须留痕（谁在什么时候放行了什么地址）
      log.warn(`【审计】桌宠对外地址保存了内网/本机地址｜${raw}｜原因：${privateHit}｜force+confirm 显式确认`)
      return {
        ok: true,
        publicBaseUrl: raw,
        verified: false,
        confirmedPrivate: true,
        message: `已保存（内网地址，未经连通性验证：${privateHit}）。仅限自测，公网部署请换 https 公网域名`,
      }
    }
    log.info(`面板已保存桌宠对外地址｜${raw}｜验证${ok ? '通过' : '跳过'}（${detail}）`)
    return {
      ok: true,
      publicBaseUrl: raw,
      verified: ok,
      message: ok
        ? `验证通过（${detail}）：远端直连已开启，host.json 会写这个地址`
        : `已保存（验证被跳过：${detail}）`,
    }
  })
  // 客户端包（zip）：app/ 目录 + 内嵌 host.json。面板远端模式的「下载客户端包」用；浏览器直接下载二进制，
  // 所以不能走 JSON 包装的 route()，这里单独注册精确路径并手动设 content-type/content-disposition。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PREFIX + '/panel/pet/client-package',
        handler: (req, res) =>
          answer(req, res, async () => {
            // 【安全】这一条不走 route()，必须自己过面板闸：包内嵌 host.json（含 bearer 令牌），
            // 公网上谁都能无鉴权下到就等于把桌宠令牌送出去。CSRF 闸也要过（一致性；GET 本身不受影响）。
            // 复审 3·P1-1：还必须过 Host 校验——此前手动注册路由漏了 adminHostBlocked，
            // 实测 socket 回环 + `Host: evil.example` 的 GET 能拿到含令牌的 zip（DNS rebinding 载体）。
            if (panelBlocked(req, res)) return undefined
            if (adminHostBlocked(req, res)) return undefined
            if (csrfBlocked(req, res)) return undefined
            const pet = use('pet')
            if (typeof pet?.clientPackage !== 'function')
              return { ok: false, available: false, message: '桌宠模块还没就绪，打不了客户端包' }
            const r = await Promise.resolve(pet.clientPackage())
            if (!r.ok) return { ok: false, message: r.message }
            // 【安全 P2】内含 bearer 令牌：任何缓存层都不许留；文件名要清洗（模块来自磁盘，不完全可信）
            const safeName = String(r.filename || 'aurabot-pet-client.zip').replace(/[^\w.-]/g, '_')
            res.setHeader?.('content-type', 'application/zip')
            res.setHeader?.('content-disposition', `attachment; filename="${safeName}"`)
            res.setHeader?.('cache-control', 'no-store, no-cache, must-revalidate, private')
            res.setHeader?.('pragma', 'no-cache')
            send(res, 200, r.buffer, 'application/zip') // answer 只在返回非 undefined 时才发 JSON，这里已手动发过
            return undefined
          }),
      }),
    'aurabot: 桌宠客户端包下载',
  )
}
