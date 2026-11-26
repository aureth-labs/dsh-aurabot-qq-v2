import type { ChatLogFacade, ModuleSendOptions } from '../../../types/plugin/ctx.ts'
import type { ElementSource } from '../../../types/core/element.ts'
import type { Target } from '../../../types/core/target.ts'
import { pluginSettings } from './settings.ts'
import type { ModuleRoutes, RouteOptions } from './routes.ts'
// 内核给插件包的内部句柄：归属、停止、权限都在这里收口；插件看到的是 v2 的 ctx 视图。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { API_VERSION, BUILTIN_DIR, INSTANCE_RE } from '../loader.ts'
import type { ModuleDef, ModuleRecord } from '../loader.ts'
import { deepMerge, isObj, lazyProxy } from './util.ts'
import { scopeCoreForModule } from '../governance.ts'
import { dataDir } from '../../store/index.ts'
import { defineTool } from '../../../tools/index.ts'
import { personaScope, personaNow } from '../../../persona/personas.ts'
import { PERSONA_MEMORY_MODULE } from '../privileged.ts'
import { sessionOwner } from '../../llm/session-turn.ts'
import { isOwnerOf } from '../../config/owners.ts'
import { cleanOutboundText, isSilence, stripMarkdown } from '../../../chat/reply/index.ts'
import { reallySent } from '../../message/receipt.ts'
import { fetchImage } from '../../net/index.ts'
import { imageSize, mimeOf } from '../../message/media/inspect.ts'

/** 系统回合选项。 */
export interface ThinkOptions {
  title?: string
  key?: string
  timeoutMs?: number
  noTools?: boolean
  level?: string
}

export interface ApiDeps {
  chatLog?: ChatLogFacade
  deliverModule?: (id: string, target: Target, content: ElementSource, send: () => Promise<unknown>, options?: ModuleSendOptions) => Promise<unknown>
  logger: { child(name: string): any }
  core: Record<string, any>
  getConfig: () => Record<string, any>
  isEnabled: (id: string) => boolean
  isUserOn: () => boolean
  ctx: Record<string, any>
  setConfig: (patch: Record<string, any>) => unknown
  version: string
  live: Map<string, ModuleRecord>
  routes: ModuleRoutes
  subscribe: (owner: string, event: string, listener: (...args: unknown[]) => unknown) => () => void
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
  const { logger, core, getConfig, setConfig, version, live, routes, subscribe, builtinDefs, personaMemoryRuntime, isDisposed, note, cleanup, remove, exportsOf, hasModule, routesAtRoot, emit, isEnabled, isUserOn, ctx } = deps

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
    const config = pluginSettings(def, rec.instance, () => getConfig().ext?.[id] ?? {}, message =>
      mlog.warn(`模块「${rec.key}」配置无效，沿用上次有效配置或默认值：${message}`))
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
    const api = {
      assertActive: writable('插件接口', () => {}),
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
      settings: config.settings,
      saveSettings: writable('saveSettings', patch => {
        const cfg = getConfig()
        const next = config.update(patch)
        setConfig({ ...cfg, ext: { ...cfg.ext, [id]: next } })
        return config.settings()
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
        const off = subscribe(rec.key, event, guard(`事件 ${event}`, fn))
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
      route: (path, handler, options: RouteOptions) => {
        if (!active()) return () => {}
        if (options.access != null && options.access !== 'panel') throw new Error('路由 access 只支持 panel')
        const full = '/aurabot/api' + prefix + (String(path).startsWith('/') ? path : '/' + path)
        return track(routes.register(full, rec.key, options.method, {
          handler: guard(`接口 ${path}`, handler), access: options.access ?? null,
        }))
      },
      onDispose: (fn) => track(fn),
      deliver: writable('sendTo', (target, content, transmit, options) => deps.deliverModule
        ? deps.deliverModule(id, target, content, transmit, options) : transmit()),
      isOwner: (source, platform?, botId?) => isOwnerOf(getConfig(), source, platform, botId),
      // module: id —— 这次模型调用的用量记到哪个模块名下（面板「概览」的 token 明细）
      ask: writable('ask', (opts) => core.ask(typeof opts === 'string' ? { text: opts, module: id } : { ...opts, module: id })),
      think: writable('think', (prompt, opts : ThinkOptions = {}) => core.hub.runSystemTurn(`ext-${id}`, opts.title || def.name || id, String(prompt), opts)),
      thinkCooldown: (key = '') => core.hub.systemSessionCooldown?.(`ext-${id}`, { key }) ?? null,
      chatLog: deps.chatLog,
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
