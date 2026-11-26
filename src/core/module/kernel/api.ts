import { instanceSettings } from '../../config/plugin-settings.ts'
// 内核给插件包的内部句柄：归属、停止、权限都在这里收口；插件看到的是 v2 的 ctx 视图。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { API_VERSION, BUILTIN_DIR, INSTANCE_RE } from '../loader.ts'
import type { ModuleDef, ModuleRecord } from '../loader.ts'
import { deepMerge, isObj, lazyProxy } from './util.ts'
import { scopeCoreForModule, outboundLogOf, governedSend, logAsModuleSpeech } from '../governance.ts'
import { dataDir } from '../../store/index.ts'
import { defineTool } from '../../../tools/index.ts'
import { personaScope, personaNow } from '../../../persona/personas.ts'
import { PERSONA_MEMORY_MODULE } from '../../support/bridge/persona-memory-bridge.ts'
import { sessionOwner } from '../../llm/session-turn.ts'
import { isOwnerOf } from '../../config/owners.ts'
import { cleanOutboundText, isSilence, stripMarkdown } from '../../../chat/reply/index.ts'
import { reallySent } from '../../../chat/hub/context/context.ts'
import { fetchImage } from '../../net/index.ts'
import { imageSize, mimeOf } from '../../../chat/inbound/index.ts'

/** 路由选项。 */
export type RouteOptions = Partial<Record<'access', any>>
/** 系统回合选项。 */
export interface ThinkOptions {
  title?: string
  key?: string
  timeoutMs?: number
  noTools?: boolean
  level?: string
}

export interface ApiDeps {
  logger: { child(name: string): any }
  core: Record<string, any>
  getConfig: () => Record<string, any>
  isEnabled: (id: string) => boolean
  isUserOn: () => boolean
  ctx: Record<string, any>
  setConfig: (patch: Record<string, any>) => unknown
  version: string
  live: Map<string, ModuleRecord>
  routes: Map<string, { id: string; handler: (...args: any[]) => unknown; access?: string | null }>
  listeners: Map<string, Array<{ id: string; fn: (...args: any[]) => unknown }>>
  builtinDefs: Map<string, ModuleDef>
  personaMemoryRuntime?: { forModule(active: () => boolean, track: (off: () => void) => unknown): unknown } | null
  isDisposed: () => boolean
  note: (key: string, label: string, error: unknown) => void
  cleanup: (fn: () => void) => void
  remove: (list: unknown[], item: unknown) => void
  exportsOf: (id: string) => Record<string, any> | null
  hasModule: (id: string) => boolean
  routesAtRoot: (id: string) => boolean
  emit: (event: string, ...args: unknown[]) => unknown
}

export function createApi(deps: ApiDeps) {
  const { logger, core, getConfig, setConfig, version, live, routes, listeners, builtinDefs, personaMemoryRuntime, isDisposed, note, cleanup, remove, exportsOf, hasModule, routesAtRoot, emit, isEnabled, isUserOn, ctx } = deps

  function makeApi(id: string, source: string, rec: ModuleRecord) {
    const mlog = logger.child(id)
    const active = () => !isDisposed() && !rec.stopped && live.get(rec.key) === rec
    const writable = (label, fn, allowed = active) => (...args) => {
      if (!allowed()) {
        const error = new Error(`模块「${rec.key}」已停止，不能调用 ${label}`)
        mlog.warn(error.message)
        throw error
      }
      return fn(...args)
    }
    const guard = (label, fn) => (...args) => {
      if (!active()) return
      try {
        const r = fn(...args)
        if (r && typeof r.then === 'function') return r.catch((error) => { note(rec.key, label, error); throw error })
        return r
      } catch (error) {
        note(rec.key, label, error)
        throw error
      }
    }
    const track = (off) => {
      if (typeof off === 'function') {
        if (active()) rec.offs.push(off)
        else cleanup(off)
      }
      return off
    }
    // 内置模块和替换它的版本用原来的路径（内置的面板页照常能用）；新模块放在 /ext/模块id/ 下
    // 额外实例再往下一层：/ext/<id>/i/<实例名>，主实例的路径保持不变。
    const prefix = rec.instance
      ? `/ext/${id}/i/${rec.instance}`
      : (routesAtRoot(id) ? '' : `/ext/${id}`)
    const def = rec.def
    /** 这个实例自己的配置：插件基础配置（ext.<id>）+ 实例覆盖（ext.<id>.instances[n].config）。 */
    const instanceConfig = () => instanceSettings(getConfig().ext?.[id], def.settings || [], rec.instance)
    const setModuleConfig = writable('setConfig', (patch) => setConfig(typeof patch === 'function' ? patch(getConfig()) : deepMerge(getConfig(), patch)))
    // 兼容在同步收尾里恢复设置的模块；迟到的回调和旧实例不能再写。
    const setCoreConfig = writable('core.setConfig', (patch) => {
      if (!isObj(patch)) throw new TypeError('core.setConfig 需要配置对象')
      return setConfig(deepMerge(getConfig(), patch))
    }, () => active() || (rec.cleaning && !live.has(rec.key)))
    // 模块拿到的 core：hub 换成「宿主按模块身份封装」的白名单副本（三审 #177：原型链斩断，
    // 模块摸不到原始 runSubagentTurn / subagentFor）；core 本体用 Proxy 转发，
    // getPrototypeOf 也掐断，防 getPrototypeOf(api.core).hub 绕回原始入口。
    const bridgeActive = () => active() && isUserOn() && isEnabled(id)
    const personaMemoryBridge = id === PERSONA_MEMORY_MODULE && bridgeActive()
      ? personaMemoryRuntime?.forModule(bridgeActive, track)
      : undefined
    const scopedCore = scopeCoreForModule(core, id, setCoreConfig, {
      get personaMemoryBridge() {
        return bridgeActive() ? personaMemoryBridge : undefined
      },
    })
    // 出站治理的日志口（模块快捷发送层的判定/结算都往这里记；未注入服务时不会用到）
    const obLog = outboundLogOf(core)
    const api = {
      id,
      instanceId: rec.key,
      source,
      // 模块自己的文件夹（读自己带的数据文件用这个；import.meta.url 指向的是加载快照）
      dir: rec.dir || join(BUILTIN_DIR, id),
      apiVersion: API_VERSION,
      version,
      log: mlog,
      // ---- 配置 ----
      config: () => getConfig(),
      setConfig: setModuleConfig,
      settings: () => ({ ...(def.defaults || {}), ...instanceConfig() }),
      saveSettings: writable('saveSettings', (patch) => {
        const cfg = getConfig()
        if (!rec.instance) {
          setConfig({ ...cfg, ext: { ...cfg.ext, [id]: { ...(cfg.ext?.[id] || {}), ...patch } } })
          return api.settings()
        }
        // 额外实例只写自己那一份，别改到别的实例的配置
        const list = Array.isArray(cfg.ext?.[id]?.instances) ? cfg.ext[id].instances : []
        const next = list.map((item) => (String(item?.id ?? '') === rec.instance
          ? { ...item, config: { ...(item?.config || {}), ...patch } }
          : item))
        setConfig({ ...cfg, ext: { ...cfg.ext, [id]: { ...(cfg.ext?.[id] || {}), instances: next } } })
        return api.settings()
      }),
      dataDir: (...parts) => {
        const d = rec.instance
          ? dataDir('modules-data', id, 'instances', rec.instance)
          : dataDir('modules-data', id)
        mkdirSync(d, { recursive: true })
        return join(d, ...parts)
      },
      // ---- 别的模块和插件内部 ----
      use: (other) => exportsOf(other),
      lazy: (other) => lazyProxy(() => exportsOf(other)),
      has: (other) => hasModule(other),
      core: scopedCore,
      dsh: ctx,
      // ---- 往插件里加东西 ----
      tool: (builder) => { rec.tools.push(builder); return () => remove(rec.tools, builder) },
      defineTool,
      context: (fn) => { rec.contexts.push(fn); return () => remove(rec.contexts, fn) },
      rule: (fn) => { rec.rules.push(fn); return () => remove(rec.rules, fn) },
      command: (c) => {
        if (!c || !c.name || typeof c.run !== 'function') throw new Error('command 要有 name 和 run')
        const item = { ...c, module: id }
        rec.commands.push(item)
        return () => remove(rec.commands, item)
      },
      on: (event, fn) => {
        const item = { id, fn: guard(`事件 ${event}`, fn) }
        const list = listeners.get(event) || []
        list.push(item)
        listeners.set(event, list)
        const off = () => listeners.set(event, (listeners.get(event) || []).filter((x) => x !== item))
        track(off)
        return off
      },
      emit: writable('emit', (event, ...args) => emit(event, ...args)),
      // 每次触发都按当时的当前人格固定（不沿用加载时的上下文）：这一趟写的记忆、流水、会话都归这个人格
      every: (ms, fn, label = '定时任务') => {
        const t = setInterval(() => {
          // 调试模式不跑定时任务：刷 B 站、逛空间、主动搭话、整理记忆这些都别在调试里自己动
          if (!active() || getConfig().debug) return
          personaScope.run(personaNow(getConfig()), () => Promise.resolve().then(() => { if (active()) return fn() }).catch((error) => note(rec.key, label, error)))
        }, Math.max(1000, Number(ms) || 60_000))
        t.unref?.()
        return track(() => clearInterval(t))
      },
      later: (ms, fn) => {
        const t = setTimeout(() => { personaScope.run(personaNow(getConfig()), () => Promise.resolve().then(() => { if (active()) return fn() }).catch((error) => note(rec.key, '延时任务', error))) }, Math.max(0, Number(ms) || 0))
        t.unref?.()
        return track(() => clearTimeout(t))
      },
      route: (path, handler, options : RouteOptions = {}) => {
        if (!active()) return () => {}
        if (options.access != null && options.access !== 'panel') throw new Error('路由 access 只支持 panel')
        const full = '/aurabot/api' + prefix + (String(path).startsWith('/') ? path : '/' + path)
        const cur = routes.get(full)
        if (cur && cur.id !== rec.key && live.has(cur.id)) throw new Error(`接口 ${full} 已经被模块「${cur.id}」占了`)
        // 路由记注册表键：额外实例的同名接口各挂各的路径，停止时的存活判断也按实例算
        const route = { id: rec.key, handler: guard(`接口 ${path}`, handler), access: options.access || null }
        routes.set(full, route)
        return track(() => { if (routes.get(full) === route) routes.delete(full) })
      },
      onDispose: (fn) => track(fn),
      // ---- 常用操作的捷径（都是 core 里的东西包了一层）----
      // 发送类捷径先过一层出站治理（CONTRACT §5）：moduleId 由宿主绑定，模块伪造不了；
      // 拦下返回 null（旧真值语义不变），放行才真的调 hub 并由这里结算预占。
      // 未注入 core.outbound（旧环境 / 纯测试）时 admitModuleCall 直接放行，行为与改造前一致。
      // 注意 reply 不参与：那是「回某一条消息」的回合内响应，由 hub 自己的回复链路负责，
      // 不是模块自发的主对话（治理对象只有主动私聊主人）。
      send: writable('send', (chatId, text) => governedSend(core, id, { chatId: String(chatId), text: String(text ?? '') }, (extra) => core.hub.deliver(String(chatId), String(text ?? ''), extra), obLog)),
      // 第三个参数可选：`{ proactive: true, proactiveCause: 'qq_say_in_group' }` —— 声明「这条是我说的话」，
      // hub 会在目标聊天 chatlog 里补一条 bot 记录（否则模块发的消息不落档）。
      sendText: writable('sendText', (chatId, text, opts) => governedSend(core, id, { chatId: String(chatId), text: String(text ?? '') }, (extra) => core.hub.sendText(String(chatId), String(text ?? ''), undefined, undefined, undefined, logAsModuleSpeech(extra, opts, id)), obLog)),
      // 回某一条消息：群里以「引用回复」发出，私聊直接发
      reply: writable('reply', (msg, text) => core.hub.sendText(String(msg.chatId), String(text ?? ''), msg.kind === 'group' ? msg.messageId : undefined)),
      isOwner: (source, platform?, botId?) => isOwnerOf(getConfig(), source, platform, botId),
      sendImage: writable('sendImage', (chatId, src) => governedSend(core, id, { chatId: String(chatId) }, (extra) => core.hub.sendImage(String(chatId), src, undefined, undefined, extra), obLog)),
      // sendSegments(chatId, segs, note, opts)：opts 同上，供带 @ / 引用 / 图片段的发送声明留痕。
      sendSegments: writable('sendSegments', (chatId, segs, note, opts) => governedSend(core, id, { chatId: String(chatId) }, (extra) => core.hub.sendSegments(String(chatId), segs, note || `[${id}]`, logAsModuleSpeech(extra, opts, id)), obLog)),
      // 发任意文件（文档 / 压缩包 / 音频 / 视频……）：本机绝对路径，或网关能取到的网址 / base64://
      sendFile: writable('sendFile', (chatId, file, name) => governedSend(core, id, { chatId: String(chatId) }, () => core.hub.sendFile(String(chatId), file, name), obLog)),
      // 把一个音频文件当语音条发出去（不走念文字）
      sendVoiceFile: writable('sendVoiceFile', (chatId, file, note) => governedSend(core, id, { chatId: String(chatId) }, () => core.hub.sendVoiceFile(String(chatId), file, note || `[${id}] 语音`), obLog)),
      // module: id —— 这次模型调用的用量记到哪个模块名下（面板「概览」的 token 明细）
      ask: writable('ask', (opts) => core.ask(typeof opts === 'string' ? { text: opts, module: id } : { ...opts, module: id })),
      think: writable('think', (prompt, opts : ThinkOptions = {}) => core.hub.runSystemTurn(`ext-${id}`, opts.title || def.name || id, String(prompt), opts)),
      thinkCooldown: (key = '') => core.hub.systemSessionCooldown?.(`ext-${id}`, { key }) ?? null,
      chatLog: {
        read: (day) => core.hub.chatLogOf(day),
        append: (chatId, who, text, uid = '') => core.hub.logChat?.(chatId, who, text, uid),
      },
      http: core.http,
      media: {
        download: (url: string, maxBytes: number) => {
          if (!/^https?:\/\//i.test(url)) throw new Error('图片需要 HTTP 地址')
          return fetchImage(url, { maxBytes, allowLocal: false })
        },
        inspect: (bytes: Buffer) => ({ ...imageSize(bytes), mime: mimeOf(bytes) }),
      },
      turnFromOwner: (sessionId) => sessionOwner(sessionId) ?? Boolean(core.hub.turnSendersAllOwner?.(String(sessionId || ''))),
      text: {
        clean: (value, label = id) => stripMarkdown(cleanOutboundText(value, { warn: (message) => mlog.warn(`${label}：${message}`) })).trim(),
        isSilence,
        sent: reallySent,
      },
      onebot: writable('onebot', (action, params, opts) => core.onebot.call(action, params, opts)),
      // 出站治理面（主动发言策略）。
      // 宿主注入 core.outbound 才有；旧环境/纯测试下 available=false，模块据此降级，
      // 绝不因此抛错。moduleId 由宿主闭包绑定，模块无法伪造他人身份。
      proactive: {
        // 用取值器而不是一次性求值：宿主可能晚于模块加载才注入 core.outbound，
        // 写成普通属性会导致 available 永远为 false（而 submit 实际可用）。
        get available() { return Boolean(core.outbound && typeof core.outbound.submit === 'function') },
        submit: writable('proactive.submit', (input = {}) => {
          const svc = core.outbound
          if (!svc || typeof svc.submit !== 'function') return { deliveryId: null, state: 'unsupported' }
          return svc.submit({ ...(input || {}), moduleId: id })
        }),
        statusOf: writable('proactive.statusOf', (deliveryId) => {
          const svc = core.outbound
          if (!svc || typeof svc.statusOf !== 'function') return null
          return svc.statusOf(deliveryId)
        }),
      },
      dshTool: (tool) => { if (!active()) return () => {}; rec.dshTools.push(tool); core.bridge?.refresh(); return () => { remove(rec.dshTools, tool); core.bridge?.refresh() } },
    }
    return api
  }

  return makeApi
}
