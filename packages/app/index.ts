import { createIdentityDirectory } from '../../src/core/store/identity.ts'
import { createChatEngines, createChatHub } from './runtime/chat-engine.ts'
import { useLegacyRooms } from '../../src/core/bot/room.ts'
import { createPluginJournal } from './runtime/journal.ts'
import { createOutboundRuntime } from './runtime/outbound.ts'
import { createTransport } from './runtime/transport.ts'
import { createChatGateway } from './runtime/chat-gateway.ts'
import { registerUpdateRoutes } from './panel/system/update.ts'
import { registerDiagnostics } from './panel/platform/diagnostics.ts'
import { registerBackups } from './panel/system/backups.ts'
import { registerLocalRoutes } from './panel/system/local.ts'
import { registerConnectionRoutes } from './panel/platform/connect.ts'
import { registerBootstrap } from './panel/system/bootstrap.ts'
import { registerNoticeHandling } from './panel/platform/notifications.ts'
import { registerPetControls } from './panel/pet/controls.ts'
import { registerPetBehavior } from './panel/pet/behavior.ts'
import { registerActivityRoutes } from './panel/agent/activity.ts'
import { registerOutboundPolicyRoutes } from './panel/agent/outbound.ts'
import { registerConfigRoutes } from './panel/system/config.ts'
import { registerPermissionRoutes } from './panel/system/permissions.ts'
import { registerPersonaRoutes } from './panel/agent/personas.ts'
import { registerModuleRoutes } from './panel/system/modules.ts'
import { registerContributors } from './panel/system/contributors.ts'
import { registerFaceRoutes } from './panel/platform/faces.ts'
import { registerBridgeRoutes } from './panel/platform/open-api.ts'
import { registerModelRoutes } from './panel/agent/models.ts'
import { registerAvatarRoutes } from './panel/platform/avatar.ts'
import { migrateBilibili } from './migrations/bilibili.ts'
import { migrateQzone } from './migrations/qzone.ts'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT as packageRoot } from '../../src/core/support/util/root.ts'
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { loadConfig, commitConfig, publicConfig, ownerAuthorizationRevision } from '../../src/core/config/index.ts'
import { quietWindowOf } from '../../src/core/support/time/time-window.ts'
import { createLogger } from '../../src/core/support/log/logger.ts'
import { registerSecret } from '../../src/core/support/log/redact.ts'
import { defaultOneBot, defaultOneBotId, oneBotStatus } from './onebot.ts'
import { workspaceDirOf } from '../modules/chat-bridge/qq/index.ts'
import { createPersonaMemoryRuntime } from './runtime/persona-memory.ts'
import { realWorkspace } from '../../src/core/runtime/workspace-move.ts'
import { checkAllowed } from '../../src/chat/policy/rules/access.ts'
import { createLocal } from '../../src/local/index.ts'

import { createSendEvents } from '../../src/core/bot/send-events.ts'
import { listHostModels } from '../../src/core/llm/catalog.ts'
import { defaultModel, type AskModelOptions } from '../../src/core/llm/index.ts'
import { isOwnerOf } from '../../src/core/config/owners.ts'
import { createDialogue } from '../../src/core/llm/session-turn.ts'
import { createMediaAccess } from '../../src/core/message/media/media.ts'
import { dataDir, ensureDir } from '../../src/core/store/index.ts'
import { initUsage, usageReport, closeUsage } from '../../src/core/llm/usage/usage.ts'
import { createBotsAccessor } from '../../src/core/bot/instance/registry.ts'
import { registerDebugRoutes } from './debug.ts'
import { createMutes } from '../modules/commands/dispatch.ts'
import { createGroupRoles } from '../../src/chat/policy/rules/group.ts'
import { listPersonas, readPersona, currentPersonaText, resolvePersonaId, rulesText, seedPersonas, safeId, dataOwner, claimPending, hasRootData, personaNow } from '../../src/persona/personas.ts'
import { readLook, lookReferences, appearanceBlock } from '../../src/persona/persona-look.ts'
import { createModules, API_VERSION } from '../../src/core/module/index.ts'
import { createCommunity } from '../../src/core/module/market/community.ts'
import { createApprovalRelay } from '../../src/security/approval.ts'
import { captureSystemPrompt } from '../../src/security/leak-guard.ts'
import { applyPendingRestore, pendingModules, setPendingModules } from './backup/backup.ts'
import { cleanText } from '../../src/core/support/util/text.ts'
import { createBridge } from '../../src/core/runtime/bridge.ts'
import { createDangerGuard, safeOwnedSession } from '../../src/security/danger.ts'
import { createAuditor } from '../modules/autotelic/impl/observe/audit.ts'
import { setSsrpMode } from '../../src/core/net/index.ts'
import { BUILTINS } from '../index.ts'
import { ensureDevBuild } from './support.ts'
import { createHttp } from './http.ts'


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
  migrateBilibili()
  migrateQzone()
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
  let backup: ReturnType<typeof registerBackups> | undefined
  // 主动发言出站策略服务，装配在模块之前
  // 已注册的策略源实例（name → policy），给 deliver 的 enginePolicy 解析用
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
    const reconnectQQ = before.botQQ !== cfg.botQQ || before.enabled !== cfg.enabled || !isDeepStrictEqual(before.onebot, cfg.onebot)
    secrets()
    if (bridge && (before.bridge.dshTools !== cfg.bridge.dshTools || before.persona.current !== cfg.persona.current)) bridge.refresh()
    if (mods && (JSON.stringify(before.modules) !== JSON.stringify(cfg.modules) || before.safeMode !== cfg.safeMode)) mods.sync().catch(() => {})
    mods?.emit('config', cfg, before)
    // 声明了 reloadOnConfig 的模块：设置一改就重载，apply 里的 config 才是新的。
    mods?.reloadOnConfigChange(before.ext, cfg.ext, reconnectQQ ? [defaultOneBotId] : []).catch(error => log.warn('刷新插件配置失败', error.message))
    if (JSON.stringify(before.backup?.remote) !== JSON.stringify(cfg.backup?.remote)) backup?.scheduleRemoteBackup()
    return cfg
  }
  secrets()
  seedPersonas()
  initUsage()

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
  const endpoint = () => ({ ...cfg.onebot, ...cfg.ext?.[defaultOneBotId] })
  const sendEvents = createSendEvents(
    (name, data) => mods?.claim(name, data) ?? Promise.resolve(false),
    (name, data) => mods?.emit(name, data),
  )
  const onebot = oneBotStatus({ get: name => mods?.services.get(name) })
  const primaryBot = () => botRegistry.get(defaultOneBotId, 'qq')
  let hub = null
  let dangerGuard = null // 危险命令确认（security.dangerConfirm 开着才生效）
  let approvalRelay = null // DSH 要授权时在 QQ 私聊问主人（approvalViaQQ 开着才生效）
  const directory = createIdentityDirectory(() => { ensureDir(dataDir()); return dataDir('identity.sqlite') }, getConfig)
  const gateway = createChatGateway({
    directory, ctx, logger, getConfig, personaMemoryRuntime, primaryBot,
    getHub: () => hub,
    claimReply: (chat, userId, text) => dangerGuard?.handleReply(chat, userId, text) || approvalRelay?.handleReply(chat, userId, text),
  })
  const { outbox, flushOutbox } = gateway
  const warmSince = () => onebot.warmup().since
  const warmPhase = () => onebot.warmup()
  const { botRegistry, adapterRegistry, pipeline, dispatchInbound, closeQuoteHistory } = createTransport({
    directory, getConfig, log: logger.child('adapter'),
    speak: async text => { const voice = await tts.speak(text); return typeof voice === 'string' ? voice : String(voice?.file ?? '') },
    emit: (event, payload) => mods?.emit(event, payload),
    hasListeners: event => mods?.hasListeners(event) ?? false,
    emitAsync: (event, data) => mods?.emitAsync(event, data) ?? Promise.resolve(), sendEvents,
    beforeMessage: gateway.beforeMessage, beforeEvent: gateway.beforeEvent,
    respond: session => {
      const claimed = gateway.respond(session, adapterRegistry)
      return claimed ? claimed.result : mods?.emitAsync('llm', session)
    },
  })
  ctx.effect(() => botRegistry.on('online', bot => mods?.emit('bot/online', bot)))
  ctx.effect(() => botRegistry.on('offline', (bot, reason) => mods?.emit('bot/offline', bot, reason)))
  ctx.effect(() => () => adapterRegistry.stopAll(), 'aurabot: 适配器下线')

  const groupRoles = createGroupRoles({ bot: primaryBot, getConfig, log: logger.child('chat') })
  const local = createLocal({ getConfig, log: logger })
  const mutes = createMutes()

  /**
   * DSH 里能用的所有模型：[{provider, model, name, reasoning}]。
   * reasoning 是 {efforts:[...], default} 或 null（null = 这个模型不支持思考强度，
   * 面板据此把「思考强度」置灰，免得选了之后整轮报错）。
   */
  async function listModels() {
    const catalog = mods?.services.get('llm')?.config?.model
    const out = catalog ? await catalog.list() : await listHostModels(ctx)
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
    elementFor: (it) => use('stickers')?.elementFor?.(it) ?? null,
    markUsed: (md5) => use('stickers')?.markUsed?.(md5),
    pickForReply: (t) => use('stickers')?.pickForReply?.(t) ?? null,
    collect: async (el, chatId, current) => (use('stickers')?.collect ? use('stickers').collect(el, chatId, current) : { ok: false, reason: '表情包模块关着' }),
    library: () => use('stickers')?.library?.() ?? { items: [] },
  }
  const tts = {
    speak: async (text) => {
      const v = mods?.services.get('voice')
      if (!v?.speak) throw new Error('没有插件提供 voice 服务（语音插件关着？）')
      return v.speak(text)
    },
  }

  const generate = (options: AskModelOptions): Promise<string> => mods.services.require('llm').generate(options)
  ctx.effect(() => useLegacyRooms('qq', defaultOneBotId))
  const engines = createChatEngines({
    registry: botRegistry, primaryId: defaultOneBotId, log: logger.child('chat'),
    create: (bot, primary) => createChatHub({
      bot, primary, outbox: primary ? outbox : undefined,
      local, ctx, getConfig, setConfig, logger, stickers, tts, use, mutes, listModels, personaMemoryRuntime, generate,
      modules: () => mods, models: () => modelCache, deniedTools: () => bridge?.deniedTools() || [],
    }),
  })
  hub = engines.router
  const http = createHttp({ ctx, getConfig, log, prefix: PREFIX, getMods: () => mods })
  const { send, readBody, readRaw, query, answer, route, panelBlocked, adminHostBlocked, csrfBlocked, isLoopbackAddr, panelNeedsLocal } = http
  const { outbound, wirePolicySources, deliverModule } = createOutboundRuntime({ getConfig, logger, hub, use })

  // ---------- 模块 ----------
  const core = {
    hub, primaryBot, local, groupRoles, mutes, logger, bridge: null as unknown,
    // S0：v2 发送面。ctx.bots[0] / ctx.bots('号') / ctx.bots.list()
    bots: createBotsAccessor(botRegistry),
    canReadMedia: (bot, message) => bot !== primaryBot() || checkAllowed(getConfig(), {
      kind: message.type, groupId: message.channelId, userId: message.userId,
    }).allowed,
    // S5：入站管线（ctx.middleware / ctx.command 挂在这上面）
    pipeline,
    // S8：适配器插件化。插件调 ctx.adapter(spec, config) 就能挂一个平台上来
    adapters: {
      start: (spec, config, signal?: AbortSignal, instance?: string) => adapterRegistry.start(spec, config, signal, instance),
      list: () => adapterRegistry.list(),
      connections: () => adapterRegistry.connections(),
    },
    root: ROOT,
    // 模块经 api.proactive 访问出站治理面（modules.js 里读它）
    outbound,
    ask: generate,
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
  const dialogue = createDialogue({
    isOwner: session => isOwnerOf(getConfig(), session),
    tools: where => mods.buildTools(where, true),
    generate: (prompt, turn) => generate({ ...prompt, module: 'chat-bridge', turn }),
  })
  mods = createModules({ ctx, core, deliverModule, chatLog: createPluginJournal(hub), getConfig, setConfig, logger, version: VERSION,
    builtins: [defaultOneBot(getConfig), ...BUILTINS], personaMemoryRuntime, initialServices: { dialogue, 'room-timeline': engines.timeline, 'log-stream': logger, 'local-scripts': local } })
  bridge = createBridge({ ctx, getConfig, setConfig, hub, mods, log: logger.child('bridge'), version: String(VERSION), apiVersion: API_VERSION, overview: () => overview() })
  core.bridge = bridge
  core.modules = mods
  registerConnectionRoutes({ http, mods, adapterRegistry, getConfig, setConfig, onReloadError: error => log.warn('重试平台连接失败', error.message) })
  registerBootstrap({ getConfig, onebot, warmSince, mods, coreIsReady: () => panelCoreReady, http, bootId, VERSION, areModulesReady: () => modsReady, adapterRegistry })
  // 配置已加载、上述路由已注册：之后轻量读接口直接回 200（503 只覆盖装配早期）。
  panelCoreReady = true

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
  const community = createCommunity({ mods, getConfig, setConfig, log, version: VERSION })
  mods.listen('bot/online', bot => { if (bot === primaryBot()) return flushOutbox() })
  const booted = mods.boot()
  booted.then(() => { modsReady = true /* 模块目录就绪：bootstrap 的 modulesReady 转 true */ }).catch(() => {})
  booted.then(() => injectPetPort()).catch(() => {})
  booted.then(() => { if (getConfig().debug) hub.ensureDebugSession().catch((error) => log.warn('建调试会话失败：', error.message)) }).catch(() => {})
  // 模块起来之后再把策略源接上（此时 use('speakup') / use('purpose') 才拿得到实例）
  booted.then(() => wirePolicySources()).catch((error) => logger.child('出站策略').warn('策略源接线上失败：', error && error.message))
  booted.then(async () => {
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
  const { relay: noticeRelay, workspaceList, notifyApproval, noticeQuestion } = registerNoticeHandling({ ctx, getConfig, log, hub, approvalRelay })


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

  ctx.effect(() => () => {
    unloaded = true
    backup?.dispose()
    noticeRelay.dispose()
    dangerGuard?.dispose()
    approvalRelay?.dispose()
    closeQuoteHistory()
    directory.close()
    hub.dispose()
    closeUsage()
    bridge.dispose()
    mods.dispose()
  }, 'aurabot: 收尾')

  // ---------- 面板接口 ----------
  async function overview() {
    let login = null
    if (onebot.verified) login = { uin: onebot.login.uin, nickname: onebot.login.nickname }
    const memory = use('memory')
    const moodState = use('mood')?.state?.() ?? { value: 0, label: '心情模块关着', reason: '', history: [] }
    const { history: _moodHistory, ...moodSummary } = moodState
    return {
      ok: true,
      version: VERSION,
      startedAt: STARTED_AT,
      apiVersion: API_VERSION,
      config: publicConfig(cfg, mods?.fields),
      onebot: { state: onebot.state, login, endpoint: { httpUrl: endpoint().httpUrl, wsUrl: endpoint().wsUrl }, problem: onebot.state === 'connected' && onebot.verified ? '' : await connectionProblem(), warmup: warmSince() ? { since: warmSince(), seconds: Math.max(0, Math.round((Date.now() - warmSince()) / 1000)), phase: warmPhase().phase || '', label: warmPhase().label || '' } : null },
      outbox: outbox.status(),
      stats: hub.stats(),
      // 模块关着时给个空壳，面板照常显示
      mood: moodSummary,
      stickers: { count: stickers.library().items.length },
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
  function purposeOverview(target?: import('../../src/core/pipeline/target.ts').Target) {
    const pu = use('purpose')
    const ext: Record<string, any> = (cfg.ext && cfg.ext.purpose) || {}
    const sp: Record<string, any> = cfg.speakUp || {}
    // P3：醒着窗口的读法与 purposeConfig 对齐（ext.purpose 覆写位优先、speakUp 兜底），
    // 键仍冻结在 speakUp.awake*（Q3 拍板），只是概览展示别再绕过覆写位。
    const awakeFrom = Number.isFinite(ext.awakeFrom) ? ext.awakeFrom : (Number.isFinite(sp.awakeFrom) ? sp.awakeFrom : 8)
    const awakeTo = Number.isFinite(ext.awakeTo) ? ext.awakeTo : (Number.isFinite(sp.awakeTo) ? sp.awakeTo : 23)
    const quiet = quietWindowOf(awakeFrom, awakeTo)
    const state = pu?.state?.(target)
    return {
      available: typeof pu?.status === 'function',
      enabled: ext.enabled !== false, // P1/Q1 默认开：键缺省=开，显式 false 才算关（与 purposeConfig 同口径）
      targets: pu?.targets?.() ?? [],
      status: pu?.status?.(target) ?? null,
      count: state?.count ?? 0,
      reminders: state?.reminders ?? [],
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
  route('/usage', async req => {
    const { range, from, to } = query(req)
    try { return { ok: true, ...usageReport({ range, from, to }) } }
    catch (error) { return { ok: false, message: error instanceof RangeError ? error.message : '用量暂时无法读取' } }
  })
  registerConfigRoutes({ bootId, http, getConfig, setConfig, mods, log, hub, overview })

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

  registerDebugRoutes(http, pipeline, adapterRegistry, dispatchInbound)
  registerActivityRoutes({ http, purposeOverview, petStatus, getModels: () => modelCache, use, redactTokens, workspaceList, setConfig, getConfig, mods, log })
  registerOutboundPolicyRoutes({ http, getConfig, setConfig, outbound, log })
  registerPetControls({ http, setConfig, getConfig, log, petStatus, use, redactTokens, publicBaseUrlOf, ctx, PREFIX })
  registerPetBehavior({ http, use, redactTokens, getConfig, setConfig, log })
  registerPermissionRoutes({ http, logger, mods, directory, getConfig, setConfig, bots: botRegistry, defaultBot: primaryBot })
  registerUpdateRoutes({ PKG, log, getConfig, http, ROOT, VERSION })
  const { connectionProblem } = registerDiagnostics({ http, getConfig, endpoint, onebot, primaryBot, warmSince, warmPhase, mods, hub })
  registerPersonaRoutes({ http, ctx, generate, getConfig, bridge, use, hub, setConfig, log })

  route('/permissions/groups', async () => {
    const groups = await Promise.all(cfg.allow.groups.map(async groupId => ({ groupId, name: await hub.groupName(groupId) })))
    return { ok: true, groups }
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
  backup = registerBackups({ http, VERSION, getConfig, log, openFolder, isUnloaded: () => unloaded, setConfig })
  registerLocalRoutes({ http, local, openFolder, getConfig })
  registerContributors({ http, log })
  registerModuleRoutes({ http, mods, getConfig, community, setConfig, log, openFolder, hub, use })
  registerFaceRoutes({ http, bot: primaryBot, logger })
  registerBridgeRoutes({ http, getConfig, bridge })
  registerModelRoutes({ http, listModels, generate })
  const { avatarInfo } = registerAvatarRoutes({ http, ROOT, log, bot: primaryBot })

  backup?.scheduleRemoteBackup() // 云备份：到点自动打包推送（配置里关着就是空操作）
  log.info(`Aurabot v${VERSION} 已加载｜总开关 ${cfg.enabled ? '开' : '关'}｜工作区 ${workspaceDirOf(cfg)}`)

  return {
    hub, onebot, primaryBot, getConfig, setConfig, logger, modules: mods, bridge, ready: booted,
    get stickers() { return use('stickers') },
    get mood() { return use('mood') },
    get memory() { return use('memory') },
  }
}
