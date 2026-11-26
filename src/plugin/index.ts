import { validMemberFilter } from '../chat/inbound/filter/member-filter.ts'
import { registerOutboundPanelRoutes } from './outbound-panel.ts'
// Aurabot · 宿主半边（DSH 插件入口）
//
// 让 DSH 里的 AI 以独立 QQ 号「大肥鱼」住在 QQ 里：
//   OneBot v11 适配器 ⇄ 本插件 ⇄ DSH 会话（Aurabot 自带的 preset + 人格）
// 面板在侧栏「自动化任务」下面（网页半边见 client/**/*.ts，打包成 dist/client.js），这里提供它要的 /aurabot/api/* 接口。
//
// 这个文件只管「核心」：配置、QQ 网关、聊天中枢、人格、面板接口、模块内核和联动。
// 表情、语音、记忆、空间、B 站、翻唱、生图……都是模块（packages/），能单独关掉，也能用自己写的替换。
//
// ⚠ 安全默认：总开关关、调试模式开。不手动打开，一句都不会真的发到 QQ。

import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT as packageRoot } from '../core/support/util/root.ts'
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { loadConfig, saveConfig, commitConfig, configRevision, publicConfig, mergeFromPanel, ownerAuthorizationRevision } from '../core/config/index.ts'
import { quietWindowOf } from '../core/support/time/time-window.ts'
import { createLogger } from '../core/support/log/logger.ts'
import { encodeResponse } from '../core/net/http-compress.ts'
import { registerSecret, redact } from '../core/support/log/redact.ts'
import { createOneBotClient } from '../../packages/adapters/qq/onebot-v11/src/client.ts'
import { createOutbox } from '../../packages/adapters/qq/onebot-v11/src/outbox.ts'
import { createHub, workspaceDirOf } from '../chat/hub/index.ts'
import { createPersonaMemoryRuntime } from '../core/support/bridge/persona-memory-bridge.ts'
import { normalizeSelection } from '../chat/hub/store/chat-model.ts'
import { grantOwner, moveWorkspace, realWorkspace } from '../core/runtime/workspace-move.ts'
import { createLocal, fileOf, toImageBuffer } from '../local/index.ts'

import { defaultModel, askModel, modelReasoning, modelVision, clearReasoningCache, clearVisionCache } from '../core/llm/index.ts'
import { createLlmFacade } from '../core/llm/facade.ts'
import { browserStatus } from '../core/runtime/browser.ts'
import { mimeOf } from '../chat/inbound/index.ts'
import { createMediaAccess } from '../core/message/media/media.ts'
import { buildFaceIndex } from '../chat/media/face/index.ts'
import { FACE_TABLE } from '../chat/media/face/table.ts'
import { dataDir, ensureDir } from '../core/store/index.ts'
import { closeMessageLogsUnder } from '../core/store/messages.ts'
import { createUsageFx } from '../core/llm/usage/fx.ts'
import { initUsage, usageReport, closeUsage } from '../core/llm/usage/usage.ts'
import { BotRegistry, createBotsAccessor } from '../core/bot/instance/registry.ts'
import { botApiStubs } from '../core/bot/index.ts'
import { AdapterRegistry } from '../core/bot/adapter/registry.ts'
import { wrapAdapterBot } from '../core/bot/instance/bot.ts'
import type { BotLike } from '../types/adapter/bot.ts'
import type { InboundMessage } from '../types/adapter/adapter.ts'
import { OneBotBot, inboundOf, eventForHub } from '../../packages/adapters/qq/onebot-v11/src/index.ts'
import { Pipeline } from '../core/pipeline/index.ts'
import { Session, inboundSession } from '../core/pipeline/session.ts'
import { createUpdateChecker, changelogSection, hostEnv, updatePlan, repoOf } from '../core/runtime/update.ts'
import { parseCommand, runCommand, createMutes, commandList } from '../chat/commands/index.ts'
import { isOwner, groupResponseMode } from '../chat/policy/rules/access.ts'
import { createGroupRoles } from '../chat/policy/rules/group.ts'
import { changePermissions, changePrivateWhitelist, privatePermissionCatalog } from '../chat/policy/rules/permission.ts'
import { canUseDelegatedCommand, delegatedCommandKey, runPersonalModelCommand } from '../chat/commands/delegated-commands.ts'
import { listPersonas, readPersona, savePersona, deletePersona, currentPersonaText, resolvePersonaId, rulesText, seedPersonas, safeId, dataOwner, claimPending, hasRootData, personaDataDir, personaNow } from '../persona/personas.ts'
import { readLook, lookImage, lookImages, lookReferences, configureLookImage, lookMime, saveLookImage, deleteLookImage, saveAppearance, appearanceBlock, describeLook } from '../persona/persona-look.ts'
import { createModules, API_VERSION, BUILTIN_DIR } from '../core/module/index.ts'
import { createCommunity, REGISTRY_URL, GITEE_MIRROR } from '../core/module/market/community.ts'
import { createApprovalRelay } from '../security/approval.ts'
import { createNoticeRelay, normalizeWorkspace } from '../features/notices/index.ts'
import { captureSystemPrompt } from '../security/leak-guard.ts'
import { applyPendingRestore, cancelRestore, createBackup, listBackups, pendingModules, pendingRestore, setPendingModules, stageReceivedBackup, stageRestore } from '../core/runtime/backup/backup.ts'
import { pushBackup, listWebdavBackups, downloadWebdavBackup } from '../core/runtime/backup/backup-push.ts'
import { cleanText } from '../core/support/util/text.ts'
import { createBridge } from '../core/runtime/bridge.ts'
import { createDangerGuard, safeOwnedSession } from '../security/danger.ts'
import { createAuditor } from '../../packages/autotelic/impl/observe/audit.ts'
import { setSsrpMode, assertPublicUrl, fetchGuarded } from '../core/net/index.ts'
import { BUILTINS } from '../../packages/index.ts'
import { ensureDevBuild, runUpdate, tcpOpen, updateExec } from './support.ts'
import { createHttp } from './http.ts'
import { createOutboundPolicy } from '../chat/policy/outbound/index.ts'
import { createPurposePolicy, createSharedBudget } from '../features/proactive/policy/index.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type SendOptions = Partial<Record<'item', any>>

export const name = 'aurabot'
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments', 'systemPrompt', 'llm']

const ROOT = packageRoot
const PKG = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch (error) { return { version: '?' } }
})()
const VERSION = PKG.version
const STARTED_AT = Date.now()
const PREFIX = '/aurabot/api'

/**
 * 这个 DSH 会话是不是 Aurabot 的 QQ 聊天会话（私聊/群聊各对应一个 DSH 会话）。
 * 桌宠的干活状态只该跟 DSH 自己发起的活儿走，聊天回合不算（#184：每句聊天都弹完工气泡太吵）。
 */
export function isChatSession(hub, session) {
  try { return Boolean(session?.id && hub?.chatOfSession?.(session.id)) } catch (error) { return false }
}

export function apply(ctx) {
  const debugSwitch = { on: false }
  const logger = createLogger({ dsh: ctx, debugEnabled: () => debugSwitch.on })
  const log = logger.child('core')
  ensureDevBuild(log)
  // ---------- 面板首屏提速（方案 §二） ----------
  // bootId：本次宿主装配的唯一标识，面板用它判定「同一进程」的读写与保存回执；重启即换新。
  const bootId = randomUUID()
  // 核心配置与面板路由就绪前，三条轻量 GET（/panel/bootstrap|pulse|config）回 503 BOOTSTRAPPING。
  let panelCoreReady = false
  // 模块目录尚未就绪时 bootstrap 里 modulesReady=false（面板先画已知入口，占位等确认）。
  let modsReady = false
  // 恢复备份必须在读配置之前：读完配置后内存里的旧状态会写回去
  try {
    const restored = applyPendingRestore()
    if (restored) log.info(`已恢复备份：${restored} 个文件，原来的文件在 backups/ 里留了底`)
  } catch (error) { log.error('恢复备份失败：', error.message) }
  let cfg = loadConfig()
  debugSwitch.on = Boolean(cfg.debug)
  if (cfg.ownerQQ && !ownerAuthorizationRevision(cfg)) {
    try { cfg = commitConfig(cfg, cfg) }
    catch { log.warn('初始化主人授权记录失败，本次启动使用会话授权') }
  }
  // 全新安装（根目录还没有记忆、会话和流水）：当前人格直接认领根目录。老用户升级要主人在面板里认领。
  if (!dataOwner(cfg) && !hasRootData()) {
    try { cfg = commitConfig({ ...cfg, persona: { ...cfg.persona, dataOwner: safeId(cfg.persona.current) || 'dafeiyu' } }, cfg) }
    catch { log.warn('记录数据归属人格失败，本次启动所有人格共用根目录') }
  }
  let mods = null
  let bridge = null
  // 备份与云备份推送的任务状态声明在顶部：setConfig 里改云备份设置时要提前排定时器
  let backupJob = null // { running, done, total, error, result }
  let pushJob = null // { running, ok, error, result, at }
  let pushTimer = null // 云备份每日定时
  // 主动发言出站策略服务，装配在模块之前
  let outbound = null
  // 已注册的策略源实例（name → policy），给 deliver 的 enginePolicy 解析用
  const enginePolicies = new Map()
  const getConfig = () => cfg
  const personaMemoryRuntime = createPersonaMemoryRuntime({ getConfig })
  setSsrpMode(() => (getConfig().security && getConfig().security.ssrfMode === 'loose' ? 'loose' : 'strict'))
  const secrets = () => {
    registerSecret(cfg.voice?.fishApiKey)
    for (const pool of Object.values(cfg.voice?.keyPools || {})) {
      for (const account of pool.accounts || []) registerSecret(account.apiKey)
    }
    for (const k of ['httpToken', 'wsToken']) registerSecret(cfg.onebot[k]); registerSecret(cfg.imageGen.apiKey); for (const e of cfg.imageGen.fallbacks || []) registerSecret(e.apiKey); registerSecret(cfg.bridge.token); registerSecret(cfg.backup?.remote?.token); registerSecret(cfg.backup?.remote?.webdav?.password) } // backup 令牌/WebDAV 密码也按密钥脱敏（云备份）
  const setConfig = (next) => {
    const before = cfg
    // 统一提交函数（方案 §2.2）：落盘 + 发布 + configRevision 递增都收敛在 commitConfig 里；
    // 值与已发布配置完全一致时不落盘不递增（面板「只提交没变化字段」回执取接纳时版本）。
    cfg = commitConfig(next, before)
    debugSwitch.on = Boolean(cfg.debug)
    // 改机器人号后旧连接的核对结果立刻失效，必须重新核对才能处理消息或完成向导。
    if (before.botQQ !== cfg.botQQ) {
      wrongAccount = ''
      if (onebotState === 'connected') onebot.restart()
    }
    secrets()
    if (bridge && (before.bridge.dshTools !== cfg.bridge.dshTools || before.persona.current !== cfg.persona.current)) bridge.refresh()
    if (mods && (JSON.stringify(before.modules) !== JSON.stringify(cfg.modules) || before.safeMode !== cfg.safeMode)) mods.sync().catch(() => {})
    mods?.emit('config', cfg, before)
    // 声明了 reloadOnConfig 的模块：设置一改就重载，apply 里的 config 才是新的。
    mods?.reloadOnConfigChange(before?.ext, cfg.ext).catch(() => {})
    if (JSON.stringify(before.backup?.remote) !== JSON.stringify(cfg.backup?.remote)) scheduleRemoteBackup()
    return cfg
  }
  secrets()
  seedPersonas()
  // token 用量与花费（面板「概览」）：价格表可以在 config.usage.pricing 里覆盖
  initUsage(cfg.usage?.pricing)

  // ---------- 人格与规则：通过提示词变量注入到 Aurabot 的两个 preset ----------
  const variable = (n, fn) => ctx.effect(() => ctx.systemPrompt.variable(n, (...args) => captureSystemPrompt(n, cleanText(fn(...args)))), `aurabot: 变量 ${n}`)
  const rulesOpts = (kind) => (mods ? { off: mods.builtinOff(), extra: mods.rules(kind) } : {})
  // 扩展模块能整段改写人格和规则（同步：提示词变量不能等）
  const rewrite = (event, text, ...args) => { const r = mods ? mods.filterSync(event, text, ...args) : text; return typeof r === 'string' ? r : r === null ? '' : text }
  variable('aurabot_persona', () => {
    const id = resolvePersonaId(personaNow(cfg))
    return rewrite('persona', currentPersonaText(id) + appearanceBlock(id))
  })
  variable('aurabot_rules_private', () => {
    const base = rewrite('rules', rulesText('private', cfg, rulesOpts('private')), 'private')
    // 危险命令确认开着时补一句：被拦下要如实告诉主人，别绕着写
    return base + (cfg.security && cfg.security.dangerConfirm
      ? '\n【危险命令】终端命令如果被安全策略拦下（删根目录/格式化/关机/下载后直接执行等），把命令原文和原因如实告诉主人，等主人回复「确认」后再重试；不要换一种写法绕过。'
      : '')
  })
  variable('aurabot_rules_social', () => rewrite('rules', rulesText('social', cfg, rulesOpts('social')), 'social'))
  variable('aurabot_rules_group_owner', () => {
    const base = rewrite('rules', rulesText('group-owner', cfg, rulesOpts('group-owner')), 'group-owner')
    return base + (cfg.security && cfg.security.dangerConfirm
      ? '\n【危险命令】终端命令如果被安全策略拦下（删根目录/格式化/关机/下载后直接执行等），把命令原文和原因如实告诉主人，等主人回复「确认」后再重试；群里不做绕过。'
      : '')
  })

  // ---------- QQ 网关 ----------
  const endpoint = () => ({
    httpUrl: cfg.onebot.httpUrl,
    wsUrl: cfg.onebot.wsUrl,
    httpToken: cfg.onebot.httpToken,
    wsToken: cfg.onebot.wsToken,
  })
  let onebotState = 'stopped'
  // 连上后先核对登录的是不是机器人号，核对通过前不处理任何消息；不是就断开，不再自动重连
  let loginOk = false
  let wrongAccount = ''
  // 已核验登录快照（方案 §二「连接摘要」）：checkLogin 核对时顺手缓存，面板轻量接口只读它，
  // 绝不为了首屏现打 get_login_info（5 秒超时那个就是首屏卡顿的元凶）。断线即作废。
  let loginSnapshot = { uin: '', nickname: '', at: 0 }
  // 核对期间收到的事件先攒着：核对通过就补处理，核对失败就丢掉。
  // 直接丢弃的话，刚连上那几百毫秒里主人发的消息就没了（登录核对要等一次 get_login_info 往返）。
  let verifying = false
  let pendingEvents = []
  let hub = null
  let dangerGuard = null // 危险命令确认（security.dangerConfirm 开着才生效）
  let approvalRelay = null // DSH 要授权时在 QQ 私聊问主人（approvalViaQQ 开着才生效）
  let noticeRelay = null // DSH 要授权 / 要选选项时通知到主人私聊（config.notice，按工作区开关）
  async function checkLogin() {
    verifying = true
    pendingEvents = []
    try {
      let uin = ''
      let info = null
      try {
        info = await onebot.call('get_login_info', {}, { timeoutMs: 10000 })
        uin = String(info?.user_id ?? '')
        // 核对往返顺带更新登录快照（昵称一起缓存；核对本身不增加任何额外网络调用）
        loginSnapshot = { uin, nickname: info?.nickname || '', at: Date.now() }
      } catch (error) {
        logger.child('onebot').warn('核对登录的 QQ 号失败：', error.message)
      }
      if (onebotState !== 'connected') return
      if (!uin) {
        // 核对不了就别用，断开后由看门狗重试
        onebot.stop()
        return
      }
      if (String(uin) === String(cfg.botQQ)) {
        const wasOnline = onebotBot.status === 'online'
        loginOk = true
        wrongAccount = ''
        // S0：登录核对通过才算上线，插件这时才能拿到可用的 bot 实例
        onebotBot.setSelfId(uin)
        onebotBot.markOnline()
        if (!wasOnline) botRegistry.emit('online', onebotBot)
        // 把核对期间攒下的补上（按到达顺序）
        const queued = pendingEvents
        pendingEvents = []
        for (const ev of queued) handleEvent(ev)
      } else {
        wrongAccount = uin
        pendingEvents = []
        onebot.stop()
      }
    } finally {
      verifying = false
    }
  }
  /** 核对通过后的事件都在这里处理（onEvent 直接调，核对期间攒下的也会补到这里）。 */
  function handleEvent(ev) {
    if (!hub) return
    // 模块能看到所有原始事件（加群、撤回、好友申请……），只看不拦
    mods?.emit('onebot', ev)
    if (ev.post_type === 'message' || ev.post_type === 'message_sent') {
      if (ev.post_type === 'message') {
        // 危险命令确认：主人的「确认 / 取消」回复先在这里截住，不交给聊天中枢
        if (dangerGuard && ev.message_type === 'private') {
          const text = Array.isArray(ev.message)
            ? ev.message.filter((seg) => seg && seg.type === 'text').map((seg) => String(seg.data?.text || '')).join('')
            : ''
          if (dangerGuard.handleReply(`private:${ev.user_id}`, ev.user_id, text)) return
          if (approvalRelay?.handleReply(`private:${ev.user_id}`, ev.user_id, text)) return
        }
        void dispatchInbound(onebotBot, inboundOf(ev))
      }
    } else if (ev.post_type === 'notice' && ev.notice_type === 'bot_offline') {
      log.warn(`QQ 账号离线${ev.tag ? '（' + String(ev.tag).slice(0, 100) + '）' : ''}${ev.message ? '：' + String(ev.message).slice(0, 300) : ''}`)
    } else if (ev.post_type === 'notice' && ev.notice_type === 'notify' && ev.sub_type === 'poke') {
      hub.onPoke(ev).catch((error) => log.error('处理戳一戳出错：', error.message))
    } else if (ev.post_type === 'notice' && ev.notice_type === 'group_upload') {
      hub.onGroupFile(ev).catch((error) => log.error('处理群文件出错：', error.message))
    } else if (ev.post_type === 'notice') {
      hub.onNotice(ev).catch((error) => log.debug('处理通知出错：', error.message))
    }
  }
  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  const outbox = createOutbox({ log: logger.child('outbox') })
  // 网关预热：从第一次 connecting 到 connected 之间的时间，用于面板显示「已等 N 秒」而不是干等
  let gatewayWarmSince = 0
  let gatewayLastLogAt = 0
  // 预热阶段：QQ 没开 / 正在登录 / 已登录未接入 / 已接入等 OneBot / OneBot 已监听
  let warmupPhase = { phase: '', label: '' }
  let warmupProbing = false
  const onebot = createOneBotClient({
    endpoint,
    log: logger.child('onebot'),
    onState: (s, d) => {
      onebotState = s
      if (s === 'connected' || s === 'stopped' || s === 'unconfigured') { gatewayWarmSince = 0; warmupPhase = { phase: '', label: '' } }
      else if (!gatewayWarmSince && cfg.enabled) gatewayWarmSince = Date.now()
      if (s !== 'connected') {
        const wasOnline = onebotBot.status === 'online'
        loginOk = false
        pendingEvents = []
        loginSnapshot = { uin: '', nickname: '', at: loginSnapshot.at }
        onebotBot.markOffline(s)
        if (wasOnline) botRegistry.emit('offline', onebotBot, s)
      }
      else checkLogin().then(() => { if (loginOk) flushOutbox() }).catch((error) => log.warn('核对登录号出错：', error.message))
      // 预热阶段 connecting/disconnected 会每 3 秒来回刷：首次和每 20 秒记一条 info，其余进 debug
      const line = `QQ 网关：${s}${d ? '（' + d + '）' : ''}`
      const now = Date.now()
      if (s === 'connected' || s === 'stopped' || s === 'unconfigured' || now - gatewayLastLogAt > 20_000) {
        logger.child('onebot').info(line)
        gatewayLastLogAt = now
      } else {
        logger.child('onebot').debug(line)
      }
      mods?.emit('onebot/state', s)
    },
    onEvent: (ev) => {
      // 还没核对是机器人号：核对期间先攒着，核对通过后补处理
      if (!loginOk) {
        if (verifying) {
          pendingEvents.push(ev)
          if (pendingEvents.length > 200) pendingEvents.shift()
        }
        return
      }
      handleEvent(ev)
    },
  })
  let flushingOutbox = false
  // ---------- S0：Bot 注册表（v2 发送面） ----------
  // 现有链路仍走 onebot.call；这里额外提供一个「已上线机器人」的稳定视图，
  // 给 v2 插件用 session.bot / ctx.bots 发消息，行为与旧链路一致。
  const botRegistry = new BotRegistry()
  const onebotBot = new OneBotBot({
    // 调试模式 / 总开关关着时，v2 的 send 也不许真发出去——和旧链路一个口径。
    call: (action, params, options) => {
      const live = getConfig()
      if (!live.enabled) {
        log.info(`总开关关着（v2 没发）→ ${action} ${params?.group_id ?? params?.user_id ?? ''}`)
        return Promise.resolve({ ok: false, simulated: true })
      }
      return onebot.call(action, params, options)
    },
    isConnected: () => onebot.isConnected(),
    // `<voice>要念的话</voice>`：发之前先合成音频。语音模块关着就退回文字（见 voice-element.ts），
    // 这里晚绑定（tts 在下面才声明），发送发生在启动之后，不存在取不到的问题。
    speak: async (text) => {
      const voice = await tts.speak(text)
      return String(voice?.file ?? '')
    },
    log: logger.child('voice'),
  })
  botRegistry.add(onebotBot)
  // 面板「机器人列表」的数据源：QQ 是内置适配器，用 adopt 挂进来；
  // 插件用 ctx.adapter(spec) 拉起来的走 start()，两边一起在这里列出来。
  const adapterRegistry = new AdapterRegistry({
    bots: botRegistry,
    log: (message) => logger.child('adapter').info(message),
    // 适配器投进来的消息走和 OneBot 同一条管线：建 Session → command → middleware → llm
    onMessage: (bot, message) => dispatchInbound(bot, message),
    onEvent: (platform, event, payload) => {
      try {
        mods?.emit(`adapter/${event}`, { platform, payload })
      } catch (error) {
        logger.child('adapter').warn(`适配器事件「${event}」处理出错：`, String((error as Error)?.message ?? error))
      }
    },
    // 所有平台的发送都过同一道闸：调试模式不真发、<voice> 先合成、发不了的元素降级
    wrapBot: (bot) => wrapAdapterBot(bot, {
      allowed: () => {
        const live = getConfig()
        // 沙盒是本地联调平台，不受「总开关」限制；真实平台仍然要主人显式打开。
        return Boolean(live.enabled) || bot.platform === 'sandbox'
      },
      log: (message) => logger.child('adapter').info(message),
      speak: async (text) => String((await tts.speak(text))?.file ?? ''),
    }),
    speak: async (text) => String((await tts.speak(text))?.file ?? ''),
  })
  adapterRegistry.adopt(onebotBot)
  ctx.effect(() => () => { adapterRegistry.stopAll().catch(() => {}) }, 'aurabot: 适配器下线')

  // ---------- S5：入站管线 ----------
  // command → middleware → llm。顺序与开关都在配置里（开发中配置项）。
  const pipeline = new Pipeline({
    commandPrefixes: Array.isArray(cfg.commandPrefixes) ? cfg.commandPrefixes : [null, '/'],
    middlewareAfterCommand: Boolean(cfg.middlewareAfterCommand),
    // 中间件 / 指令 / 模型段出错默认是「跳过这一段继续走」，
    // 但插件作者得看得见自己那段炸了，否则表现就是「我写的中间件没生效」。
    onError: ({ stage, error }) => log.warn(`管线「${stage}」出错：${String((error as Error)?.message ?? error)}`),
  })
  pipeline.onLlm((session) => {
    const event = session instanceof Session && session.bot === onebotBot ? eventForHub(session) : undefined
    if (event && hub) {
      if (session.sentLog?.length) {
        const chatId = session.type === 'private' ? `private:${session.userId}` : `group:${session.channelId}`
        for (const item of session.sentLog.splice(0)) {
          try {
            hub.noteSaid?.(chatId, item.text)
          } catch (error) {
            log.warn('出站回写失败：', String((error as Error)?.message ?? error))
          }
        }
      }
      return hub.onMessage(event)
    }
    return mods?.emitAsync('llm', session)
  })

  function dispatchInbound(bot: BotLike, message: InboundMessage) {
    try {
      mods?.emit('adapter/message', { platform: bot.platform, ...message })
    } catch (error) {
      log.warn('适配器消息广播出错：', String((error as Error)?.message ?? error))
    }
    const session = inboundSession(bot, message, pipeline)
    if (!session.content.trim() && !session.elements.length) return
    return pipeline.dispatch(session).then((result) => {
      if (result.error) log.error(`处理消息出错（${result.by}）：`, result.error)
      return result
    }).catch((error) => {
      log.error('处理消息出错：', error.message)
      return { handled: false, by: null, error: String(error?.message ?? error) }
    })
  }

  async function flushOutbox () {
    if (flushingOutbox || onebotState !== 'connected' || !loginOk) return
    flushingOutbox = true
    try {
      const r = await outbox.flush((action, params, opts) => onebot.call(action, params, { ...opts, retries: 0 }),
        item => !item.incomingReply || item.action !== 'send_group_msg' || groupResponseMode(cfg, item.params?.group_id) === 'chat',
        (item, result) => {
          // #327：主动发言入队时带了来路，补发成功后要补回聊天流水与「别处说过」，否则断线恢复后她不记得发过什么。
          if (item.proactive) {
            try { hub.noteProactive(item.chatId, item.params?.message || [], { proactiveCause: item.proactive }) } catch (error) { logger.child('outbox').warn('补发后补记主动发言失败：', error.message) }
          }
          if (item.action !== 'send_private_msg' || item.chatId !== `private:${item.params?.user_id}` ||
              (item.deliveryScope as any)?.botQQ !== loginSnapshot.uin || (result as any)?.queued) return
          personaMemoryRuntime.confirmDelivery(item.chatId, (result as any)?.message_id, item.deliveryScope)
        })
      if (r.sent || r.dropped || r.left) log.info(`补发队列：成功 ${r.sent}，丢弃 ${r.dropped}，剩余 ${r.left}`)
    } catch (error) {
      logger.child('onebot').warn('补发队列出错：', error.message)
    } finally {
      flushingOutbox = false
    }
  }
  // 连接后漏掉的、或补发中途又断网的，定时再试；没连接时直接返回。
  ctx.effect(() => ctx.interval(() => { flushOutbox().catch(() => {}) }, 10_000), 'aurabot: 补发队列')

  /** 预热阶段变化时记一条 info（同一阶段不重复刷）。 */
  function setWarmupPhase (phase, label) {
    if (warmupPhase.phase === phase) return
    warmupPhase = { phase, label }
    if (gatewayWarmSince) logger.child('onebot').info(`网关预热：${label}`)
  }
  /** 每 2 秒看一次 OneBot 端口有没有起来；只在预热期跑，连上/关掉/超过 5 分钟就停。 */
  async function probeWarmup () {
    if (warmupProbing || !gatewayWarmSince || onebotState === 'connected') return
    if (!cfg.enabled) return
    if (Date.now() - gatewayWarmSince > 300_000) return
    warmupProbing = true
    try {
      const ep = endpoint()
      let wsPort = 0
      try { wsPort = Number(new URL(ep.wsUrl).port) || 0 } catch (error) {}
      if (wsPort && await tcpOpen(wsPort)) return setWarmupPhase('onebot-ready', `OneBot 已经在 ${wsPort} 端口监听，正在握手`)
      return setWarmupPhase('onebot-wait', '正在等 OneBot 协议端监听')
    } catch (error) {
      setWarmupPhase('unknown', '正在等网关（' + error.message + '）')
    } finally {
      warmupProbing = false
    }
  }
  ctx.effect(() => ctx.interval(() => { probeWarmup().catch(() => {}) }, 2000), 'aurabot: 网关预热探测')
  const groupRoles = createGroupRoles({ onebot, getConfig, log: logger.child('chat') })
  const local = createLocal({ getConfig, log: logger })
  const mutes = createMutes()

  /**
   * DSH 里能用的所有模型：[{provider, model, name, reasoning}]。
   * reasoning 是 {efforts:[...], default} 或 null（null = 这个模型不支持思考强度，
   * 面板据此把「思考强度」置灰，免得选了之后整轮报错）。
   */
  async function listModels() {
    const llm = ctx.llm || ctx.get('llm')
    const out = []
    for (const p of llm.listProviders() || []) {
      const provider = typeof p === 'string' ? p : p.provider || p.id || p.name
      try {
        for (const m of (await llm.listModels(provider)) || []) {
          const model = m.id || m.model
          out.push({ provider, model, name: m.name || model, reasoning: await modelReasoning(ctx, provider, model), vision: await modelVision(ctx, provider, model) })
        }
      } catch (error) {}
    }
    if (out.length) modelCache = out
    return out
  }
  // 最近一次查到的模型列表：按聊天选的模型已经不在 DSH 里了，就退回下一级（同步取，hub 每条消息都要用）
  let modelCache = null
  setTimeout(() => { listModels().catch(() => {}) }, 3000).unref?.()

  // 聊天中枢找表情库、语音时，找的是当时在跑的那个模块；模块关着就当没有
  const use = (id) => mods?.use(id) || null
  const stickers = {
    match: (q) => use('stickers')?.match?.(q) ?? null,
    segmentFor: (it) => use('stickers')?.segmentFor?.(it) ?? null,
    markUsed: (md5) => use('stickers')?.markUsed?.(md5),
    pickForReply: (t) => use('stickers')?.pickForReply?.(t) ?? null,
    collect: async (s, chatId) => (use('stickers')?.collect ? use('stickers').collect(s, chatId) : { ok: false, reason: '表情包模块关着' }),
    library: () => use('stickers')?.library?.() ?? { items: [] },
  }
  const tts = {
    speak: async (text) => {
      const v = mods?.services.get('voice')
      if (!v?.speak) throw new Error('没有插件提供 voice 服务（语音插件关着？）')
      return v.speak(text)
    },
  }

  hub = createHub({
    localApi: local,
    dsh: ctx,
    getConfig,
    log: logger.child('chat'),
    onebot,
    outbox,
    stickers,
    tts,
    // 语音识别同样按服务取：语音插件关掉就退回 QQ / DSH 识别。
    asr: () => mods?.services?.get?.('asr') ?? null,
    // ACP 标记的模型兜底（chat.acpSanitize.modelFallback，默认关）要用它问一次宿主模型。
    // 走的是「不进会话」的既有封装 askModel，不占聊天会话、不计入她的上下文。
    askModel: (opts) => askModel(ctx, { cfg: getConfig(), ...opts }),
    buildTools: (where) => mods.buildTools(where),
    // 模块声明的能力（package.json.aurabot.capabilities）：子智能体委派这类要本机权限的能力靠它把关（一审 #177）
    capabilitiesOf: (id) => (typeof mods.capabilitiesOf === 'function' ? mods.capabilitiesOf(id) : []),
    contextProviders: [(args) => mods.contextFor(args)],
    onActivity: (a) => mods.emit('activity', a),
    // 群聊话题和她的记忆有多相关（插话判断用）
    memoryScore: (text) => use('memory')?.topicScore?.(text) ?? 0,
    dislikes: (qq) => use('memory')?.dislikes?.(qq) ?? false,
    onMemoryCommand: (msg, text) => use('memory')?.handleCommand?.(msg, text),
    // QQ 里的主人命令（模块加的命令优先）
    onCommand: async (msg, markSensitive, ownerStillCurrent) => {
      const commands = mods.commands()
      const cmd = parseCommand(msg.text, commands)
      if (!cmd) return null
      // 框架自己一条指令都不预设：内置命令表住在「主人命令」模块里，关了就当普通聊天；
      // 插件用 api.command() 注册的命令不受影响。
      if (!cmd.ext && !use('commands')) return null
      if (!ownerStillCurrent()) {
        const key = delegatedCommandKey(cmd)
        if (!canUseDelegatedCommand(getConfig(), msg, key)) return '你没有使用这个命令的权限，请联系主人设置。'
        if (key === 'help') {
          const list = commandList(commands).filter((item) => canUseDelegatedCommand(getConfig(), msg, delegatedCommandKey(parseCommand('/' + item.name, commands))))
          return '你可以使用的命令：\n' + list.map((item) => {
            const desc = item.name === 'model' ? '查看或切换当前私聊模型' : item.desc
            return `/${item.name}  ${desc}`
          }).join('\n')
        }
        if (key === 'model') return runPersonalModelCommand(cmd, msg, { getConfig, setConfig, listModels, defaultModel: () => defaultModel(ctx, getConfig()) })
      }
      if (cmd.ext) {
        if (cmd.ext.sensitive === true && !markSensitive(cmd.name)) return ''
        return String((await cmd.ext.run(cmd.arg, msg)) ?? '')
      }
      if (['permissions', 'groupsettings'].includes(cmd.name) && !markSensitive(cmd.name)) return ''
      return runCommand(cmd, msg, { getConfig, setConfig, mutes, hub, onebot, ownerStillCurrent, log: logger, mood: use('mood'), memory: use('memory'), qzone: use('diary'), song: use('song'), listModels, reasoningFor: (provider, model) => modelReasoning(ctx, provider, model, { refresh: true }), defaultModel: () => defaultModel(ctx, { model: {} }), extraCommands: mods.commands() })
    },
    isMuted: (chatId) => mutes.muted(chatId),
    moodEffects: () => use('mood')?.effects?.() ?? null,
    availableModels: () => modelCache,
    // 模块（重）启动代际：模块热重载后工具名没变、但实例换了，hub 要据此重挂工具（issue #73）
    toolsGeneration: () => (mods ? mods.generation?.() || 0 : 0),
    hooks: {
      message: (msg) => mods.claim('message', msg),
      reply: (text, info) => mods.filter('reply', text, info),
      // 人格和规则的最终渲染值由 variable 在当前回合记录，发送时不重新生成。
      secrets: () => [],
      deniedTools: () => bridge?.deniedTools() || [],
      groupDecide: (decision, info) => mods.filter('group/decide', decision, info),
      prompt: (content, info) => mods.filter('prompt', content, info),
      items: (items, info) => mods.filter('reply/items', items, info),
      send: (message, info) => mods.filter('send', message, info),
      model: (sel, chat) => mods.filterSync('model', sel, chat),
      poke: (ev) => mods.claim('poke', ev),
      journal: (row) => mods?.emit('chat/log', row),
      deliveryScope: (chatId, personaId, botQQ) => loginOk && loginSnapshot.uin === botQQ
        ? personaMemoryRuntime.captureDelivery(chatId, personaId, botQQ)
        : null,
      delivery: personaMemoryRuntime.confirmDelivery,
    },
  })
  const http = createHttp({ ctx, getConfig, log, prefix: PREFIX, getMods: () => mods })
  const { send, readBody, readRaw, query, answer, route, panelBlocked, adminHostBlocked, csrfBlocked, isLoopbackAddr, panelNeedsLocal } = http
  // ---------- 主动发言出站策略 ----------
  // 宿主统一发送服务：模块快捷 API / scoped hub / pet 回落全部经它判定，识别「主动私聊主人」
  // 后交给当前活跃策略源做原子预算预占。档位默认 pass（旧行为直发），未启用时完全惰性。
  outbound = createOutboundPolicy({
    getConfig,
    // 账本落盘到模块数据目录（源码目录禁写任何数据，见 AGENTS.md §4）
    dataDir: join(dataDir('modules-data'), 'outbound-policy'),
    log: (msg) => logger.child('出站策略').info(msg),
    // 宿主投递器：模块调 api.proactive.submit 后由这里真正发出去，
    // 模块不必自己管投递、超时、状态回写（设计稿 §7 feed 语义）。
    // broker 档的核心语义是「提交后由引擎全权决定」（设计稿 §7）：
    //   1) 先向目的引擎策略源拿「审查预占」（reserveReview）：只看引擎开关/清醒时段/在途串行，
    //      **不占引擎的说话额度、不看她的排程**（2026-11-04 主人定的口径）；
    //   2) 预占到了再让引擎过目（brokerReview：原样/改写/沉默）——凭记忆与心情决断内容；
    //   3) 决断沉默 → 返回 false（账本记 failed，模块据此知道没发）；
    //   4) 决断通过 → 走 hub.deliver 投递：自动落聊天流水（logChat）+ saidElsewhere 桥接 +
    //      心情链路，比裸 sendText 多出完整会话记录。
    // 最后按 review 口径结算预占（只清挂起，不动额度不重排）。
    // item 是账本条目（含 moduleId/itemId），代发决断会话里要跟着写清是谁提交的。
    send: async (to, text, meta : SendOptions = {}) => {
      const item = (meta && meta.item) || {}
      const moduleId = String(item.moduleId || '')
      const itemId = String(item.itemId || '')
      const policy = enginePolicies.get('purpose') || null
      let reviewId = ''
      if (policy && typeof policy.reserveReview === 'function') {
        const r = policy.reserveReview({ to: String(to), itemId, at: Date.now() })
        if (!r || r.ok !== true) return false // 引擎没开/安静时段/上一条还在途：这条不审查不发
        reviewId = r.reserveId
      }
      let finalText = String(text ?? '')
      try {
        const purpose = use('purpose')
        if (purpose && typeof purpose.brokerReview === 'function') {
          const verdict = await purpose.brokerReview({ to: String(to), text: finalText, moduleId, itemId })
          if (verdict && verdict.ok && verdict.send === false) return false // 引擎决断：这条不说
          if (verdict && verdict.ok && verdict.text) finalText = verdict.text
        }
        const r = await hub.deliver(String(to), finalText, { userText: '【系统提醒，不是主人说的话】（代发·经目的引擎决断）' })
        // deliver 契约：一条都没发出去时返回 {failed>0} 或 undefined——都按「没发出」算
        return Boolean(r && (r.failed ?? 0) === 0)
      } finally {
        if (reviewId && policy && typeof policy.commit === 'function') {
          try { policy.commit(reviewId, { outcome: 'sent' }, 'review') } catch {}
        }
      }
    },
  })

  // ---------- 模块 ----------
  const core = {
    hub, onebot, local, groupRoles, mutes, logger, bridge: null as unknown,
    // S0：v2 发送面。ctx.bots[0] / ctx.bots('号') / ctx.bots.list()
    bots: createBotsAccessor(botRegistry),
    bot: onebotBot,
    // S5：入站管线（ctx.middleware / ctx.command 挂在这上面）
    pipeline,
    // S8：适配器插件化。插件调 ctx.adapter(spec, config) 就能挂一个平台上来
    adapters: {
      start: (spec, config) => adapterRegistry.start(spec, config),
      list: () => adapterRegistry.list(),
    },
    root: ROOT,
    // 模块经 api.proactive 访问出站治理面（modules.js 里读它）
    outbound,
    ask: (opts) => askModel(ctx, { cfg: getConfig(), ...opts }),
    // 模块侧的 ctx.llm：润色 / 改写 / 摘要（后台调用，不进聊天会话）
    llm: createLlmFacade({ ask: (opts) => askModel(ctx, { cfg: getConfig(), ...opts }), log: logger.child('llm') }),
    // 模块侧的 ctx.tts：文字转语音，`<voice>文字</voice>` 和主动发语音都走它
    tts,
    listModels,
    defaultModel: () => defaultModel(ctx, { model: {} }),
    http: { body: readBody, raw: readRaw, query, send },
    media: createMediaAccess({ root: ROOT, use, config: getConfig }),
    identity: { owner: () => String(cfg.ownerQQ || '') },
    personas: {
      list: listPersonas, read: readPersona, current: () => currentPersonaText(cfg.persona.current),
      look: (sessionId) => {
        const id = resolvePersonaId((sessionId && hub.personaOf(sessionId)) || personaNow(cfg))
        const references = id ? lookReferences(id, { lazy: true }) : []
        return { get image() { return references[0]?.image || null }, references, appearance: id ? readLook(id).appearance : '' }
      },
    },
    getConfig,
    // 下面几个由装配过程回填：模块/桥/守卫要读，属于运行期挂载位，不在初始字面量里。
    modules: undefined as unknown,
    dangerGuard: undefined as unknown,
    autotelicAudit: undefined as unknown,
    autotelicAuditOn: false,
  }
  mods = createModules({ ctx, core, getConfig, setConfig, logger, version: VERSION, builtins: BUILTINS, personaMemoryRuntime })
  bridge = createBridge({ ctx, getConfig, setConfig, hub, mods, log: logger.child('bridge'), version: String(VERSION), apiVersion: API_VERSION, overview: () => overview() })
  core.bridge = bridge
  core.modules = mods

  // ---------- 面板首屏：三条轻量只读接口（GET /panel/bootstrap|pulse|config，方案 §二/§2.1） ----------
  // 铁规矩：只读宿主内存——绝不触发 OneBot 网络探测、不启动网关、不重扫模块目录。
  // 鉴权/Host/CSRF 与其它管理面一致（route() 内统一过闸）；no-store 由 send() 统一带上。
  // 常用开关的界面显示值（调试模式口径与 publicConfig 相同：调试开着时调试模式显示为关）。
  const controlsView = () => ({
    enabled: Boolean(cfg.enabled),
    debug: Boolean(cfg.debug),
    safeMode: Boolean(cfg.safeMode),
  })
  // 连接快照：QQ 直连只用事件状态（onebotState）+ 已核验登录快照（checkLogin 顺带缓存），
  // 原因码只给可公开的机器值（reason），不给内部细节。
  const connectionsView = () => {
    const connected = onebotState === 'connected'
    const verified = connected && loginOk
    let stage = 'connecting'
    let reason = 'gateway_connecting'
    if (!cfg.enabled) { stage = 'disabled'; reason = 'disabled_in_config' }
    else if (connected && verified) { stage = 'connected'; reason = 'ok' }
    else if (connected) { stage = 'verifying'; reason = wrongAccount ? 'wrong_account' : 'verifying_login' }
    else if (onebotState === 'unconfigured') { stage = 'unconfigured'; reason = 'gateway_unconfigured' }
    else if (onebotState === 'stopped') { stage = 'disconnected'; reason = 'gateway_disconnected' }
    else if (gatewayWarmSince) { reason = 'gateway_warming' }
    return [{
      platform: 'qq',
      instanceId: 'onebot',
      enabled: Boolean(cfg.enabled),
      stage, // connected | verifying | connecting | disconnected | unconfigured | disabled
      verified,
      reason, // ok | wrong_account | verifying_login | gateway_warming | gateway_connecting | gateway_disconnected | gateway_unconfigured | disabled_in_config
      login: verified ? { uin: loginSnapshot.uin, nickname: loginSnapshot.nickname } : null,
      warmupSeconds: gatewayWarmSince ? Math.max(0, Math.round((Date.now() - gatewayWarmSince) / 1000)) : 0,
    }]
  }
  // 导航摘要：mods 尚未装配时给空表（bootstrap 用 modulesReady=false 提示面板先占位）。
  const navSummary = () => (mods ? mods.summarizeModules() : { navigationRevision: 0, modules: [] })
  const navRevision = () => (mods ? mods.navigationRevision() : 0)
  // 核心配置/路由未就绪：三条轻量 GET 统一回 503 BOOTSTRAPPING（方案 §2.1「启动与失败」）。
  const bootstrapping = (res) => {
    if (panelCoreReady) return false
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
      modulesReady: modsReady,
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
    return { ok: true, bootId, configRevision: configRevision(), config: publicConfig(cfg) }
  })
  // 配置已加载、上述路由已注册：之后轻量读接口直接回 200（503 只覆盖装配早期）。
  panelCoreReady = true

  // 出站门闸接进 hub（第二道保险：模块直调 api.core.hub.sendText / scopedHub 也都被覆盖）。
  // 判定的来源因果由调用方带 sourceModule / enginePolicy 时生效；没带标记的内部发送完全不受影响。
  // settle：admit 放行时会预占一份策略源预算，不结算就永远挂着（下一轮变成 busy），
  // 所以把结算回调一起交给 hub，由真实出口按结果 commit/release。
  hub.setOutboundGuard?.((ask) => {
    const verdict = outbound.admit({
      to: ask.chatId,
      moduleId: ask.sourceModule || '',
      origin: ask.sourceModule ? 'module' : 'engine',
      cause: ask.cause || null,
      itemId: ask.itemId || null,
      at: Date.now(),
    })
    if (verdict.action === 'deny') return verdict
    return {
      ...verdict,
      // 真实出口结算：sent 记一笔；uncertain 不退款（可能已经发出去了）；其余按失败释放
      settle: (outcome) => {
        const oc = ['sent', 'queued', 'uncertain', 'failed'].includes(outcome) ? outcome : 'failed'
        if (verdict.reserveId) outbound.commit(verdict.reserveId, { deliveryId: verdict.deliveryId, outcome: oc })
      },
    }
  })
  // 引擎路径：deliver(chatId, text, { enginePolicy: 'purpose' | 'speakup' }) 由 hub 直接向策略源 reserve。
  // 只有注册过（引擎启用且模块在跑）的才解析得到；解析不到时 deliver 完全按旧行为直发。
  hub.setOutboundEngineResolver?.((name) => enginePolicies.get(String(name)) || null)

  /**
   * 按当前配置装配策略源：purpose / speakup 各自启用时才注册（未启用的不注册，
   * 服务据此判定 managed 与 deny 语义，设计稿要求故障不得静默 pass）。
   *
   * 策略源要拿到 speakup / purpose 模块的实例面（use('speakup').state() 等），
   * 而模块是异步启动的，所以这里做成可重复调用的懒装配：模块起来之后再调一次即可，
   * 重复注册同名策略源是幂等的（服务内部按 name 覆盖）。
   */
  function wirePolicySources() {
    if (!outbound) return
    const cfg = getConfig()
    const dir = join(dataDir('modules-data'), 'outbound-policy')
    const say = (msg) => logger.child('出站策略').info(msg)
    const budget = createSharedBudget({ ownerQQ: cfg.ownerQQ, dataDir: dir, log: say })
    try {
      // 目的引擎（P1/Q1 拍板默认开）：模块在跑且配置未显式关才注册。键缺省=开、显式 false 不注册；
      // 引擎未 ready 时不注册，服务自己会处理 managed=false 与 deny 语义（设计稿故障语义：不得静默 pass）。
      const pu = use('purpose')
      if (cfg.ext?.purpose?.enabled !== false && pu) {
        const policy = createPurposePolicy({
          getConfig, engine: pu, state: () => pu.state?.() || null,
          dataDir: dir, log: say, budget,
        })
        outbound.registerPolicySource(policy)
        enginePolicies.set('purpose', policy) // 给 deliver(…, { enginePolicy: 'purpose' }) 用
        // §5.3 私有凭据：引擎自发发言经 deliver 的 enginePolicy 路径直接向策略源
        // reserve/commit（单本账），不再被模块包装层门闸按另一本账二次拦。
        pu.setEnginePolicySource?.(policy)
      } else {
        outbound.unregisterPolicySource('purpose')
        enginePolicies.delete('purpose')
        use('purpose')?.setEnginePolicySource?.(null) // 策略源撤了，凭据一并撤
      }
      // 主动搭话策略源（P3 收拢）：不再注册 speakup 源——主动搭话已并入目的引擎（P1），
      // 出站治理只认 purpose。createSpeakupPolicy 代码暂留（P5 清理批次处置）；
      // 存量账本 speakup-policy.json 保留原文不合并（两套口径不同，见方案 §6）。
      outbound.unregisterPolicySource('speakup')
      enginePolicies.delete('speakup')
      // 主人换号：旧 pending 一律作废（设计稿「接收人固定」）
      outbound.syncOwnerQQ?.(cfg.ownerQQ)
      // 面板存过的 activePolicy 要在重启后重新生效（否则配置写了却只有服务实例的默认值在跑）；
      // P3 存量归一化：老配置里存的 'speakup' 生效为 'purpose'（服务侧 setActivePolicy 也兜一层）
      const rawActive = (cfg.ext?.outboundPolicy && cfg.ext.outboundPolicy.activePolicy) || 'auto'
      outbound.setActivePolicy?.(rawActive === 'speakup' ? 'purpose' : rawActive)
    } catch (error) {
      // 装配失败不能拖垮宿主启动：服务会因「无 ready 策略源」拒绝并显示原因
      logger.child('出站策略').warn('策略源装配失败：', error && error.message)
    }
  }
  // 模块还没起来，先做一次（建立预算域/主人快照）；模块启动后会再调一次
  wirePolicySources()
  // 危险命令确认（可选保护）：DSH 在真正执行终端工具前会走 tools/pre-execute；
  // 这里只拦 bash / pwsh 的危险命令，其它工具和普通命令原样放行。
  dangerGuard = createDangerGuard({
    getConfig,
    log: logger.child('危险命令'),
    deliver: (chatId, text) => hub.sendText(chatId, text),
    chatOfSession: (sessionId) => { try { return hub.chatOfSession?.(sessionId) || '' } catch (error) { return '' } },
    // tools/pre-execute 是进程级的，同一个 DSH 里主人自己开的会话也会走到这里；那些会话不归这个守卫管
    // 判断不出来（hub.isOwnedSession 缺失 / 抛错）时 safeOwnedSession 返回 true，走原 deny 逻辑；
    // 只有明确 false（宿主自己的 GUI/CLI 会话）才放行给 DSH 自己的权限系统，别在异常时 fail-open。
    isOwnedSession: safeOwnedSession(typeof hub?.isOwnedSession === 'function' ? (sessionId) => hub.isOwnedSession(sessionId) : null),
    ownerQQ: () => cfg.ownerQQ,
  })
  core.dangerGuard = dangerGuard
  approvalRelay = createApprovalRelay({
    getConfig,
    deliver: (chatId, text) => hub.sendText(chatId, text),
    chatOfSession: (id) => hub.chatOfSession(id),
    // 等主人回复「确认」多久：可配置（config.approvalTimeoutSec，秒），默认 5 分钟
    timeoutMs: (Number(getConfig().approvalTimeoutSec) || 300) * 1000,
    log,
  })
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('approval/request', (request, next) => approvalRelay.onRequest(request, next)) } catch (error) { log.debug('挂审批应答失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurabot: QQ 审批')
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('tools/pre-execute', (exec, next) => dangerGuard.preExecute(exec, next)) } catch (error) { log.debug('挂危险命令确认失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurabot: 危险命令确认')

  // ---------- 自驱引擎审计（P0.5 地基）----------
  // 「她可以骗主人，但不能骗账本」：她（system:autotelic* 会话）的工具调用全量机械落盘（哈希链）。
  // 三条硬规矩：只记录不放行（永远 return next()）；异步入队绝不同步写盘（pre-execute 是进程级
  // waterfall，同步写会拖住主人 GUI 里的工具调用）；失败静默（审计挂了不能影响正常聊天）。
  // 过滤口径：isOwnedSession() 且 chatOfSession 以 system:autotelic 开头，两个条件都要——
  // 主人 GUI 会话、QQ 私聊、群聊里的调用一律不进她的账本。模块侧经 core.autotelicAuditOn 得知已接线。
  const autotelicAudit = createAuditor({
    dir: dataDir('modules-data', 'autotelic', 'audit'), // host 侧拿不到模块 api，要自己带上 modules-data/autotelic 前缀
    chatOfSession: (sessionId) => { try { return hub.chatOfSession?.(sessionId) || '' } catch (error) { return '' } },
    isOwnedSession: safeOwnedSession(typeof hub?.isOwnedSession === 'function' ? (sessionId) => hub.isOwnedSession(sessionId) : null),
    // 写工具只许写她自己的数据目录（2026-11-05 真机审计实证：她确实用 edit/write 改自己的 notes，
    // 属于预期用法，所以不封工具、只封路径；框架代码 src/ 一律不许动）
    ownRoot: dataDir('modules-data', 'autotelic'),
    log: logger.child('自驱审计'),
  })
  core.autotelicAuditOn = true
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('tools/pre-execute', (exec, next) => autotelicAudit.preExecute(exec, next)) } catch (error) { log.debug('挂自驱审计失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurabot: 自驱审计（工具意图）')
  ctx.effect(() => { try { core.autotelicAudit = autotelicAudit } catch {} return () => { autotelicAudit.dispose().catch(() => {}) } }, 'aurabot: 自驱审计（卸载冲账）')

  // ---------- 桌宠端口注入（破「端口自举死锁」） ----------
  // pet 模块写 host.json 的 baseUrl 需要真实 Web 端口，而它自己监听不到（端口未知时只能写 null，
  // 客户端连不上 → 学不到 Host 头 → 死锁）。DSH 的 webServer 服务知道端口（ctx.webServer.port，
  // 取不到再退 DSH_WEB_URL）。注入时机：pet 每次启动/重载（module/start）+ boot 完成兜底各试一次；
  // Host 头学习仍保留，作端口漂移纠正。
  function webPortOf() {
    let port = Number(ctx?.webServer?.port)
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
      try { port = Number(new URL(String(process.env.DSH_WEB_URL || '')).port) } catch { port = 0 }
    }
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0
  }
  // ---------- 桌宠远端直连（publicBaseUrl，2026-11-02）----------
  // 单一真相：ext.pet.publicBaseUrl（pet 模块 api.settings() 读同一键；面板写入通道见 /panel/pet/config 与
  // /panel/pet/public-base）。合法 http(s) URL 才生效；配置后 pet 的 host.json 写远端地址、guard 放行远端
  // Host/Origin、面板把 Electron 三键换成「下载客户端包」。未配置时 pet 一切行为与旧版一致（同机零退化）。
  function publicBaseUrlOf() {
    const raw = String(getConfig().ext?.pet?.publicBaseUrl || '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(raw)) return ''
    try { const u = new URL(raw); if (!u.hostname) return '' } catch { return '' }
    return raw
  }
  function injectPetPort() {
    const port = webPortOf()
    if (!port) return false
    try { return Boolean(use('pet')?.setWebPort?.(port)) } catch { return false }
  }
  mods.listen('module/start', (id) => { if (id === 'pet') injectPetPort() })

  let unloaded = false
  const community = createCommunity({ mods, getConfig, setConfig, log, version: VERSION, alive: () => !unloaded })
  const booted = mods.boot()
  booted.then(() => { modsReady = true /* 模块目录就绪：bootstrap 的 modulesReady 转 true */ }).catch(() => {})
  booted.then(() => injectPetPort()).catch(() => {})
  booted.then(() => { if (getConfig().debug) hub.ensureDebugSession().catch((error) => log.warn('建调试会话失败：', error.message)) }).catch(() => {})
  // 模块起来之后再把策略源接上（此时 use('speakup') / use('purpose') 才拿得到实例）
  booted.then(() => wirePolicySources()).catch((error) => logger.child('出站策略').warn('策略源接线上失败：', error && error.message))
  booted.then(() => (unloaded ? [] : community.migrate())).catch((error) => log.warn('搬到社区库的模块处理失败：', error.message))
    .then(async () => {
      // 恢复备份后把市场模块装回来；没装上的留着，下次启动再试
      const left = []
      for (const id of pendingModules()) {
        if (unloaded) return
        const r = await community.install(id) as { ok?: boolean; message?: string }
        if (!r.ok && !/自己的文件夹/.test(r.message)) { left.push(id); log.warn(`恢复模块「${id}」没装上，下次启动再试：`, r.message) }
      }
      if (!unloaded) setPendingModules(left)
    }).catch((error) => log.warn('恢复模块失败：', error.message))
  booted.then(() => { if (!unloaded) bridge.refresh() })

  // ---------- 审批 / 提问：DSH 要人处理时把请求说到 QQ ----------
  // 只上报，不代答：DSH 界面照常弹，谁在电脑前谁点。按工作区分别开关（config.notice）。
  function workspaceList() {
    try {
      const reg = ctx.workspaceRegistry || ctx.get?.('workspaceRegistry')
      return reg?.list?.() || []
    } catch (error) { return [] }
  }
  function workspaceOfSession(sessionId) {
    const sid = String(sessionId || '')
    if (!sid) return ''
    const hit = workspaceList().find((w) => (w?.sessionIds || []).some((x) => String(x) === sid))
    return hit ? String(hit.path || '') : ''
  }
  // 上一次往私人会话推提醒的时间：10 秒内不再推，避免连着进来几批时刷屏
  let lastNoticePush = 0
  /**
   * 把攒下来的几件事，推进主人的私聊会话让她自己说。
   * 走的是完整人格 + 私聊上下文，不再拼独立提示词；推不进去（会话坏了、还没恢复）就整批不发。
   */
  async function noticeText(items) {
    const list = Array.isArray(items) ? items : []
    if (!list.length) return false
    if (Date.now() - lastNoticePush < 10000) return false
    const now = getConfig()
    const owner = String(now.ownerName || '主人').slice(0, 12)
    // 精确到秒：同一分钟里连着来的两件也能分开，不会被当成同一件
    const clock = (t) => {
      const d = new Date(Number(t) || Date.now())
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    const lines = list.map((it, i) => {
      const title = String(it.title || '未命名').slice(0, 40)
      const at = clock(it.at)
      if (it.kind === 'approval') return `${i + 1}. [${at}] 有个会话卡在 ${it.tool || '某个工具'} 上，等他点批准（会话：${title}）`
      const q = (it.questions || []).map((x) => x?.question).filter(Boolean)[0] || '有个问题'
      return `${i + 1}. [${at}] 有个会话在等他选方案：${String(q).slice(0, 60)}（会话：${title}）`
    })
    try {
      const prompt = `（这是一条提示信息，通知你的主人：他电脑上有活卡住了，需要他去 DSH 界面处理。现在是 ${clock(Date.now())}。\n下面每一条都是一次单独的审批或选择请求，编号或时间不重复就是不同的事。\n${lines.join('\n')}\n用你自己的性格和语气随口跟他提一句，就当聊天里顺口提一嘴；别念条目、别像发通知。）`
      // 把真正推给会话的内容也记下来：排查「模型为什么说没带编号」时，先看它到底收到了什么
      log.info(`推送提示：${prompt.replace(/\n/g, ' | ').slice(0, 600)}`)
      await hub.pushToSession(
        { chatId: `private:${now.ownerQQ}`, kind: 'private', userId: now.ownerQQ, nickname: owner },
        [{ type: 'text', text: prompt }],
        ''
      )
      lastNoticePush = Date.now()
      return true
    } catch (error) {
      log.warn?.('上报推送失败：', error.message)
      return false
    }
  }
  noticeRelay = createNoticeRelay({
    getConfig,
    workspaceOf: workspaceOfSession,
    compose: noticeText,
    // 合并窗口可配置（config.notice.windowSec，秒）：审批/选项请求到齐后等多久再推 QQ
    windowMs: (Number(getConfig().notice?.windowSec) || 8) * 1000,
    log,
  })
  async function notifyApproval(session, event) {
    try {
      if (!cfg.enabled) return
      const d = event.data || {}
      const id = String(d.id || '')
      if (!id) return
      // 等一下看 QQ 有没有问：问了就不用再通知；没问（比如审批没走到插件）照常通知，主人不会什么都收不到
      if (approvalRelay?.handles(session?.id)) {
        await new Promise((r) => setTimeout(r, 1500))
        if (approvalRelay.askedRecently()) return
      }
      let title = ''
      try { title = String(session?.title || '').trim() } catch (error) {}
      // 和提问一样：会话事件里的 session 常常没带标题，用 id 后 8 位兜底（完整 id 太长，模型认不出是编号）
      if (!title) title = String(session?.id || '').slice(-8)
      const queued = noticeRelay.announce('approval', { id, sessionId: session?.id, title, tool: d.toolName, reason: d.reason })
      // 留一行痕迹：排查「为什么这个会话的审批没推到 QQ」时，至少能看出是没收到、被开关挡掉，还是已入队
      log.info(`审批上报：${d.toolName || '?'}（会话 ${String(session?.id || '').slice(-8) || '?'}）→ ${queued ? '已入队' : (noticeRelay.enabled('approval', session?.id) ? '重复/已在队列' : '被开关挡掉')}`)
    } catch (error) {
      log.debug?.('审批通知失败：', error.message)
    }
  }

  // 她要向人提问时从会话事件里认（tool/call）：user-questions/request 是 agent-scoped
  // waterfall，插件挂在根 scope 上收不到；而工具调用事件是全局的，能拿到完整问题。
  function noticeQuestion(session, event) {
    try {
      const d = event?.data || {}
      const sid = String(session?.id || '')
      if (!sid) return
      if (event.type === 'tool/call' && d.name === 'ask_user_question') {
        const callId = String(d.callId || '')
        if (!callId) return
        let qs = []
        try { qs = JSON.parse(String(d.arguments || '{}')).questions || [] } catch (error) {}
        if (!Array.isArray(qs) || !qs.length) return
        let title = ''
        try { title = String(session?.title || '').trim() } catch (error) {}
        // 会话事件里的 session 常常没带标题：用 id 后 8 位兜底，不然模型分不清是哪两个会话
        if (!title) title = sid.slice(-8)
        const id = `q:${sid}:${callId}`
        const queued = noticeRelay?.announce('question', { id, sessionId: sid, title, questions: qs })
        log.info(`提问上报：${qs.length} 个问题（${title}）→ ${queued ? '已入队' : (noticeRelay?.enabled('question', sid) ? '重复/已在队列' : '被开关挡掉')}`)
      } else if (event.type === 'tool/result') {
        // 问题答完 / 超时跳过：把还没推出去的那条撤掉。
        // 两处旧写法都取不到 id，导致这条取消路径从来没跑过（30 秒内答完照样推过期提醒）：
        //   1. 函数开头要求 d.callId，但 tool/result 的 data 只有 turn/step/message/meta；
        //   2. 这里读 d.toolCallId，实际字段在 d.message.toolCallId（本机 1369 条实测）。
        const tcid = String(d.message?.toolCallId || d.toolCallId || '')
        if (tcid) noticeRelay?.cancel(`q:${sid}:${tcid}`)
      }
    } catch (error) {
      log.debug?.('提问上报失败：', error.message)
    }
  }


  // ---------- 盯会话：一轮结束就发回 QQ ----------
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        hub.onSessionEvent(session, event)
      } catch (error) {
        log.warn('会话事件处理出错：', error.message)
      }
      // 自驱审计补记「结果」（pre-execute 只拿得到意图；tool/* 事件来了就记一条 outcome，失败静默）
      try { autotelicAudit.onSessionEvent(session, event) } catch (error) { log.debug?.('自驱审计补记失败：', error.message) }
      // 桌宠的「干活状态」动画 / 结束提醒：把同一条事件顺手转给 pet 模块（模块没开就是 null，纯旁路）
      // QQ 聊天会话不转：聊天每句都有 turn/start→turn/end，桌宠会每句话弹一次「完工」气泡/动作（#184）
      try {
        if (!isChatSession(hub, session)) use('pet')?.onSessionEvent?.(session, event)
      } catch (error) { log.debug?.('桌宠状态联动出错：', error.message) }
      // 审批请求顺手通知到主人私聊（只通知，不代答）
      if (event && event.type === 'approval/asked') notifyApproval(session, event)
      // 主人已经点过了：把还在缓冲里的那条撤掉，别等人点完才提醒
      if (event && event.type === 'approval/decided') { try { noticeRelay?.cancel(String(event.data?.id || '')) } catch (error) {} }
      // 她弹选择（ask_user_question）：从工具调用事件里认，答完再撤
      if (event && (event.type === 'tool/call' || event.type === 'tool/result')) noticeQuestion(session, event)
    })
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurabot: 盯会话')

  // ---------- 启动 / 看门狗 ----------
  async function watchdog() {
    if (!cfg.enabled) {
      if (onebot.state !== 'stopped') onebot.stop()
      return
    }
    // 上次连上的不是机器人号：等主人改设置再连
    if (wrongAccount) return
    if (onebot.state === 'stopped') onebot.start()
  }
  const safe = (fn, label) => () => { Promise.resolve().then(fn).catch((error) => log.warn(`${label}出错：`, error.message)) }
  ctx.effect(() => ctx.interval(safe(watchdog, '看门狗'), 30_000), 'aurabot: 看门狗')
  const firstWatch = setTimeout(safe(watchdog, '看门狗'), 3000)
  firstWatch.unref?.()
  ctx.effect(() => () => {
    unloaded = true
    clearTimeout(firstWatch)
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null } // 云备份的每日定时也要收尾，别留悬空回调
    dangerGuard?.dispose()
    approvalRelay?.dispose()
    hub.dispose()
    closeUsage()
    bridge.dispose()
    mods.dispose()
    onebot.stop()
  }, 'aurabot: 收尾')

  // ---------- 面板接口 ----------
  async function overview() {
    let login = null
    if (onebotState === 'connected') {
      try {
        const info = await onebot.call('get_login_info', {}, { timeoutMs: 5000 })
        login = { uin: String(info?.user_id ?? ''), nickname: info?.nickname || '' }
      } catch (error) {}
    }
    const diary = use('diary')
    const memory = use('memory')
    const moodState = use('mood')?.state?.() ?? { value: 0, label: '心情模块关着', reason: '', history: [] }
    const { history: _moodHistory, ...moodSummary } = moodState
    return {
      ok: true,
      version: VERSION,
      startedAt: STARTED_AT,
      apiVersion: API_VERSION,
      config: publicConfig(cfg),
      onebot: { state: onebotState, login, endpoint: { httpUrl: endpoint().httpUrl, wsUrl: endpoint().wsUrl }, problem: onebotState === 'connected' && loginOk ? '' : await connectionProblem(), warmup: gatewayWarmSince ? { since: gatewayWarmSince, seconds: Math.max(0, Math.round((Date.now() - gatewayWarmSince) / 1000)), phase: warmupPhase.phase || '', label: warmupPhase.label || '' } : null },
      outbox: outbox.status(),
      stats: hub.stats(),
      // 模块关着时给个空壳，面板照常显示
      mood: moodSummary,
      stickers: { count: stickers.library().items.length },
      diary: diary ? { next: diary.nextTime(), last: diary.history()[0] || null } : { next: 0, last: null },
      qzoneSocial: use('qzone-social')?.state?.() ?? null,
      // P3：今日次数改读目的引擎（主动搭话已并入 purpose；speakup 策略源不再注册）
      speakUp: use('purpose')?.state?.() ?? { count: 0 },
      purpose: purposeOverview(),
      pet: petStatus(),
      memory: { lastConsolidate: memory?.lastConsolidate?.() ?? 0 },
      avatar: avatarInfo(),
      voice: { edgeInstalled: use('voice')?.edgeInstalled?.() ?? false },
      song: use('song')?.status?.() ?? null,
      sessions: hub.sessions(),
      sessionHealth: hub.sessionHealth(),
      workspaceDir: workspaceDirOf(cfg),
      workspaceReal: realWorkspace(workspaceDirOf(cfg)),
      personas: listPersonas(),
      persona: { current: cfg.persona.current, dataOwner: dataOwner(cfg), claimPending: claimPending(cfg) },
      modules: mods.status(),
      bridge: { dshTools: cfg.bridge.dshTools, http: cfg.bridge.http, hasToken: Boolean(cfg.bridge.token), tools: bridge.deniedTools(), toolsService: Boolean(ctx.get?.('tools')) },
    }
  }

  // ---------- 面板：目的机制 / 桌宠 聚合 ----------
  // 面板令牌脱敏：任何 32 位以上的十六进制串（pet host-token、bridge token 等）只留尾 4 位。
  const HEX_RE = /[0-9a-f]{32,}/gi
  function redactTokens(value) {
    const walk = (v) => typeof v === 'string' ? v.replace(HEX_RE, (m) => '（已脱敏…' + m.slice(-4) + '）')
      : Array.isArray(v) ? v.map(walk)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => /token|secret/i.test(k) && typeof x === 'string' && x ? [k, '（已脱敏…' + String(x).slice(-4) + '）'] : [k, walk(x)]))
      : v
    return walk(value)
  }
  // 「目的引擎」聚合：purpose 是默认关的独立内置模块，没开时 available=false，面板显示引导文案，不报错。
  // 安静时段真相 = speakUp 醒着窗口（与 purpose/module.js 的 purposeConfig 派生保持一致）。
  function purposeOverview() {
    const pu = use('purpose')
    const ext: Record<string, any> = (cfg.ext && cfg.ext.purpose) || {}
    const sp: Record<string, any> = cfg.speakUp || {}
    // P3：醒着窗口的读法与 purposeConfig 对齐（ext.purpose 覆写位优先、speakUp 兜底），
    // 键仍冻结在 speakUp.awake*（Q3 拍板），只是概览展示别再绕过覆写位。
    const awakeFrom = Number.isFinite(ext.awakeFrom) ? ext.awakeFrom : (Number.isFinite(sp.awakeFrom) ? sp.awakeFrom : 8)
    const awakeTo = Number.isFinite(ext.awakeTo) ? ext.awakeTo : (Number.isFinite(sp.awakeTo) ? sp.awakeTo : 23)
    const quiet = quietWindowOf(awakeFrom, awakeTo)
    return {
      available: typeof pu?.status === 'function',
      enabled: ext.enabled !== false, // P1/Q1 默认开：键缺省=开，显式 false 才算关（与 purposeConfig 同口径）
      status: pu?.status?.() ?? null,
      count: pu?.state?.().count ?? 0,
      carrier: ext.carrier === 'pet' ? 'pet' : 'qq',
      petFallbackToQQ: ext.petFallbackToQQ !== false,
      pacing: ['conservative', 'default', 'active'].includes(ext.pacing) ? ext.pacing : 'default',
      scoringModel: ext.scoringModel && ext.scoringModel.provider && ext.scoringModel.model
        ? { provider: ext.scoringModel.provider, model: ext.scoringModel.model, reasoningEffort: ext.scoringModel.reasoningEffort || '' }
        : null,
      quietStart: quiet.quietStart,
      quietEnd: quiet.quietEnd,
      dailyMax: Number.isFinite(ext.maxPerDay) ? ext.maxPerDay : (Number.isFinite(sp.maxPerDay) ? sp.maxPerDay : null),
      awakeFrom,
      awakeTo,
    }
  }
  const petStatus = () => redactTokens(use('pet')?.status?.() ?? null)

  route('/state', async () => overview())
  // token 用量与花费：今日 / 昨日 / 近 7 天 / 近 30 天，各带模块明细
  // ?range=today|yesterday|7|30|all —— 面板点哪张指标卡就按哪个区间出明细
  const getUsageFx = createUsageFx()
  route('/usage', async (req) => ({ ok: true, fx: await getUsageFx(query(req).fx === 'refresh'), ...usageReport({ range: query(req).range || '7' }) }))

  // JSON Pointer（RFC 6901）小工具：保存回执按 /voice/enabled 这类路径逐字段确认（方案 §2.2）。
  const pointerGet = (obj, pointer) => String(pointer || '').split('/').slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
  // 面板提交体 → 提交字段路径：对象逐层展开；数组按整字段确认（不拆下标）；空对象也算整字段。
  const pointerPaths = (v, prefix = '') => {
    if (prefix && (Array.isArray(v) || v === null || typeof v !== 'object')) return [prefix]
    if (!v || typeof v !== 'object' || Array.isArray(v)) return prefix ? [prefix] : []
    const keys = Object.keys(v)
    if (!keys.length) return prefix ? [prefix] : []
    return keys.flatMap((k) => pointerPaths(v[k], prefix + '/' + k.replace(/~/g, '~0').replace(/\//g, '~1')))
  }
  // 校验失败的回执：没有发生任何提交，committed/unchanged 都是空、版本取当前值（原返回形状不变，只多字段）。
  const saveEnvelope = (body) => ({ bootId, configRevision: configRevision(), committedPaths: [], unchangedPaths: [], ...body })

  route('/save', async (req) => {
    const body = await readBody(req)
    // 面板草稿可能早于 QQ 的 /quiet /chatty；拒绝覆盖期间改过的群设置。
    // 只检查新版面板显式附带的基线，旧版和模块的局部保存维持原约定。
    if (body?.memory && Object.hasOwn(body.memory, 'passiveGroups')) {
      const raw = body.memory.passiveGroups
      const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,，;；]+/).filter(Boolean) : null
      if (!ids || ids.some(id => !/^[1-9]\d{4,11}$/.test(String(id).trim()))) return saveEnvelope({
        ok: false, code: 'invalid_passive_groups', message: '旁听名单请填 5～12 位数字群号，用换行或逗号分隔，不要混入文字。本次没有保存。',
      })
    }
    for (const ids of [body?.group?.moduleOnlyGroups, ...(body?._groupSettingsBase?.groups ? [body?.allow?.groups] : [])]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => !/^[1-9]\d{4,11}$/.test(String(id))))) return saveEnvelope({
        ok: false, code: 'invalid_group_ids', message: '群号请填 5～12 位数字，不要混入文字。本次没有保存。',
      })
    }
    if (body && Object.hasOwn(body, 'memberFilter') && !validMemberFilter(body.memberFilter)) return saveEnvelope({
      ok: false, code: 'invalid_member_filter', message: '不回应名单未保存：请填有效的 QQ 号和群号（5～12 位数字），每人只添加一次，并明确选择所有群或指定群；最多 100 人、每人 100 个群。',
    })
    const expected = body?._groupSettingsBase
    if (body) delete body._groupSettingsBase
    if (expected && (
      (Object.hasOwn(expected, 'groups') && !isDeepStrictEqual(expected.groups, cfg.allow.groups)) ||
      (Object.hasOwn(expected, 'memberFilter') && !isDeepStrictEqual(expected.memberFilter, cfg.memberFilter)) ||
      (Object.hasOwn(expected, 'group') && !isDeepStrictEqual(expected.group, cfg.group)) ||
      (Object.hasOwn(expected, 'passiveGroups') && !isDeepStrictEqual(expected.passiveGroups, cfg.memory.passiveGroups))
    )) return saveEnvelope({ ok: false, code: 'group_settings_conflict', message: '群设置已在别处修改，本次没有保存。请记下要保留的改动，再点「读取最新设置」放弃草稿。' })
    const before = cfg
    // ---- 保存回执（方案 §2.2）：按提交前后（归一化后）的实际结果逐字段确认。 ----
    // 提交字段路径先收集，分类在下面 setConfig 之后做（提交前 cfg===before，分类会全落 unchanged）。
    const submittedPaths = pointerPaths(body)
    setConfig(mergeFromPanel(cfg, body))
    // committed/unchanged 分类必须在提交之后：commitConfig 返回新的归一化对象（变化时），
    // 逐字段对比 before（提交前）与 cfg（提交后）——真写了的进 committedPaths，
    // 显式提交但值相同（含 mergeFromPanel 归一化后等值）的进 unchangedPaths（草稿别一直标脏）。
    const committedPaths = []
    const unchangedPaths = []
    for (const p of submittedPaths) {
      if (isDeepStrictEqual(pointerGet(cfg, p), pointerGet(before, p))) unchangedPaths.push(p)
      else committedPaths.push(p)
    }
    // 本次请求的回执（定义在提交之后、使用之前）：
    // 版本 = 本次请求触发的全部同步提交后的最高版本；
    // 异步回执不得借用别的请求版本，所以在这里闭包当场取值。
    const saveReceipt = () => ({ bootId, configRevision: configRevision(), committedPaths, unchangedPaths })
    const changedConn = ['httpUrl', 'wsUrl', 'httpToken', 'wsToken'].some((k) => before.onebot[k] !== cfg.onebot[k])
    // 换了模型：思考强度和「能不能看图」的探测结果都得重来，不然要等 10 分钟缓存过期
    const changedModel = before.model.provider !== cfg.model.provider || before.model.model !== cfg.model.model
    if (changedModel) { clearReasoningCache(); clearVisionCache() }
    if (changedConn || before.botQQ !== cfg.botQQ) wrongAccount = ''
    if (changedConn && onebot.state !== 'stopped') onebot.restart()
    if (!before.enabled && cfg.enabled) setTimeout(safe(watchdog, '看门狗'), 100)
    if (before.enabled && !cfg.enabled) onebot.stop()
    log.info(`设置已保存｜总开关 ${cfg.enabled ? '开' : '关'}｜调试 ${cfg.debug ? '开' : '关'}`)
    await mods.sync().catch(() => {})
    // 模块启停 / 生图开关变化后工具清单可能变了：已挂载的会话重新挂一遍
    try { hub.remountAll?.('设置已保存') } catch (error) { log.debug('重挂工具失败：', error.message) }
    let debugNote = ''
    if (cfg.debug) {
      try {
        const d = await hub.ensureDebugSession()
        debugNote = d.created ? '，调试会话已建好' : ''
      } catch (error) {
        log.debug('建调试会话失败：', error.message)
      }
    }
    return { ...(await overview()), ...saveReceipt(), message: '保存好了' + debugNote }
  })

  route('/debug/session', async () => {
    try {
      return await hub.ensureDebugSession()
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  route('/debug/say', async (req) => {
    const b = await readBody(req)
    try {
      return await hub.debugSay(String(b.text || ''))
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  // S5 调试：把一段文本当作本地入站消息跑一遍管线（command → middleware → llm）。
  // 不走网关，用来在没有 QQ 连接时验证指令/中间件是否生效（和 /debug/say 一样仅本机可调）。
  route('/debug/dispatch', async (req) => {
    const b = await readBody(req)
    const text = String(b.text || '')
    if (!text.trim()) return { ok: false, message: 'text 不能为空' }
    const type = b.type === 'private' ? 'private' : 'group'
    const userId = String(b.userId || 'debug')
    const session = new Session({
      bot: onebotBot,
      type,
      channelId: type === 'private' ? userId : String(b.chatId || 'debug'),
      userId,
      userName: String(b.userName || '调试'),
      content: text,
      pipeline,
    })
    const result = await pipeline.dispatch(session)
    let value
    try {
      value = result.value === undefined ? null : JSON.parse(JSON.stringify(result.value))
    } catch {
      value = String(result.value)
    }
    return { ok: true, order: pipeline.order(), result: { handled: result.handled, by: result.by, error: result.error ?? null, value } }
  })

  // S7/S8 调试：把一条消息当作「某个适配器投进来的」跑一遍，验证非 QQ 平台的插件复用。
  // 没指定已注册的 bot 时用一个只记发送的桩，回执里能看到插件到底发出去了什么。
  route('/debug/adapter', async (req) => {
    const body = await readBody(req)
    const text = String(body.text || '')
    if (!text.trim()) return { ok: false, message: 'text 不能为空' }
    const platform = String(body.platform || 'satori')
    const sent: Array<{ method: string; target: string; content: unknown }> = []
    const stub: BotLike = {
      ...botApiStubs(`${platform}:debug`),
      id: `${platform}:debug`,
      platform,
      selfId: 'debug',
      status: 'online',
      supports: () => true,
      async sendMessage(channelId: string, content: unknown) {
        sent.push({ method: 'sendMessage', target: String(channelId), content })
        return { ok: true, message_id: `debug-${sent.length}` }
      },
      async sendPrivateMessage(userId: string, content: unknown) {
        sent.push({ method: 'sendPrivateMessage', target: String(userId), content })
        return { ok: true, message_id: `debug-${sent.length}` }
      },
    }
    const bot = adapterRegistry.get(String(body.botId || ''), platform) ?? stub
    const type = body.type === 'channel' ? 'channel' : body.type === 'private' ? 'private' : 'group'
    const userId = String(body.userId || 'debug-user')
    const result = await dispatchInbound(bot, {
      type,
      channelId: String(body.channelId || (type === 'private' ? userId : 'debug-channel')),
      userId,
      userName: String(body.userName || '调试用户'),
      content: text,
    })
    return {
      ok: true,
      platform,
      order: pipeline.order(),
      bot: { id: bot.id, platform: bot.platform, registered: bot !== stub },
      sent,
      result: result
        ? { handled: result.handled, by: result.by, error: result.error ?? null }
        : { handled: false, by: null, error: null },
    }
  })

  // ---------- 面板代理：目的引擎 / 桌宠 ----------
  // 统一走 /panel/* 前缀，避免和模块自注册的 /purpose/*、/pet/* 路由撞名；模块缺新接口时降级返回 available:false。
  route('/panel/purpose/status', async () => ({
    ok: true,
    purpose: purposeOverview(),
    pet: petStatus(),
    // 「素材打分模型」下拉的选项：DSH 里现有的全部模型（provider/model/name）。
    models: (modelCache || []).map((m) => ({ provider: m.provider, model: m.model, name: m.name || m.model })),
  }))
  route('/panel/purpose/preview', async () => {
    const pu = use('purpose')
    if (typeof pu?.preview !== 'function') return { ok: false, available: false, message: '目的引擎模块没在跑，没法预览' }
    return { ok: true, result: redactTokens(await pu.preview()) }
  })
  route('/panel/purpose/run', async () => {
    const pu = use('purpose')
    if (typeof pu?.run !== 'function') return { ok: false, available: false, message: '目的引擎模块没在跑' }
    const r = await pu.run('面板')
    const msg = r && { sent: '已经去找你了', silent: '她这轮想了想，决定不说（不硬发）', muted: '主人在私聊里让她闭嘴了', disabled: '目的引擎开关是关的' }[r.outcome]
    return { ok: !r || r.outcome !== 'disabled', message: msg || (r ? `这轮结束：${r.outcome}` : '没有结果'), result: redactTokens(r) }
  })
  // 上报开关：按工作区分别控制「审批」「提问」要不要发到 QQ
  route('/notice/state', async () => {
    const c = loadConfig()
    const n: Record<string, any> = c.notice || {}
    const workspaces = workspaceList().map((w) => {
      const path = String(w?.path || '')
      const key = normalizeWorkspace(path)
      const o = n.workspaces?.[key] || {}
      return {
        path,
        name: String(w?.name || path.split(/[\\/]/).filter(Boolean).pop() || path),
        sessions: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
        approval: typeof o.approval === 'boolean' ? o.approval : n.approval !== false,
        question: typeof o.question === 'boolean' ? o.question : n.question !== false,
      }
    })
    return { ok: true, enabled: n.enabled !== false, approval: n.approval !== false, question: n.question !== false, workspaces }
  })
  route('/notice/toggle', async (req) => {
    const b = await readBody(req)
    const kind = b.kind === 'question' ? 'question' : 'approval'
    const value = b.value !== false
    const c = loadConfig()
    const notice = { ...(c.notice || {}) }
    notice.workspaces = { ...(notice.workspaces || {}) }
    const ws = String(b.workspace || '').trim()
    if (ws) {
      // 只接受绝对路径：相对路径（../x、foo/bar）写进配置只会变成永远对不上的键
      if (!/^([a-zA-Z]:[\\/]|\/)/.test(ws)) return { ok: false, message: 'workspace 必须是绝对路径' }
      const key = normalizeWorkspace(ws)
      notice.workspaces[key] = { ...(notice.workspaces[key] || {}), [kind]: value }
    } else {
      notice[kind] = value
    }
    // 带上整份配置：保存时只和默认值合并，只传 notice 会把其他设置全重置
    setConfig({ ...cfg, notice })
    return { ok: true, notice }
  })
  route('/panel/purpose/config', async (req) => {
    const b = await readBody(req)
    const patch: Record<string, any> = {}
    const extPatch: Record<string, any> = {}
    if (typeof b.enabled === 'boolean') extPatch.enabled = b.enabled
    // 追问开关（P1 翻键）：写入口从 speakUp.nudge 翻到 ext.purpose.nudge（读侧 purposeConfig 双层兼容）。
    if (typeof b.nudge === 'boolean') extPatch.nudge = b.nudge
    if (b.carrier === 'qq' || b.carrier === 'pet') extPatch.carrier = b.carrier
    if (typeof b.petFallbackToQQ === 'boolean') extPatch.petFallbackToQQ = b.petFallbackToQQ
    if (['conservative', 'default', 'active'].includes(b.pacing)) extPatch.pacing = b.pacing
    // 素材打分模型：与「按聊天选模型」同款结构校验（provider+model 都有才算数；传空对象/坏值 = 清除）
    if (b.scoringModel !== undefined) extPatch.scoringModel = normalizeSelection(b.scoringModel) || {}
    if (Object.keys(extPatch).length) patch.ext = { purpose: extPatch }
    const spPatch: Record<string, any> = {}
    for (const k of ['awakeFrom', 'awakeTo', 'maxPerDay']) if (Number.isFinite(b[k])) spPatch[k] = Math.max(0, Math.floor(b[k]))
    if (Object.keys(spPatch).length) patch.speakUp = spPatch
    if (!Object.keys(patch).length) return { ok: false, message: '没有可保存的字段' }
    setConfig(mergeFromPanel(cfg, patch))
    log.info(`面板已保存目的引擎设置｜${Object.keys(extPatch).map((k) => k + '=' + extPatch[k]).concat(Object.keys(spPatch).map((k) => k + '=' + spPatch[k])).join(' ')}`)
    return { ok: true, purpose: purposeOverview() }
  })
  route('/panel/pet/status', async () => ({ ok: true, pet: petStatus() }))
  // ---------- 面板：主动发言出站策略 ----------
  // 契约要求的两个精确路径：GET /panel/outbound-policy（读）与 POST /panel/outbound-policy（写）。
  // route 是精确路径匹配（AGENTS.md §4-4），所以读写各注册一条，不做前缀/通配。
  //
  // 读：档位、策略源四态与原因、「尚未纳管」提示、分类统计、账本概览。
  route('/panel/outbound-policy', async (req) => {
    // 带 body 的 POST 走下面的写分支；DSH 的 route 只按路径分发，这里按方法区分读写。
    if (String(req?.method || 'GET').toUpperCase() === 'POST') return saveOutboundPolicy(req)
    return outboundView()
  })
  // 写：档位（pass/gate/broker）与活跃策略源选择（auto/purpose/speakup）。
  // 注意 ：面板只暴露当前真实能力，档位切换不改写已有账本条目。
  function saveOutboundPolicy(req) {
    return readBody(req).then((b) => {
      const patch: Record<string, any> = {}
      if (['pass', 'gate', 'broker'].includes(b.tier)) patch.tier = b.tier
      // P3 存量归一化：老面板/老配置提交的 'speakup' 落盘为 'purpose'（不弹错、行为等价）
      const wantActive = b.activePolicy === 'speakup' ? 'purpose' : b.activePolicy
      if (['auto', 'purpose'].includes(wantActive)) patch.activePolicy = wantActive
      if (!Object.keys(patch).length) return { ok: false, message: '没有可保存的字段（tier 只认 pass/gate/broker，activePolicy 只认 auto/purpose）', outbound: outboundView().outbound }
      const now = getConfig()
      const cur = (now.ext && now.ext.outboundPolicy) || {}
      setConfig({ ...now, ext: { ...now.ext, outboundPolicy: { ...cur, ...patch } } })
      if (patch.activePolicy) outbound?.setActivePolicy?.(patch.activePolicy)
      log.info(`面板已保存出站策略｜${Object.keys(patch).map((k) => k + '=' + patch[k]).join(' ')}`)
      return outboundView()
    })
  }
  /** 面板统一返回体：服务没装配时 outbound 为 null（面板显示「尚未纳管」引导）。 */
  function outboundView() {
    let status = null
    try { status = outbound ? outbound.status() : null } catch (error) { log.warn('出站策略读状态失败：', error && error.message) }
    return { ok: true, outbound: status, view: outboundPanelView(status) }
  }
  const { outboundPanelView } = registerOutboundPanelRoutes({ route, getConfig, log })

  route('/panel/pet/config', async (req) => {
    const b = await readBody(req)
    const patch: Record<string, any> = {}
    for (const k of ['whisperEnabled', 'whisperPauseOnPetCarrier', 'workStatusEnabled', 'workBubble', 'workNotify']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    if (b.whisperSource === 'model' || b.whisperSource === 'pool') patch.whisperSource = b.whisperSource
    for (const k of ['whisperMinMinutes', 'whisperMaxMinutes', 'whisperMaxPerDay']) {
      // 面板口径：间隔 1~9999 分钟、每日上限 0~9999 次（0 = 不发）
      if (Number.isFinite(b[k])) patch[k] = k === 'whisperMaxPerDay' ? Math.min(9999, Math.max(0, Math.floor(b[k]))) : Math.min(9999, Math.max(1, Math.floor(b[k])))
    }
    // 人物大小倍率：0.5~2.0，步进 0.05；坏值忽略（别把桌宠缩没了）
    if (Number.isFinite(b.petScale)) patch.petScale = Math.min(2, Math.max(0.5, Math.round(b.petScale * 20) / 20))
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
    if (Number.isFinite(b.petRestitution)) patch.petRestitution = Math.min(0.95, Math.max(0.3, b.petRestitution))
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
    for (const [k, max] of [['petChatHotkey', 40], ['petChatCloseKeyword', 20], ['petWeatherCity', 40]] as Array<[string, number]>) {
      const value = b[k]
      if (typeof value === 'string') patch[k] = value.trim().slice(0, max)
    }
    // 天气接口模板：只收 http/https（留空 = 用模块内置默认 wttr.in）
    if (typeof b.petWeatherUrl === 'string') {
      const u = b.petWeatherUrl.trim().slice(0, 500)
      if (!u || /^https?:\/\//i.test(u)) patch.petWeatherUrl = u
    }
    // 历史上限与保留天数：与模块 settings 的 min/max 对齐（10~2000 条；0 天 = 永久保留）
    if (Number.isFinite(b.petChatMaxEntries)) patch.petChatMaxEntries = Math.min(2000, Math.max(10, Math.round(b.petChatMaxEntries)))
    if (Number.isFinite(b.petChatRetentionDays)) patch.petChatRetentionDays = Math.min(3650, Math.max(0, Math.round(b.petChatRetentionDays)))
    // ---------- 语音对讲（pet 1.2.0 起在模块库）：独立设置键的唯一写入通道 ----------
    // 同「三处必须同步」：模块 defaults/settings 已声明这些键，这里补白名单，
    // client 桌宠页另起一张独立的「语音对讲」卡（不塞进对话框卡）。
    // toggle 模式：按一下开始听、再按一下发送，不再需要 PTT 键与静音断句秒数，
    // 因此 callPttKey / callVadSilence 不再写入（旧配置里残留的值也不再被面板改动）。
    // 口径与现有键一致：类型/枚举/协议不对的坏值忽略（不写 patch，保持原值）；
    // 数值用有限数并 clamp 到模块 settings 的 min/max；文本 trim 后按上限截断（空串合法 = 关掉/回落默认）。
    if (b.callEngine === 'native' || b.callEngine === 'sovits' || b.callEngine === 'voice') patch.callEngine = b.callEngine
    // 说话方式固定 toggle；旧值 free/ptt 也收，仅为兼容旧配置读写，面板不再暴露该控件
    if (b.callTalkMode === 'free' || b.callTalkMode === 'ptt' || b.callTalkMode === 'toggle') patch.callTalkMode = b.callTalkMode
    if (typeof b.callRvc === 'boolean') patch.callRvc = b.callRvc
    for (const [k, max] of [['callRvcVoice', 60], ['voiceHotkey', 40], ['callMicDeviceId', 200], ['callSpeakerDeviceId', 200]] as Array<[string, number]>) {
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
    if (Number.isFinite(b.callMaxChars)) patch.callMaxChars = Math.min(300, Math.max(20, Math.round(b.callMaxChars)))
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
    if (Number.isFinite(b.tokenTtlDays)) patch.tokenTtlDays = Math.min(3650, Math.max(0, Math.floor(b.tokenTtlDays)))
    // 行为大脑的模块级设置（AI 自己改不了，只有主人能改）。pet 是**内置模块**，
    // 它的 settings schema 不会渲染成表单（面板只给「用户自己复制出来的模块」生成），
    // 所以这里是这些开关唯一的写入通道——不补，关窗物理闸就永远打不开。
    for (const k of ['behaviorEnabled', 'behaviorIconMischiefEnabled', 'behaviorCloseWindowEnabled']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    for (const [k, lo, hi] of [
      ['behaviorMinMinutes', 1, 9999],        // 铁律：最短 1 分钟
      ['behaviorMaxMinutes', 1, 9999],
      ['behaviorMaxPerDay', 0, 999999],
      ['behaviorIdleCursorMinutes', 1, 240],
      ['behaviorMoodCloseWindowBelow', 0, 100],
      ['behaviorIconQuarantineDays', 1, 365],
      ['chatBehaviorCooldownMinutes', 1, 1440], // 聊天联动冷却：1 分钟起，最长一天
      ['chatBehaviorMaxPerDay', 0, 9999],       // 聊天联动每日上限：0 = 聊天时她也不动
    ]) {
      const value = Number(b[k])
      if (Number.isFinite(value)) patch[k] = Math.min(Number(hi), Math.max(Number(lo), Math.round(value)))
    }
    if (typeof b.behaviorWindowWhitelist === 'string') patch.behaviorWindowWhitelist = b.behaviorWindowWhitelist.slice(0, 2000)
    if (typeof b.behaviorDisabledActions === 'string') patch.behaviorDisabledActions = b.behaviorDisabledActions.slice(0, 500)
    // 聊天联动动作（1.2.0 起 pet 模块代码在 mods 仓；核心侧 /panel/pet/config 仍是这些键的面板写入通道）
    if (typeof b.chatBehaviorEnabled === 'boolean') patch.chatBehaviorEnabled = b.chatBehaviorEnabled
    if (typeof b.chatBehaviorWhitelist === 'string') patch.chatBehaviorWhitelist = b.chatBehaviorWhitelist.slice(0, 2000)
    if (!Object.keys(patch).length) return { ok: false, message: '没有可保存的字段' }
    setConfig(mergeFromPanel(cfg, { ext: { pet: patch } }))
    log.info(`面板已保存桌宠设置｜${Object.keys(patch).map((k) => k + '=' + String(patch[k]).slice(0, 20)).join(' ')}`)
    return { ok: true, pet: petStatus() }
  })
  // 「现在碎碎念一句」：绕过排程与开关，但仍尊重专注模式（force 只跳排程类闸门）
  route('/panel/pet/whisper', async (req) => {
    const pet = use('pet')
    if (typeof pet?.whisperNow !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，碎碎念不了' }
    const r = await pet.whisperNow({ force: true, reason: '面板' })
    const msg = r && r.ok ? `她嘟囔了一句：${r.text}` : ({ focus: '专注模式开着，先关掉再来', 'pet-offline': '桌宠没在跑，气泡发不出去', 'plugin-off': '插件总开关是关的', thinking: '上一句她还在想（工作区那条会话还没结束），等几秒再来' }[r && r.reason] || '这轮没说出来')
    return { ok: Boolean(r && r.ok), message: msg, result: redactTokens(r) }
  })
  route('/panel/pet/download', async () => {
    const pet = use('pet')
    if (typeof pet?.download !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，装不了客户端' }
    return { ok: true, result: redactTokens(await pet.download()) }
  })
  // 素材包：手动重下默认形象包（换镜像地址后用；force=true 表示已有也重下）
  route('/panel/pet/fetch-pack', async () => {
    const pet = use('pet')
    if (typeof pet?.ensureDefaultPack !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，下不了素材包' }
    return { ok: true, result: await pet.ensureDefaultPack(true), pet: petStatus() }
  })
  route('/panel/pet/focus', async (req) => {
    const enabled = Boolean((await readBody(req)).enabled)
    const pet = use('pet')
    if (typeof pet?.setFocus !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，改不了专注模式' }
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
        ok: false, available: false, remoteClient: true, needModuleUpgrade: true,
        message: '已配置对外地址（远端直连模式），但当前桌宠模块太旧、不具备「打包客户端」能力（需要 pet 1.0.10+）：请先在模块市场把桌宠更新到最新版',
      }
    }
    return {
      ok: false, available: false, remoteClient: true,
      message: '已配置对外地址（远端直连模式）：服务器上不再安装/启动 Electron。请在「桌宠」页点「下载客户端包」，在你自己的电脑上解压运行',
    }
  }
  route('/panel/pet/electron-install', async () => {
    if (publicBaseUrlOf()) return remotePetHint()
    const pet = use('pet')
    if (typeof pet?.electronInstall !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，装不了 Electron' }
    return { ok: true, result: redactTokens(await pet.electronInstall()) }
  })
  route('/panel/pet/launch', async () => {
    if (publicBaseUrlOf()) return remotePetHint()
    const pet = use('pet')
    if (typeof pet?.launch !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，启动不了桌宠' }
    return { ok: true, result: redactTokens(await Promise.resolve(pet.launch())) }
  })
  route('/panel/pet/stop', async () => {
    const pet = use('pet')
    if (typeof pet?.stop !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，停不了桌宠' }
    return { ok: true, result: redactTokens(await Promise.resolve(pet.stop())) }
  })
  // 轮换令牌（安全）：旧的立即失效，客户端必须重新下载包。跨机部署时这是唯一的应急手段
  // （令牌一旦泄露，只有换掉它才收得回口子）。
  route('/panel/pet/rotate-token', async () => {
    const pet = use('pet')
    if (typeof pet?.rotateToken !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪 / 版本太旧（需要 1.0.10+），换不了令牌' }
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
    const raw = String(b.publicBaseUrl ?? '').trim().replace(/\/+$/, '').slice(0, 300)
    if (!raw) {
      setConfig(mergeFromPanel(cfg, { ext: { pet: { publicBaseUrl: '' } } }))
      log.info('面板已清空桌宠对外地址：回到同机模式')
      return { ok: true, publicBaseUrl: '', message: '已清空：回到同机模式（host.json 恢复回环地址）' }
    }
    if (!/^https?:\/\//i.test(raw)) return { ok: false, message: '要填 http(s):// 开头的完整地址，如 https://bot.example.com' }
    // ① 安全校验（DNS 解析后逐 IP 判私网/本机）——force 也不跳过这一步的**判定**，
    //    只是把「判定为内网」从拒绝变成「confirm 后审计放行」（局域网自测的合法场景）。
    let privateHit = ''
    try {
      await assertPublicUrl(raw)
    } catch (error) {
      if (b.force !== true || b.confirm !== true) {
        return {
          ok: false, publicBaseUrl: raw, verified: false,
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
        return { ok: false, publicBaseUrl: raw, message: '跨机对外地址必须用 https：令牌与聊天内容走明文等于送人。局域网自测请直接填内网地址并走 force + confirm' }
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
          try { body = await r.json() } catch { body = null }
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
        return { ok: false, publicBaseUrl: raw, verified: false, message: `验证没过（${detail}）：确认反代已把 ${raw} 指到本插件。地址确实打不通自己的公网（如 hairpin NAT）可再点一次「跳过验证保存」` }
      }
    }
    setConfig(mergeFromPanel(cfg, { ext: { pet: { publicBaseUrl: raw } } }))
    if (privateHit) {
      // 审计：内网/本机地址被显式确认保存了，必须留痕（谁在什么时候放行了什么地址）
      log.warn(`【审计】桌宠对外地址保存了内网/本机地址｜${raw}｜原因：${privateHit}｜force+confirm 显式确认`)
      return { ok: true, publicBaseUrl: raw, verified: false, confirmedPrivate: true, message: `已保存（内网地址，未经连通性验证：${privateHit}）。仅限自测，公网部署请换 https 公网域名` }
    }
    log.info(`面板已保存桌宠对外地址｜${raw}｜验证${ok ? '通过' : '跳过'}（${detail}）`)
    return { ok: true, publicBaseUrl: raw, verified: ok, message: ok ? `验证通过（${detail}）：远端直连已开启，host.json 会写这个地址` : `已保存（验证被跳过：${detail}）` }
  })
  // 客户端包（zip）：app/ 目录 + 内嵌 host.json。面板远端模式的「下载客户端包」用；浏览器直接下载二进制，
  // 所以不能走 JSON 包装的 route()，这里单独注册精确路径并手动设 content-type/content-disposition。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREFIX + '/panel/pet/client-package',
    handler: (req, res) => answer(req, res, async () => {
      // 【安全】这一条不走 route()，必须自己过面板闸：包内嵌 host.json（含 bearer 令牌），
      // 公网上谁都能无鉴权下到就等于把桌宠令牌送出去。CSRF 闸也要过（一致性；GET 本身不受影响）。
      // 复审 3·P1-1：还必须过 Host 校验——此前手动注册路由漏了 adminHostBlocked，
      // 实测 socket 回环 + `Host: evil.example` 的 GET 能拿到含令牌的 zip（DNS rebinding 载体）。
      if (panelBlocked(req, res)) return undefined
      if (adminHostBlocked(req, res)) return undefined
      if (csrfBlocked(req, res)) return undefined
      const pet = use('pet')
      if (typeof pet?.clientPackage !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，打不了客户端包' }
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
  }), 'aurabot: 桌宠客户端包下载')

  // ---------- 行为动作（设计稿 §8 测试通道）：面板「试一下」+ 每动作 AI 开关 + 图标隔离区 ----------
  // 全部代理到 pet 模块已暴露的函数（behaviorEmit / behaviorStatus / iconQuarantine / iconRestore）；
  // 模块没就绪或旧版本缺接口时降级 available:false，面板显示兜底文案不炸。
  route('/panel/pet/behavior/status', async () => {
    const pet = use('pet')
    if (typeof pet?.behaviorStatus !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪' }
    return { ok: true, behavior: redactTokens(pet.behaviorStatus()) }
  })
  // 「试一下」：手动触发默认 force=true（绕排程/专注/安静时段；桌宠离线时回执会显示 refused/failed）
  route('/panel/pet/behavior', async (req) => {
    const b = await readBody(req)
    const pet = use('pet')
    if (typeof pet?.behaviorEmit !== 'function') return { ok: false, available: false, message: '桌宠模块还没就绪，试不了' }
    const r = await pet.behaviorEmit({ action: b.action, params: b.params, say: b.say, force: b.force !== false, reason: 'panel' })
    const why = {
      'unknown-action': '没有这个动作',
      'emit-failed': '下发失败（看日志）',
      // 关窗物理闸：说清去哪里开，否则面板上只看到「这轮没演成」
      'close-window-disabled': '先在「行为与安全」卡里打开「允许 AI 关闭窗口」（物理闸，手动「试一下」也绕不过）',
      'empty-text': '「说话」动作要给一句台词再试',
    }
    return {
      ok: Boolean(r && r.ok),
      reason: (r && r.reason) || '',
      message: r && r.ok
        ? `已下发「${r.action}」${r.say ? `：${r.say}` : ''}，桌宠在跑就会演`
        : (why[r?.reason] || '这轮没演成'),
      result: redactTokens(r),
    }
  })
  // 每动作「进不进 AI 动作表」：写 ext.pet.behaviorDisabledActions（逗号分隔），与模块 settings 单一真相
  route('/panel/pet/behavior/actions', async (req) => {
    const b = await readBody(req)
    const action = String(b.action || '').trim().slice(0, 40)
    if (!action) return { ok: false, message: '缺动作名' }
    // 动作名白名单（来自模块的全表）：防止手滑/旧面板把垃圾动作名写进配置
    try {
      const st = use('pet')?.behaviorStatus?.()
      const known = new Set([...(st?.openActions || []), ...(st?.deferredActions || [])])
      if (known.size && !known.has(action)) return { ok: false, message: '没有这个动作：' + action }
    } catch (error) { /* 模块没就绪就不校验，别把开关卡死 */ }
    const cur = new Set(String(getConfig().ext?.pet?.behaviorDisabledActions || '').split(',').map((x) => x.trim()).filter(Boolean))
    if (b.on === false) cur.add(action); else cur.delete(action)
    setConfig(mergeFromPanel(cfg, { ext: { pet: { behaviorDisabledActions: [...cur].join(',') } } }))
    log.info(`面板已改 AI 动作表｜${action} → ${b.on === false ? '禁用' : '启用'}`)
    return { ok: true, disabledActions: [...cur] }
  })
  // 图标隔离区清单：{items:[{id,name,originalPath,at,reason}]}
  route('/panel/pet/behavior/quarantine', async () => {
    const pet = use('pet')
    if (typeof pet?.iconQuarantine !== 'function') return { ok: false, available: false, message: '图标隔离区接口还没就绪' }
    try { return { ok: true, items: pet.iconQuarantine() || [] } } catch (error) { return { ok: false, available: false, message: '隔离区清单读不了：' + String(error?.message || error) } }
  })
  // 「放回去」：rename 回原路径（原位置被占则改名），失败按原因给人话，别让面板只挂一句「没放回去」
  route('/panel/pet/behavior/restore', async (req) => {
    const b = await readBody(req)
    const pet = use('pet')
    if (typeof pet?.iconRestore !== 'function') return { ok: false, available: false, message: '归还接口还没就绪' }
    const r = await pet.iconRestore(String(b.id || '').slice(0, 64))
    const why = { 'not-found': '隔离区里没有这条记录（可能已经放回去了）', 'quarantine-file-gone': '隔离区里的文件已经不在了，这条记录已清掉', 'restore-failed': '放回去失败（看日志）' }
    return { ok: Boolean(r && r.ok), message: r && r.ok ? `「${r.name}」放回去了` : (why[r?.reason] || '没放回去：原位置可能没了，或图标已经被移走'), result: redactTokens(r) }
  })

  // 第三批：补偿道歉（心情 +8，并标记最近一条未道歉的关窗记录；不删记录）
  route('/panel/pet/behavior/apologize', async () => {
    const pet = use('pet')
    if (typeof pet?.windowApologize !== 'function') return { ok: false, available: false, message: '道歉接口还没就绪' }
    try {
      const r = pet.windowApologize()
      return {
        ok: Boolean(r && r.ok),
        message: r && r.ok ? (r.window ? `她为「${r.window}」道了歉` : '她道了歉') : '没有需要道歉的记录',
        result: redactTokens(r),
      }
    } catch (error) { return { ok: false, message: '道歉没成功：' + String(error?.message || error) } }
  })

  route('/logs', async (req) => {
    const q = query(req)
    return { ok: true, entries: logger.recent(Number(q.limit) || 300, { level: (q.level || '') as never, area: q.area || '' }) }
  })

  route('/commands', async () => ({ ok: true, list: commandList(mods.commands()) }))
  route('/permissions/catalog', async () => ({ ok: true, list: privatePermissionCatalog(mods.commands()) }))
  route('/permissions/subject', async (req) => {
    if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) return { ok: false, message: '权限修改需要 POST JSON 请求' }
    const body = await readBody(req)
    const result = changePermissions(cfg, body || {}, mods.commands())
    if (!result.ok) return result
    setConfig(result.config)
    return { ok: true }
  })
  route('/permissions/private-batch', async (req) => {
    if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) return { ok: false, message: '私聊名单修改需要 POST JSON 请求' }
    const body = await readBody(req)
    const result: any = changePrivateWhitelist(cfg, body || {})
    if (!result.ok) return result
    if (result.config) setConfig(result.config)
    return {
      ok: true,
      changed: result.changed,
      skipped: result.skipped,
      message: `已加入私聊白名单 ${result.changed} 人，跳过 ${result.skipped} 个重复、已存在或主人号码`,
    }
  })
  route('/permissions/friends', async () => {
    try {
      const result = await onebot.call('get_friend_list', {}, { timeoutMs: 8000 })
      const friends = Array.isArray(result) ? result : (result?.friends || [])
      return { ok: true, friends: friends.map((friend) => ({ id: String(friend.user_id || ''), name: String(friend.remark || friend.nickname || '') })).filter(({ id }) => /^\d{5,12}$/.test(id)) }
    } catch (error) {
      return { ok: false, message: `读取 QQ 好友失败：${error.message || String(error)}` }
    }
  })
  // 更新：检查 GitHub 上有没有新版本；这次更新了什么
  const checkUpdate = createUpdateChecker({ pkg: PKG, log, unstable: () => getConfig().update.unstable })
  // 宿主环境（Windows/macOS/Linux + 桌面版/网页版）决定更新命令怎么写、发布页指向哪
  const updateEnv = hostEnv()
  const updatePlanOf = (result) => updatePlan({ repo: result.repo || repoOf(PKG), channel: result.channel || 'main', latest: result.latest || '', tag: result.tag || '', env: updateEnv })
  route('/update/check', async (req) => {
    const r = await checkUpdate({ force: query(req).force === '1' })
    if (!r || !r.ok) return { ...r, env: updateEnv }
    const plan = updatePlanOf(r)
    return { ...r, ...plan, env: updateEnv, plan }
  })
  let applyingUpdate = false
  route('/update/apply', async () => {
    if (applyingUpdate) return { ok: false, message: '正在更新，稍等一下' }
    const repo = repoOf(PKG)
    if (!repo) return { ok: false, message: '不知道插件从哪安装的，没法自动更新' }
    const checked = await checkUpdate({ force: true })
    if (!checked || !checked.ok || !checked.tag) return { ok: false, message: checked?.message || '还没有发布过可安装的版本，等作者发 Release 后再试' }
    if (!checked.newer) return { ok: false, message: '当前没有比已安装版本更新的 Release' }
    const channel = checked.channel === 'beta' ? 'beta' : 'main'
    const plan = updatePlan({ repo, channel, latest: checked.latest, tag: checked.tag, env: updateEnv })
    // 本地 link 安装（开发模式）不能被 CLI 覆盖，否则会把链接换成仓库副本
    try {
      const pkgFile = join(process.env.DSH_PROFILE_DIR || '', 'package.json')
      const dep = JSON.parse(readFileSync(pkgFile, 'utf8'))?.dependencies?.[String(PKG.name)]
      if (dep && String(dep).startsWith('link:')) {
        return { ok: false, message: '当前是本地链接安装（开发模式），自动更新会把它换成仓库副本；请用 git 更新，或手动执行下面这条命令。', command: plan.command }
      }
    } catch (error) {}
    applyingUpdate = true
    try {
      const arg = `github:${repo}#${checked.tag}`
      const args = ['plugin', '--profile', updateEnv.profile, 'add', arg]
      const exec = updateExec(updateEnv, args)
      const r = await runUpdate(exec.cmd, exec.cmdArgs, exec.env, exec.shell)
      return { ...r, command: plan.command, env: updateEnv }
    } finally {
      applyingUpdate = false
    }
  })
  route('/changelog', async () => {
    let text = ''
    try { text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8') } catch (error) {}
    return { ok: true, version: VERSION, notes: changelogSection(text, VERSION) }
  })
  route('/workspace/move', async (req) => {
    const r = moveWorkspace(workspaceDirOf(cfg), (await readBody(req)).to)
    if (r.ok) {
      await grantOwner(r.target, log)
      log.info(r.message)
    }
    return r
  })
  /** 一键诊断：把「连不上 OneBot」卡在哪一步逐项列出来，用户发截图就能定位。 */
  route('/diagnose', async () => {
    const items = []
    const add = (id, label, ok, detail, hint = '') => items.push({ id, label, ok: Boolean(ok), detail: String(detail || ''), hint })
    add('bot-qq', '机器人 QQ', Boolean(cfg.botQQ), cfg.botQQ || '还没填', '在「连接」页填机器人号')
    const ep = endpoint()
    const hasOneBot = Boolean(ep.wsUrl)
    add('onebot-config', 'OneBot 地址', hasOneBot, `WS ${ep.wsUrl || '—'} / HTTP ${ep.httpUrl || '—'}`, '在「连接」页填 OneBot v11 正向 WebSocket 地址（收消息靠它；HTTP 可选）')
    for (const [kind, url, label] of [['http', ep.httpUrl, 'OneBot HTTP'], ['ws', ep.wsUrl, 'OneBot WebSocket']]) {
      if (!url) continue
      let port = 0
      try { port = Number(new URL(url).port || 80) } catch (error) {}
      if (!port) continue
      const open = await tcpOpen(port)
      add(`${kind}-port`, `${label} 端口 ${port}`, open, open ? '端口正在监听' : '端口没有监听', '确认你的 OneBot 服务（NapCat / LLOneBot / Lagrange 等）已启动并监听该端口')
    }
    const connected = onebotState === 'connected'
    add('gateway', '插件 ↔ OneBot 网关', connected, connected ? '已连接' : String(onebotState || '未连接'), '连不上时看上面几项，或者点「重新连接」')
    const problem = connected ? '' : await connectionProblem()
    return { ok: items.every((item) => item.ok), items, problem }
  })
  /** 连不上 OneBot 时，按顺序找卡在哪一步，给一句人话。 */
  async function connectionProblem() {
    if (!cfg.enabled) return '总开关关着（右上角），打开后才会连'
    if (!cfg.botQQ) return '还没填机器人 QQ 号'
    const ep = endpoint()
    if (!ep.wsUrl) return '还没填 OneBot 的 WebSocket 地址：在「连接」页填你的 OneBot v11 正向 WebSocket 地址（收消息要靠它；HTTP 可以不填）'
    if (wrongAccount) return `连上的是 ${wrongAccount}，不是机器人号 ${cfg.botQQ}，已经断开：让你的 OneBot 服务登录机器人号，再点「重新连接」`
    if (gatewayWarmSince && Date.now() - gatewayWarmSince < 300_000) {
      const sec = Math.max(1, Math.round((Date.now() - gatewayWarmSince) / 1000))
      const label = warmupPhase.label || '正在等 OneBot 会话'
      return `网关预热中（已等 ${sec} 秒）：${label}。OneBot 就绪后会自动连上；想看每一步点「一键诊断」`
    }
    return `连 ${ep.wsUrl || ep.httpUrl} 没连上：确认你的 OneBot 服务开着、地址和 token 填对了（Docker 里的话，地址要用 DSH 能访问到的主机名 / 端口）`
  }
  route('/onebot/reconnect', async () => {
    if (!cfg.enabled) return { ok: false, message: await connectionProblem() }
    wrongAccount = ''
    onebot.restart()
    // 等几秒看结果，别只回一句「正在重连」
    for (let i = 0; i < 16 && !(onebotState === 'connected' && loginOk); i++) await new Promise((r) => setTimeout(r, 500))
    if (onebotState === 'connected' && loginOk) return { ok: true, message: '连上了' }
    return { ok: false, message: '没连上：' + (await connectionProblem()) }
  })
  route('/onebot/test', async () => {
    try {
      const info = await onebot.call('get_login_info', {}, { timeoutMs: 8000 })
      const uin = String(info?.user_id ?? '')
      return { ok: uin === cfg.botQQ, message: uin === cfg.botQQ ? `连上了：${info.nickname}（${uin}）` : `连上的是 ${uin}，不是机器人号 ${cfg.botQQ}！`, info }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/test-send', async () => {
    if (!cfg.enabled) return { ok: false, message: '先打开总开关' }
    const r = await hub.sendText(`private:${cfg.ownerQQ}`, '【Aurabot 自测】大肥鱼到此一游～')
    return r ? { ok: true, message: '发给主人了，去 QQ 看看' } : { ok: false, message: '没发出去（看日志）' }
  })

  route('/sessions/reset', async () => {
    const n = hub.resetSessions()
    return { ok: true, message: n ? `归档了 ${n} 个会话，下一条消息起她会重新开始` : '本来就没有会话' }
  })

  // 人格：新增写操作显式限制 POST，避免 GET 绕过 CSRF 方法检查。
  const personaPost = (req, res) => {
    if (req.method === 'POST') return true
    send(res, 405, { ok: false, message: '请使用 POST' })
    return false
  }
  const savedLookId = (id) => {
    readLook(id) // 严格检查 id，不接受清洗后指向另一人格
    if (!readPersona(id)) throw new Error('请先保存人格')
    return id
  }
  route('/persona/look', async (req) => ({ ok: true, look: readLook(savedLookId(query(req).id)) }))
  route('/persona/look/image', async (req, res) => {
    const q = query(req)
    const buf = lookImage(savedLookId(q.id), q.imageId)
    if (!buf) { send(res, 404, { ok: false, message: '还没有人设图' }); return }
    res.setHeader?.('x-content-type-options', 'nosniff')
    send(res, 200, buf, lookMime(buf))
  })
  route('/persona/look/upload', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = JSON.parse((await readRaw(req, 8 * 1024 * 1024)).toString('utf8'))
    const id = savedLookId(b?.id)
    const match = typeof b.data === 'string' && b.data.match(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    if (!match || match[1].length % 4 !== 0) throw new Error('请选择有效的图片 data URL')
    return { ok: true, look: saveLookImage(id, Buffer.from(match[1], 'base64'), { imageId: b.imageId, append: b.append === true }) }
  })
  route('/persona/look/delete', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    return { ok: true, look: deleteLookImage(savedLookId(b.id), b.imageId) }
  })
  route('/persona/look/configure', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = JSON.parse((await readRaw(req, 16 * 1024)).toString('utf8'))
    return { ok: true, look: configureLookImage(savedLookId(b.id), b.imageId, { reference: b.reference, note: b.note }) }
  })
  route('/persona/look/describe', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    const id = savedLookId(b.id)
    const buffers = lookImages(id)
    if (!buffers.length) throw new Error('请先上传人设图')
    const imageHash = readLook(id).imageHash
    const text = await describeLook({ dsh: ctx, cfg: getConfig(), buffers })
    // 在途解析不覆盖换图后的状态；描述仍由面板确认保存。
    if (!readPersona(id) || readLook(id).imageHash !== imageHash) throw new Error('人设图已变化，请重新解析')
    return { ok: true, text, imageHash }
  })
  route('/personas', async () => ({ ok: true, list: listPersonas(), current: cfg.persona.current, dataOwner: dataOwner(cfg), claimPending: claimPending(cfg) }))
  route('/persona/get', async (req) => {
    const p = readPersona(query(req).id)
    return p ? { ok: true, persona: p, look: readLook(p.id) } : { ok: false, message: '没有这个人格' }
  })
  route('/persona/save', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    readLook(b.id)
    if (b.appearance !== undefined && typeof b.appearance !== 'string') throw new Error('外貌描述须为文字')
    const p = savePersona(b.id, b)
    if (b.appearance !== undefined) saveAppearance(p.id, b.appearance, b.appearanceSource)
    bridge.refresh()
    return { ok: true, persona: p, look: readLook(p.id), message: '人格已保存，下一轮起生效' }
  })
  route('/persona/delete', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (id === safeId(cfg.persona.current)) return { ok: false, message: '正在用的人格不能删' }
    deletePersona(id)
    // 连数据一起删：只删 persona-data/<id>/。根目录归数据归属人格（还没认领时大家共用），不能删。
    const dir = personaDataDir(cfg, id)
    if (b.withData && id && dir !== dataDir()) {
      use('memory')?.closePersona?.(id)
      closeMessageLogsUnder(dir)
      try { rmSync(dir, { recursive: true, force: true }) } catch (error) {
        return { ok: false, list: listPersonas(), message: '人格删掉了，但它的数据没删干净：' + error.message }
      }
    }
    return { ok: true, list: listPersonas() }
  })
  route('/persona/use', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (!readPersona(id)) return { ok: false, message: '没有这个人格' }
    // 正在回复或在忙后台的事：切过去会把旧人格的回复当成新人格的发出去
    if (id !== safeId(cfg.persona.current) && hub.busy()) return { ok: false, message: '她正在回复或在忙后台的事，等这一轮结束再切' }
    setConfig({ ...cfg, persona: { ...cfg.persona, current: id } })
    log.info(`切换人格 → ${id}`)
    return { ok: true, current: id, message: '切换好了，下一轮回复起生效' }
  })
  // 老用户升级后认领根目录的数据：只能认领一次，之后其他人格用 persona-data/<id>/ 里自己的记忆和会话
  route('/persona/data-owner', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (dataOwner(cfg)) return { ok: false, message: '根目录的数据已经认领过了' }
    if (!readPersona(id)) return { ok: false, message: '没有这个人格' }
    if (hub.busy()) return { ok: false, message: '她正在回复或在忙后台的事，等这一轮结束再认领' }
    setConfig({ ...cfg, persona: { ...cfg.persona, dataOwner: id } })
    log.info(`根目录的记忆和会话归给人格 ${id}`)
    return { ok: true, dataOwner: id, message: '认领好了，其他人格从下一轮起用自己的记忆和会话' }
  })
  // 人格页「AI 润色」：只改面板上这一节的文字，不保存；用不用由主人在面板里选
  route('/persona/polish', async (req) => {
    const b = await readBody(req)
    const title = String(b.title || '').slice(0, 30) || '开场（她是谁）'
    const text = String(b.text || '').slice(0, 4000)
    const others = (Array.isArray(b.others) ? b.others : []).map((x) => String(x).slice(0, 30)).slice(0, 20)
    const system = '你在帮人改一个 QQ 聊天角色的人设。人设按【标题】分节，你一次只改其中一节。' +
      '只输出这一节改好后的正文：不要写标题，不要加粗、不要 Markdown 标题，不要任何解释。原来是「- 」开头的条目就继续用条目，一条一行、短句。'
    const ask = [
      `角色：${String(b.name || '她').slice(0, 30)}`,
      `要改的这一节：${title}`,
      `人设里另外几节：${others.join('、') || '无'}（只是让你知道还有哪些，别把它们的内容写进这一节）`,
      text.trim()
        ? '要求：保留原来的设定和事实，不编新的身份信息；说得更具体、更像真人；删掉重复和空话；长度别超过原来的 1.5 倍。'
        : '要求：这一节还是空的，按这个角色和这一节的标题写 4 到 8 条。',
      text.trim() ? `原文：\n${text}` : '',
    ].filter(Boolean).join('\n')
    try {
      const out = String(await askModel(ctx, { cfg: getConfig(), module: 'persona', system, text: ask, maxTokens: 1500, temperature: 0.6 }) || '')
        .replace(/^```[a-z]*\n?|\n?```$/g, '').replace(new RegExp('^【' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '】\\s*'), '').trim()
      return out ? { ok: true, text: out } : { ok: false, message: '模型没给出内容，再试一次' }
    } catch (error) {
      return { ok: false, message: '润色没成功：' + error.message }
    }
  })

  // 按群头衔不理：白名单里的群（带群名）+ 这些群里现有的头衔，面板里点一个就设成要过滤的那类
  route('/groups/titles', async () => {
    const gids = (cfg.allow.groups || []).map(String)
    const groups = await Promise.all(gids.map(async (gid) => ({ groupId: gid, name: await hub.groupName(gid) })))
    if (!gids.length) return { ok: true, groups, titles: [], failed: [] }
    const { titles, failed } = await hub.titleFilter.titlesIn(gids)
    hub.titleFilter.clear()
    return { ok: true, groups, titles, failed, message: failed.length ? `有 ${failed.length} 个群的成员没拉到（她在群里吗？）` : '' }
  })

  // 本地接口
  const openFolder = (dir) => {
    mkdirSync(dir, { recursive: true })
    const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    // 子进程起不来是以 error 事件抛的，没人听就是未捕获异常，会把 DSH 整个带走（#135）
    return new Promise((resolve) => {
      const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' })
      child.once('error', (error) => resolve({ ok: false, message: `打不开文件夹：${dir}（${error.message}）` }))
      child.once('spawn', () => { child.unref(); resolve({ ok: true, message: '打开了' }) })
    })
  }
  // 备份：文件里有账号凭证，只存在本机文件夹，不提供网页下载（backupJob 声明在文件顶部，云备份的定时器要提前用到）
  const backupAction = (run) => async (req) => {
    if (req.method !== 'POST' || req.headers?.['x-aurabot-backup'] !== '1') return { ok: false, message: '请从面板发起操作' }
    return run(req)
  }
  route('/backup/state', async () => ({ ok: true, job: backupJob, list: listBackups(), pending: pendingRestore(), modules: pendingModules(), dir: dataDir('backups') }))
  route('/backup/create', backupAction(async () => {
    if (backupJob?.running) return { ok: false, message: '上一个备份还在打包' }
    backupJob = { running: true, done: 0, total: 0 }
    createBackup({ version: VERSION, workspaceDir: workspaceDirOf(getConfig()), onProgress: (p) => { backupJob = { ...backupJob, ...p } } })
      .then((result) => { backupJob = { running: false, result }; log.info(`备份完成：${result.name}，${result.files} 个文件`) })
      .catch((error) => { backupJob = { running: false, error: error.message }; log.error('备份失败：', error.message) })
    return { ok: true, message: '开始打包了' }
  }))
  route('/backup/open', backupAction(async () => openFolder(dataDir('backups'))))
  route('/backup/upload', backupAction(async (req) => {
    const buf = await readRaw(req, 2 * 1024 * 1024 * 1024 - 1)
    if (!buf.length) return { ok: false, message: '文件是空的' }
    try { return await stageReceivedBackup(buf) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/restore-path', backupAction(async (req) => {
    const path = String((await readBody(req)).path || '').trim().replace(/^"|"$/g, '')
    if (!path) return { ok: false, message: '填备份文件的完整路径' }
    try { return await stageRestore(path) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/cancel', backupAction(async () => {
    try { cancelRestore(); return { ok: true, message: '取消了' } } catch (error) { return { ok: false, message: error.message } }
  }))
  // ---------- 云备份：每天到点自动打包，并把最新备份推到 Gitee 私有仓库（走本机 git）----------
  const alive = () => { try { return !unloaded } catch { return true } }
  const nextRemoteAt = () => {
    const r = cfg.backup?.remote
    if (!r?.enabled) return null
    const [hh, mm] = String(r.time || '03:30').split(':').map(Number)
    const next = new Date()
    next.setHours(hh, mm, 0, 0)
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  const remoteView = (r: Record<string, any> = cfg.backup?.remote || {}) => ({
    enabled: !!r.enabled,
    provider: r.provider === 'webdav' ? 'webdav' : 'gitee',
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    time: r.time,
    keep: r.keep,
    autoCreate: r.autoCreate !== false,
    forceOverwrite: !!r.forceOverwrite,
    hasToken: Boolean(r.token),
    configOnly: r.webdav?.configOnly === true,
    webdav: { url: r.webdav?.url || '', username: r.webdav?.username || '', hasPassword: Boolean(r.webdav?.password), configOnly: r.webdav?.configOnly === true },
  })
  route('/backup/remote/state', async () => ({ ok: true, remote: remoteView(), job: pushJob, nextAt: nextRemoteAt() }))
  route('/backup/remote/config', backupAction(async (req) => {
    const patch = { ...(await readBody(req)) }
    if (!patch.token) delete patch.token // 令牌留空 = 沿用旧值，别把配好的抹掉
    if (patch.webdav && !patch.webdav.password) delete patch.webdav.password // WebDAV 密码同理
    setConfig(mergeFromPanel(cfg, { backup: { remote: patch } })) // setConfig 里会重排定时器
    const r = cfg.backup.remote
    const where = r.provider === 'webdav' ? (r.webdav?.url || 'WebDAV') : `${r.owner}/${r.repo}`
    log.info(`云备份设置已更新｜${r.enabled ? `每天 ${r.time} 推 ${where}，留 ${r.keep} 份` : '关'}`)
    return { ok: true, message: '存好了', remote: remoteView() }
  }))
  const doPush = async (pack) => {
    if (pushJob?.running) return { ok: false, message: '上一次推送还没跑完' }
    if (backupJob?.running) return { ok: false, message: '正在打包，等这轮打包完再推' }
    pushJob = { running: true, pack: !!pack, at: Date.now() }
    try {
      const remote: Record<string, any> = getConfig().backup?.remote || {}
      const configOnly = remote.provider === 'webdav' && remote.webdav?.configOnly === true
      let sourceName = ''
      if (pack || configOnly) {
        const result = await createBackup({ version: VERSION, workspaceDir: workspaceDirOf(getConfig()), configOnly })
        sourceName = result.name
        log.info(`${configOnly ? '仅配置' : ''}云备份打包完成：${result.name}，${result.files} 个文件`)
      }
      const r = await pushBackup(remote, { version: VERSION, sourceName })
      pushJob = { running: false, ok: true, result: r, at: Date.now() }
      log.info(`云备份推送完成：${r.message}`)
    } catch (error) {
      pushJob = { running: false, ok: false, error: error.message, at: Date.now() }
      log.error('云备份推送失败：', error.message)
    } finally {
      scheduleRemoteBackup() // 打包+推送耗时不定，跑完重排到下一天
    }
    return { ok: true, message: '推送流程跑完了，结果看状态' }
  }
  route('/backup/push', backupAction(async () => doPush(false)))
  route('/backup/remote/list', backupAction(async () => {
    const r: any = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    try { return await listWebdavBackups(r) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/remote/restore', backupAction(async (req) => {
    const r: any = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    const name = String((await readBody(req)).name || '')
    if (!/^aurabot-(?:backup|config)-\d{8}-\d{4}\.zip$/.test(name)) return { ok: false, message: '备份文件名不对' }
    try {
      const got = await downloadWebdavBackup(r, name)
      const result = await stageReceivedBackup(got.buffer, name)
      log.info(`已从 WebDAV 拉回备份：${name}（${got.buffer.length} 字节）`)
      return result
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }))
  const scheduleRemoteBackup = () => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    const r = cfg.backup?.remote
    if (!r?.enabled || !alive()) return
    const [hh, mm] = String(r.time || '03:30').split(':').map(Number)
    const next = new Date()
    next.setHours(hh, mm, 0, 0)
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    pushTimer = setTimeout(() => { pushTimer = null; if (alive()) doPush(true) }, next.getTime() - Date.now())
    pushTimer.unref?.()
  }
  route('/local/status', async () => ({ ok: true, dir: local.dir(), list: local.status() }))
  route('/local/template', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    if (!local.pathOf || !['tts', 'image', 'song', 'asr'].includes(slot)) return { ok: false, message: '没有这一项' }
    return local.template(slot)
  })
  route('/local/open', async () => openFolder(local.dir()))
  route('/local/test', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    try {
      if (slot === 'tts') {
        const file = fileOf(await local.call('tts', { text: '你好呀，我是大肥鱼，这是本地语音测试。' }))
        if (!file || !existsSync(file)) return { ok: false, message: '脚本没返回音频文件' }
        return { ok: true, message: `念好了：${file}` }
      }
      if (slot === 'image') {
        const buf = await toImageBuffer(await local.call('image', { prompt: '一条胖乎乎的蓝色小鱼，可爱，插画', size: cfg.imageGen.size || '1024x1024' }))
        return { ok: true, message: `画好了（${Math.round(buf.length / 1024)} KB）`, image: buf.toString('base64') }
      }
      return { ok: false, message: '这一项没法单独试：翻唱换声去 QQ 里点首歌，语音识别发条语音条试试' }
    } catch (error) {
      return { ok: false, message: '出错了：' + error.message }
    }
  })

  // 「关于」页的贡献者名单：GitHub contributors（有 token 就用，1 小时缓存）；读不到就让前端回退到内置名单
  let aboutContribAt = 0
  let aboutContribValue = null
  route('/about/contributors', async () => {
    if (aboutContribValue && Date.now() - aboutContribAt < 3600_000) return { ok: true, ...aboutContribValue }
    try {
      const token = String(process.env.AURABOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim()
      const r = await fetch('https://api.github.com/repos/aureth-labs/dsh-aurabot-qq/contributors?per_page=100&anon=0', {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'aurabot-qq-panel', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const list = ((await r.json()) as any[])
        .filter((x) => x && x.login)
        .map((x) => ({ login: x.login, contributions: Number(x.contributions) || 0 }))
      aboutContribValue = { list, source: 'github', repo: 'aureth-labs/dsh-aurabot-qq', at: Date.now() }
      aboutContribAt = Date.now()
      return { ok: true, ...aboutContribValue }
    } catch (error) {
      log.debug?.('读不到贡献者名单：', error.message)
      return { ok: false, message: error.message, list: [] }
    }
  })

  // 模块（面板「扩展」页）
  route('/modules', async () => ({ ok: true, dir: mods.dir(), safeMode: cfg.safeMode, apiVersion: API_VERSION, list: mods.status(), prompt: mods.promptFor('') }))
  route('/modules/community', async (req) => {
    try { return { ok: true, ...(await community.list({ force: query(req).force === '1' })) } } catch (error) { return { ok: false, message: error.message, list: [] } }
  })
  route('/modules/tutorial', async () => {
    try { return { ok: true, text: readFileSync(join(BUILTIN_DIR, 'sdk', 'API.md'), 'utf8') } } catch (error) { return { ok: false, message: '教程文件不见了' } }
  })
  route('/modules/community/progress', async () => ({ ok: true, progress: community.progress() }))
  route('/modules/community/install', async (req) => {
    const b = await readBody(req)
    return { ...(await community.install(String(b.id || ''), { confirmReplace: b.confirmReplace === true }) as Record<string, any>), modules: mods.status() }
  })
  route('/modules/community/remove', async (req) => {
    const b = await readBody(req)
    return { ...(await community.remove(String(b.id || ''), { purge: b.purge === true }) as Record<string, any>), modules: mods.status() }
  })
  route('/modules/remove', async (req) => {
    const b = await readBody(req)
    return { ...(await mods.remove(String(b.id || ''), { purge: b.purge === true })), list: mods.status() }
  })
  // 模块市场地址：换索引源（自建索引 / 国内镜像 / 内网部署）用。留空 = 回到内置 GitHub 地址；
  // 只收 http/https，别把 file:// 之类塞进来当下载源。单一真相在 ext.market.registryUrl，
  // community.js 读取时按 config > AURABOT_REGISTRY_URL > 内置默认 的优先级解析。
  route('/panel/market/registry', async (req) => {
    if (String(req?.method || 'GET').toUpperCase() === 'POST') {
      const b = await readBody(req)
      const u = String(b.registryUrl ?? '').trim().slice(0, 1000).replace(/\/+$/, '')
      if (u && !/^https?:\/\//i.test(u)) return { ok: false, message: '要填 http(s):// 开头的完整地址，如 https://example.com/registry/index.json' }
      setConfig(mergeFromPanel(cfg, { ext: { market: { registryUrl: u } } }))
      log.info(`面板已保存模块市场地址｜${u || '（留空，回到内置 GitHub 索引）'}`)
      return { ok: true, registryUrl: community.registryUrl(), message: u ? '已换成自定义模块市场地址' : '已恢复内置 GitHub 索引地址' }
    }
    return {
      ok: true,
      registryUrl: community.registryUrl(),
      default: REGISTRY_URL,
      sources: [
        { id: 'github', label: 'GitHub 官方源', url: REGISTRY_URL, note: '默认；海外直连，国内偶尔慢' },
        { id: 'gitee', label: 'Gitee 官方镜像', url: GITEE_MIRROR, note: '国内直连更稳；每天跟 GitHub 的 registry 分支同步一次' },
        { id: 'custom', label: '自定义', url: '', note: '自建索引 / ghproxy 中转 / 内网部署' },
      ],
    }
  })
  route('/modules/reload', async (req) => {
    const id = String((await readBody(req)).id || '')
    if (!id) { await mods.sync(); return { ok: true, message: '检查过了', list: mods.status() } }
    const m = await mods.reload(id)
    return { ok: Boolean(m && !m.error), message: m?.error ? '加载失败：' + m.error : '重新加载好了', list: mods.status() }
  })
  route('/modules/create', async (req) => {
    const b = await readBody(req)
    const r = mods.create(String(b.id || '').trim(), String(b.name || '').trim())
    if (r.ok) await mods.sync()
    return { ...r, list: mods.status(), prompt: r.ok ? mods.promptFor(String(b.id).trim()) : '' }
  })
  route('/modules/prompt', async (req) => ({ ok: true, prompt: mods.promptFor(String(query(req).id || '')) }))
  route('/modules/open', async (req) => {
    const id = String(query(req).id || '')
    return openFolder(id ? join(mods.dir(), id) : mods.dir())
  })
  // 模拟测试：不用上 QQ 就能试模块。发出去的消息只截下来给面板看，不真发
  // （模块直接调 api.onebot(...) 的操作不在此列，是真的会执行的）
  const simChat = (b) => {
    const owner = b.as !== 'other'
    const userId = owner ? cfg.ownerQQ : '10001'
    const group = b.kind === 'group'
    const groupId = String(b.groupId || cfg.allow.groups[0] || '10002')
    return { owner, userId, chat: group ? { chatId: `group:${groupId}`, kind: 'group', groupId, userId } : { chatId: `private:${userId}`, kind: 'private', userId } }
  }
  // 没有文字的（语音条、表情、图片）显示发送备注，比如「[语音·edge] 早呀」
  const sentLines = (sent) => sent.map((s) => ({ chatId: s.chatId, note: s.note, text: s.message.some((seg) => seg.type === 'text') ? s.message.map((seg) => (seg.type === 'text' ? seg.data.text : seg.type === 'reply' ? '' : `[${seg.type}]`)).join('') : s.note }))
  route('/modules/simulate', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const text = String(b.text || '')
    const steps = []
    const msg = { ...chat, nickname: owner ? cfg.ownerName || '主人' : '路人', role: '', messageId: 'sim', text, mentioned: Boolean(b.mentioned), replyId: '', images: [], stickers: [], records: [], forwards: [], raw: { simulated: true } }
    const { sent } = await hub.capture(async () => {
      if (text) {
        const parsed = (owner || chat.kind === 'private') && /^\s*[/／]/.test(text) ? parseCommand(text, mods.commands()) : null
        // 内置命令表默认关（commands 模块）；插件自己注册的命令不受影响
        const cmd = parsed && (parsed.ext || use('commands')) ? parsed : null
        if (cmd && !owner && !canUseDelegatedCommand(cfg, msg, delegatedCommandKey(cmd))) {
          steps.push('这个私聊对象没有使用该命令的权限')
        } else if (cmd && cmd.ext) {
          const reply = String((await cmd.ext.run(cmd.arg, msg)) ?? '')
          steps.push(`命令 /${cmd.name}（模块「${cmd.ext.module}」）回：${reply || '（空）'}`)
          if (reply) await hub.sendText(chat.chatId, reply)
        } else if (cmd) {
          steps.push(`这是内置命令 /${cmd.name}，模拟里不执行（会真的改设置）`)
        } else if (await mods.claim('message', msg)) {
          steps.push('有模块接管了这条消息，她不会再回')
        } else {
          steps.push('没有模块接管，这条会交给她（模拟里不会真的让她想）')
        }
      }
      if (b.reply) {
        const items = await hub.deliver(chat.chatId, String(b.reply), { simulate: true })
        steps.push(items ? `她的回复经过模块改写后拆成 ${items.length} 条` : '她的回复被模块拦下了，不发')
      }
    }, { simulate: true })
    return { ok: true, steps, sent: sentLines(sent) }
  })
  route('/modules/tools', async (req) => {
    const q = query(req)
    const { owner, chat } = simChat(q)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    return { ok: true, level, list: mods.buildTools({ chat, level, sessionId: 'sim' }).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }
  })
  route('/modules/tool', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    const tool = mods.buildTools({ chat, level, sessionId: 'sim' }).find((t) => t.name === b.name)
    if (!tool) return { ok: false, message: `这个场合没有 ${b.name} 这个工具` }
    hub.simulateTurn('sim', [userId])
    const { result, sent } = await hub.capture(() => tool.execute(b.args && typeof b.args === 'object' ? b.args : {}, {}), { simulate: true })
    return { ok: true, result, sent: sentLines(sent) }
  })
  route('/modules/panel', async (req, res) => {
    const src = mods.panelSource(String(query(req).id || ''))
    if (src === null) return send(res, 404, '')
    send(res, 200, src, 'text/javascript; charset=utf-8')
  })

  // 贴表情：面板要展示「当前有哪些表情可以贴」——内置常用 + 网关系统表情目录（取不到就只用内置）
  // emoji 走 Unicode 码点，QQ 老表情走它自己那套编号，两套在 set_msg_emoji_like 里都能直接用。
  const REACT_EMOJIS = [
    { char: '👍', name: '赞', id: '128077' },
    { char: '❤️', name: '爱心', id: '10084' },
    { char: '😂', name: '笑哭', id: '128514' },
    { char: '😭', name: '大哭', id: '128557' },
    { char: '🤔', name: '思考', id: '129300' },
    { char: '😅', name: '冷汗', id: '128517' },
    { char: '😳', name: '脸红', id: '128563' },
    { char: '🥺', name: '委屈', id: '129402' },
    { char: '🎉', name: '庆祝', id: '127881' },
    { char: '🌹', name: '玫瑰', id: '127801' },
    { char: '🍬', name: '糖', id: '127852' },
    { char: '✨', name: '闪', id: '10024' },
    { char: '🔥', name: '火', id: '128293' },
    { char: '🙏', name: '拜托', id: '128591' },
  ]
  route('/panel/faces', async () => {
    // 先用内置整表（329 条）打底：网关取不到目录时，面板也不会只剩 65 个常用表情
    let byId = new Map(FACE_TABLE.map((f) => [String(f.id), f.name]))
    try {
      const r = await onebot.call('fetch_sys_faces', {}, { timeoutMs: 8000 })
      const built = buildFaceIndex(r?.packs ? r : r?.data)
      if (built.byId.size) byId = new Map([...byId, ...built.byId])
    } catch (error) {
      logger.child('faces').debug('取系统表情目录失败，只用内置的：', error.message)
    }
    const faces = [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => Number(a.id) - Number(b.id))
    return { ok: true, faces, emojis: REACT_EMOJIS }
  })

  // 联动
  route('/bridge/token', async () => ({ ok: true, token: cfg.bridge.http ? bridge.ensureToken() : '' }))
  route('/bridge/token/reset', async () => ({ ok: true, token: bridge.resetToken(), message: '换了新密钥，旧的立刻失效' }))
  route('/bridge/examples', async (req) => ({ ok: true, ...bridge.examples(String(query(req).base || 'http://127.0.0.1:端口')) }))
  // 开放接口：都要带密钥。/open/* 给外部程序（curl/脚本）用，跨机 + 自定义 Host 是正常用法，
  // 且有自己的 Bearer 鉴权——跳过管理面的 Host 允许名单（复审 2·P1-2 的豁免原则同理）。
  const open = (path, fn) => route('/open' + path, async (req) => {
    if (!bridge.authorized(req)) return { ok: false, code: 401, message: cfg.bridge.http ? '密钥不对（请求头 Authorization: Bearer 密钥）' : '开放接口没打开（面板「扩展」→ 联动）' }
    return fn(req)
  }, { skipHostCheck: true })
  open('/info', async () => bridge.ops.info())
  open('/send', async (req) => bridge.ops.send(await readBody(req)))
  open('/think', async (req) => bridge.ops.think(await readBody(req)))
  open('/call', async (req) => bridge.ops.call(await readBody(req)))
  open('/events', async (req) => bridge.ops.events(query(req)))

  // 模型：列出 DSH 里可用的模型，测一下哪个回得快
  route('/models', async (req) => {
    try {
      if (new URL(req.url, 'http://x').searchParams.get('refresh') === '1') { clearReasoningCache(); clearVisionCache() }
      return { ok: true, list: await listModels() }
    } catch (error) {
      return { ok: false, message: error.message, list: [] }
    }
  })
  route('/model/ping', async (req) => {
    const b = await readBody(req)
    const t = Date.now()
    try {
      const text = await askModel(ctx, { cfg: { model: { provider: b.provider, model: b.model } }, module: 'model-ping', system: '只回复两个字：在呢', text: '在吗', maxTokens: 800 })
      return { ok: true, ms: Date.now() - t, text: text.slice(0, 40) }
    } catch (error) {
      return { ok: false, ms: Date.now() - t, message: error.message }
    }
  })

  // 形象图
  // 头像：自定义的放在数据目录（重装插件不丢），没有就用插件自带的大肥鱼
  const AVATAR = () => dataDir('avatar.img')
  const avatarInfo = () => {
    try { return { custom: true, at: statSync(AVATAR()).mtimeMs } } catch (error) { return { custom: false, at: 0 } }
  }
  route('/avatar', async (req, res) => {
    if (existsSync(AVATAR())) {
      const buf = readFileSync(AVATAR())
      return send(res, 200, buf, mimeOf(buf))
    }
    const p = join(ROOT, 'assets', 'dafeiyu.jpg')
    if (!existsSync(p)) return send(res, 404, '')
    send(res, 200, readFileSync(p), 'image/jpeg')
  })
  route('/avatar/upload', async (req) => {
    const b = await readBody(req)
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64')
    if (!buf.length || buf.length > 5 * 1024 * 1024) return { ok: false, message: '图片太大（最多 5MB）或是空的' }
    if (!mimeOf(buf).startsWith('image/')) return { ok: false, message: '只支持 PNG、JPG、GIF、WebP 图片' }
    ensureDir(dataDir())
    writeFileSync(AVATAR(), buf)
    log.info('换了面板头像')
    return { ok: true, message: '头像换好了', avatar: avatarInfo() }
  })
  route('/avatar/reset', async () => {
    try { unlinkSync(AVATAR()) } catch (error) {}
    return { ok: true, message: '恢复成默认头像了', avatar: avatarInfo() }
  })
  route('/avatar/sync-qq', async () => {
    const buf = existsSync(AVATAR()) ? readFileSync(AVATAR()) : readFileSync(join(ROOT, 'assets', 'dafeiyu.jpg'))
    try {
      await onebot.call('set_qq_avatar', { file: 'base64://' + buf.toString('base64') })
      return { ok: true, message: '已经设成机器人号的 QQ 头像' }
    } catch (error) {
      return { ok: false, message: 'QQ 头像没换成：' + error.message }
    }
  })

  scheduleRemoteBackup() // 云备份：到点自动打包推送（配置里关着就是空操作）
  log.info(`Aurabot v${VERSION} 已加载｜总开关 ${cfg.enabled ? '开' : '关'}｜工作区 ${workspaceDirOf(cfg)}`)

  return {
    hub, onebot, getConfig, setConfig, logger, modules: mods, bridge, ready: booted,
    get stickers() { return use('stickers') },
    get qzone() { return use('diary') },
    get mood() { return use('mood') },
    get memory() { return use('memory') },
  }
}
