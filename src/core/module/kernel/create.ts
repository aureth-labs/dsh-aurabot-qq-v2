// 模块内核：插件的功能都是模块，内置的在 packages/，自己写的放数据目录 modules/（升级不会动）。
//
// - 每个模块能单独开关；自己写的模块和内置的同名，就替换掉内置的
// - 模块之间用 api.use('模块id') 拿对方导出的东西，用的时候再拿（对方被关了、换了也不会拿到旧的）
// - 模块注册的工具、上下文、命令、定时任务、面板接口都记在模块名下，关掉 / 重新加载时一起撤掉
// - 一个模块出错只影响它自己：启动失败记下原因，其他照常跑
// - 自己写的模块保存就生效（按修改时间重新加载），不用重启 DSH
//
// 接口说明给写模块的人看：packages/sdk/API.md（每次启动复制到数据目录 modules/ 里）。

import { existsSync, readdirSync, statSync, lstatSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, renameSync, rmSync, watch } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createPluginContext } from '../context/plugin-context.ts'
import { isSchema, Schema } from '../../config/shape/schema.ts'
import { h } from '../../message/element/element.ts'
import { readManifest, entryOf as entryOfManifest } from '../manifest.ts'
import { join, dirname, relative, resolve, sep, isAbsolute } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dataDir } from '../../store/index.ts'
import { registerSecretField } from '../../config/index.ts'
import { defineTool } from '../../../tools/index.ts'
import { selfName, personaScope, personaNow } from '../../../persona/personas.ts'
import { PERSONA_MEMORY_MODULE } from '../../support/bridge/persona-memory-bridge.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type RouteOptions = Partial<Record<'access', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type ThinkOptions = Partial<Record<'title', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
interface StartOptions {
  replaces?: any
  /** 额外实例名；不写就是主实例（注册表键等于模块 id）。 */
  instance?: string
  [key: string]: any
}
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type StopOptions = Partial<Record<'quiet', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type RemoveModuleOptions = Partial<Record<'purge', any>>

export * from '../loader.ts'
import { loadLib, lib } from '../loader.ts'
export * from '../governance.ts'
import { INSTANCE_RE, STABLE_ROUTES, BUILTIN_DIR, API_VERSION, instanceKey, settingsFromMeta, schemaDefaults, stampOfTarget, SNAP, filesOf, scanUser, namedModuleDef, checkDef, SRC, sourceRootOf, userDir, ID_RE, idDir, rewriteImports } from '../loader.ts'
import type { ModuleDef, ModuleRecord, ModuleError } from '../loader.ts'
import { scopeCoreForModule, outboundLogOf, governedSend, logAsModuleSpeech } from '../governance.ts'

export * from './util.ts'
import { deepMerge, isObj } from './util.ts'
import { createApi } from './api.ts'
import { createDocs } from './docs.ts'

export function createModules({ ctx, core, getConfig, setConfig, logger, version, builtins, personaMemoryRuntime }) {
  const log = logger.child('modules')
  const builtinDefs = new Map<string, ModuleDef>((builtins as ModuleDef[]).map((d) => [d.id, d]))
  const live = new Map<string, ModuleRecord>() // id → 运行中的模块（见 start）
  const errors = new Map<string, ModuleError>() // id → { message, at }  启动失败 / 加载失败
  const routes = new Map() // 完整路径 → { id, handler }
  const pages = new Map() // 完整路径 → { id, path, name, icon, order }
  const listeners = new Map() // 事件名 → [{ id, fn }]
  const revisions = new Map() // id → 停止次数，取消在途 import
  // 模块每次（重）启动都递增一次「代际」：hub 用它判断会话里挂的工具是不是旧模块实例的闭包。
  let generation = 0
  // 导航版本：模块安装/启停/失败/重载（含可用平台随定义变化）时递增；
  // 面板首屏轮询 /panel/pulse 拿它判断要不要重新拉导航摘要（方案 §二/§2.1）。
  let navigationRevisionCounter = 0
  const bumpNavigation = () => { navigationRevisionCounter++ }
  let userSeen = new Map() // id → { dir, file, stamp }
  /** 额外实例上一次启动时的配置快照：配置一改就重启那个实例（适配器要重连）。 */
  const instanceSeen = new Map() // 注册表键 → JSON(config)
  let watching = null
  let watcher = null
  let pendingSync = null
  let disposed = false

  const modCfg = (id) => getConfig().modules?.[id] || {}
  const isEnabled = (id) => modCfg(id).enabled !== false
  const isUserOn = () => !getConfig().safeMode
  /**
   * 一份插件的额外实例（`ext.<id>.instances`）。
   *
   * 只有清单里 `reusable: true` 的插件才会被启动；配置写坏了（不是数组、没名字、名字重复）
   * 一律当没写，别让一条脏数据把整个模块拖死。
   */
  const instancesOf = (id) => {
    // 实例配置和插件设置放在一起（ext.<id>.instances），不是 modules.<id>（那个只管启停）
    const raw = getConfig().ext?.[id]?.instances
    if (!Array.isArray(raw)) return []
    const seen = new Set()
    const out = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const name = String(item.id ?? item.name ?? '').trim()
      if (!INSTANCE_RE.test(name) || seen.has(name)) continue
      seen.add(name)
      out.push({
        id: name,
        label: String(item.label ?? '').trim(),
        enabled: item.enabled !== false,
        config: item.config && typeof item.config === 'object' ? item.config : {},
      })
    }
    return out
  }
  /** 某个模块现在有没有实例在跑（主实例或任意额外实例）。 */
  const hasModule = (id) => {
    if (live.has(id)) return true
    for (const rec of live.values()) if (rec.moduleId === id) return true
    return false
  }
  // 接口挂在哪：内置模块（以及从内置搬到社区库的那几个）沿用原来的根路径，别的模块挂在自己的 /ext/<id>/ 下。
  // 面板里的 call('/x') 要用同一份判断决定基址（见 status().routesAtRoot），两边不能各算各的。
  const routesAtRoot = (id) => builtinDefs.has(id) || STABLE_ROUTES.has(id)

  const apiOf = createApi({ logger, core, getConfig, setConfig, version, lib, live, routes, listeners, builtinDefs, personaMemoryRuntime, isDisposed: () => disposed, note, cleanup, remove, exportsOf, hasModule, routesAtRoot, instancesOf, emit: (event, ...args) => emit(event, ...args), isEnabled, isUserOn, ctx })
  const makeApi = (id: string, source: string, rec: ModuleRecord) => apiOf(id, source, rec)

  /** 插件在面板侧栏注册的页面：路径唯一，模块卸载一起撤。 */
  function registerPage(rec: ModuleRecord, page: any) {
    const path = '/' + String(page?.path || '').replace(/^\/+/, '')
    if (path === '/') throw new Error('ctx.page 需要 path，例如 { path: "/sandbox", name: "聊天沙盒" }')
    const current = pages.get(path)
    if (current && current.id !== rec.key && live.has(current.id)) throw new Error(`页面 ${path} 已经被模块「${current.id}」注册`)
    const item = { id: rec.key, path, name: String(page.name || path), icon: String(page.icon || ''), order: Number(page.order) || 0 }
    pages.set(path, item)
    rec.offs.push(() => { if (pages.get(path) === item) pages.delete(path) })
    return () => { if (pages.get(path) === item) pages.delete(path) }
  }

  function remove(list, item) {
    const i = list.indexOf(item)
    if (i >= 0) list.splice(i, 1)
  }

  /** key 是注册表键（主实例 = 模块 id，额外实例 = `id@名字`）。 */
  function note(key, label, error) {
    const message = String(error && error.message ? error.message : error).slice(0, 500)
    const rec = live.get(key)
    if (rec) {
      rec.errors.unshift({ at: Date.now(), label, message })
      rec.errors.length = Math.min(rec.errors.length, 8)
    }
    log.warn(`模块「${key}」${label}出错：`, message)
  }

  /** 按模块 id 取导出：主实例优先，没有再取第一个额外实例。 */
  function exportsOf(id) {
    const primary = live.get(id)
    if (primary) return primary.exports
    for (const rec of live.values()) if (rec.moduleId === id) return rec.exports
    return null
  }

  // 卸载接口保持同步；模块自己的同步 / 异步收尾失败只记日志。
  function cleanup(fn) {
    const failed = (error) => log.warn('模块清理失败：', String(error?.message || error))
    try { Promise.resolve(fn()).catch(failed) } catch (error) { failed(error) }
  }

  // ---------- 启动 / 停止 ----------
  async function start(def, source, extra : StartOptions = {}) {
    if (disposed) return null
    const id = def.id
    const instance = String(extra.instance || '').trim()
    const key = instance ? instanceKey(id, instance) : id
    // v2：配置用 Schema 声明时，面板字段与默认值都从它派生，不再手写 settings 数组
    if (isSchema(def.config)) {
      def = { ...def, settings: def.config.toSettings(), defaults: def.config.defaults() }
    } else if (def.config && !(Array.isArray(def.settings) && def.settings.length)) {
      // 模板仓库自带的精简 Schema（plugin-api.js）：只读地翻成面板字段，不改它自己的校验逻辑
      const derived = settingsFromMeta(def.config)
      if (derived.length) def = { ...def, settings: derived }
    }
    const rec: ModuleRecord = {
      key,
      moduleId: id,
      id,
      def,
      source,
      exports: null,
      offs: [],
      tools: [],
      contexts: [],
      rules: [],
      commands: [],
      dshTools: [],
      errors: [],
      startedAt: Date.now(),
      ...extra,
      instance: instance || undefined,
    }
    // 设置里的密码字段不回传给面板
    for (const f of def.settings || []) if (f && f.type === 'password' && f.key) registerSecretField(['ext', id, f.key])
    // 设置的默认值补进配置（面板表单直接有值可改；已经填过的不动）。
    // 只有主实例落盘：额外实例的默认值由 api.settings() 在读取时合并，不往共享配置里写。
    if (!instance && def.defaults && typeof def.defaults === 'object') {
      const cur = getConfig().ext?.[id] || {}
      const missing = Object.keys(def.defaults).filter((k) => !(k in cur))
      if (missing.length) setConfig({ ...getConfig(), ext: { ...getConfig().ext, [id]: { ...Object.fromEntries(missing.map((k) => [k, def.defaults[k]])), ...cur } } })
    }
    live.set(key, rec)
    errors.delete(key)
    generation++ // 新实例：会话里的工具要在下一轮重挂（issue #73）
    try {
      const api = makeApi(id, source, rec)
      // 插件只写 apply(ctx, config)：ctx 是 v2 能力面，config 是本插件的配置。
      const ctx = createPluginContext(api, {
        bots: core.bots,
        bot: core.bot,
        Schema,
        h,
        pipeline: core.pipeline,
        llm: core.llm,
        tts: core.tts,
        startAdapter: core.adapters?.start,
        registerPage: (page) => registerPage(rec, page),
        nativePreview: id === 'memory' && personaMemoryRuntime
          ? (read) => api.onDispose(personaMemoryRuntime.registerNativePreview(read))
          : undefined,
      })
      if (typeof def.apply !== 'function') throw new Error('模块没有 apply(ctx, config)')
      // 传进去的是校验过的配置：面板存了脏数据就落到默认值，并把原因记进日志
      let passed = api.settings()
      if (isSchema(def.config)) {
        const checked = def.config.validate(passed)
        if (!checked.ok) {
          log.warn(`模块「${def.name || id}」配置不合法：${checked.error}，已按默认值启动`)
          passed = def.config.defaults()
        } else {
          passed = checked.value
        }
      } else if (def.config) {
        // 别人家的 Schema（模板仓库自带的那份）：只取默认值，面板存过的值优先
        const defaults = schemaDefaults(def.config)
        if (defaults && typeof defaults === 'object') passed = { ...defaults, ...passed }
      }
      const r = def.apply(ctx, passed)
      const exports = (r && typeof r.then === 'function' ? await r : r) ?? {}
      if (disposed || rec.stopped || live.get(key) !== rec) {
        cleanup(() => exports?.dispose?.())
        return null
      }
      rec.exports = exports
      log.info(`模块「${def.name || id}」${instance ? `实例 ${instance} ` : ''}${source !== 'user' ? '' : existsSync(join(rec.dir, '.aurabot-source.json')) ? '（模块市场）' : '（自己写的）'}已启动`)
      bumpNavigation() // 新实例进了注册表：导航摘要可能变（新增/替换）
      emit('module/start', id, key)
    } catch (error) {
      if (disposed || rec.stopped || live.get(key) !== rec) return null
      stop(key, { quiet: true })
      errors.set(key, { message: String(error && error.message ? error.message : error).slice(0, 800), at: Date.now(), source })
      bumpNavigation() // 启动失败也进导航（availability=error）
      log.warn(`模块「${def.name || id}」${instance ? `实例 ${instance} ` : ''}启动失败：`, error.message)
    }
    return live.get(key)
  }

  /** 同步启动（内置模块的 apply 都是同步的，插件一加载就要能用）。 */
  function startSync(def) {
    if (disposed) return
    const id = def.id
    const rec: ModuleRecord = { key: id, moduleId: id, id, def, source: 'builtin', exports: null, offs: [], tools: [], contexts: [], rules: [], commands: [], dshTools: [], errors: [], startedAt: Date.now() }
    live.set(id, rec)
    generation++ // 内置模块（重）启动也换代际：会话里的工具要在下一轮重挂
    if (errors.get(id)?.source !== 'user') errors.delete(id) // 替换版的报错留着给面板看
    try {
      const api = makeApi(id, 'builtin', rec)
      const ctx = createPluginContext(api, {
        bots: core.bots,
        bot: core.bot,
        Schema,
        h,
        pipeline: core.pipeline,
        llm: core.llm,
        tts: core.tts,
        startAdapter: core.adapters?.start,
        registerPage: (page) => registerPage(rec, page),
        nativePreview: id === 'memory' && personaMemoryRuntime
          ? (read) => api.onDispose(personaMemoryRuntime.registerNativePreview(read))
          : undefined,
      })
      if (typeof def.apply !== 'function') throw new Error('内置模块没有 apply(ctx, config)')
      const passed = api.settings()
      const r = def.apply(ctx, passed)
      if (r && typeof r.then === 'function') throw new Error('内置模块的 apply 要同步返回')
      rec.exports = r ?? {}
      bumpNavigation() // 内置模块（重）启动：导航摘要可能变
    } catch (error) {
      stop(id, { quiet: true })
      errors.set(id, { message: String(error.message || error).slice(0, 800), at: Date.now(), source: 'builtin' })
      bumpNavigation() // 启动失败也进导航（availability=error）
      log.error(`内置模块「${def.name || id}」启动失败：`, error.message)
    }
  }

  /** 停一个实例（key 是注册表键）。 */
  function stop(key, { quiet = false } : StopOptions = {}) {
    revisions.set(key, (revisions.get(key) || 0) + 1)
    const rec = live.get(key)
    if (!rec) return false
    live.delete(key)
    generation++ // 停止或替换也使会话工具缓存失效
    bumpNavigation() // 模块停了/被替换：导航摘要可能变
    rec.stopped = true
    rec.cleaning = true
    try {
      for (const off of rec.offs.splice(0).reverse()) cleanup(off)
      cleanup(() => rec.exports?.dispose?.())
    } finally {
      rec.cleaning = false
    }
    rec.exports = null
    // 路由和监听器由各自的 off 按实例撤销，清理期间可能已经启动了同名新实例。
    if (rec.dshTools.length) core.bridge?.refresh()
    if (!quiet) { log.info(`模块「${rec.def.name || rec.id}」${rec.instance ? `实例 ${rec.instance} ` : ''}已停下`); emit('module/stop', rec.id, key) }
    return true
  }

  /** 停掉一个模块的全部实例（主实例 + 额外实例）。 */
  function stopModule(id, options : StopOptions = {}) {
    const keys = [id, ...[...live.keys()].filter((key) => key !== id && live.get(key)?.moduleId === id)]
    let stopped = false
    for (const key of keys) if (stop(key, options)) stopped = true
    return stopped
  }

  /** 加载一个自己写的模块（按修改时间重新 import，改了就是新的）。 */
  /**
   * 加载自己写的模块：先把整个文件夹拍一份快照（modules/<id>/.aurabot-cache/<版本戳>/）再加载快照。
   * Node 会缓存加载过的文件，快照路径每次不同，所以改了模块里任何一个文件都会重新加载；
   * 快照在模块文件夹里面，模块自己 npm install 的依赖（modules/<id>/node_modules）照样找得到。
   */
  async function importUser(u) {
    const stamp = stampOfTarget(u)
    // 单文件插件不拍快照：直接带 ?v=<版本戳> 重新 import。
    // Node 按 URL 缓存，戳变了 URL 就变了，等于拿到一份新模块；同目录的兄弟文件照旧能 import。
    if (u.single) {
      const mod = await import(`${pathToFileURL(u.file).href}?v=${stamp}`)
      return { def: mod.default, mod, stamp }
    }
    const root = join(u.dir, SNAP)
    const snap = join(root, String(stamp).replace('.', '-'))
    // 入口是 .ts = 作者还在写源码、没构建：把整个文件夹的 .ts 转成 .js 再拍快照。
    // 已经有构建产物（package.json 的 main 指向 lib/…）的模块走不到这条分支，不会误伤。
    const entryIsTs = /\.ts$/i.test(u.file)
    if (!existsSync(snap)) {
      for (const f of filesOf(u.dir)) {
        const target = join(snap, f)
        mkdirSync(dirname(target), { recursive: true })
        if (entryIsTs && /\.ts$/i.test(f) && !/\.d\.ts$/i.test(f)) {
          writeFileSync(target.replace(/\.ts$/i, '.js'), transpileToJs(readFileSync(join(u.dir, f), 'utf8'), f), 'utf8')
          continue
        }
        copyFileSync(join(u.dir, f), target)
      }
    }
    // 旧快照删掉（加载过的代码已经在内存里，删文件不影响）
    try { for (const n of readdirSync(root)) if (join(root, n) !== snap) rmSync(join(root, n), { recursive: true, force: true }) } catch (error) {}
    const entryRel = relative(u.dir, u.file)
    const importRel = entryIsTs ? entryRel.replace(/\.ts$/i, '.js') : entryRel
    const mod = await import(pathToFileURL(join(snap, importRel)).href)
    return { def: mod.default, mod, stamp }
  }

  async function startUser(u, instance = '') {
    if (disposed) return null
    const key = instance ? instanceKey(u.id, instance) : u.id
    const revision = revisions.get(key) || 0
    const stillWanted = () => {
      const users = isUserOn() ? scanUser() : []
      const base = wanted(u.id, users) === 'user' && users.some((item) => item.id === u.id && item.file === u.file)
      if (!base || !instance) return base
      return instancesOf(u.id).some((item) => item.id === instance && item.enabled)
    }
    let def
    let stamp = 0
    try {
      let imported = await importUser(u)
      const mod = imported.mod
      // v2 清单式写法：没有 default，直接 export name / config / apply（和 Koishi 一样）
      def = imported.def ?? namedModuleDef(mod)
      stamp = imported.stamp
      if (!def) throw new Error('入口文件没有模块定义：export default { apply }，或者 export function apply(ctx, config)')
      // v2：export default function apply(ctx, config) —— 用文件夹名补上 id
      if (typeof def === 'function') {
        def = {
          id: u.id,
          name: mod.name || u.id,
          config: mod.config,
          defaults: mod.defaults,
          settings: mod.settings,
          apply: def,
        }
      }
      // 具名导出（export name / config / apply）没写 id：用文件夹名 / 单文件名补上，
      // 注册表、路由前缀、配置存放位置全都按这个 id 走，缺了就到处是 undefined。
      if (!def.id) def = { ...def, id: u.id }
      // v2 清单（package.json.aurabot）：入口里没写的字段从清单补上，
      // 这样面板显示的名字/版本、模块声明的 panel 和 capabilities 都只有一个来源。
      const { manifest } = readManifest(u.dir, { id: u.id })
      if (manifest) {
        // 清单里的 panel 只是「应该放这儿」，文件不在就别让面板挂个空标签
        const panelFile = manifest.panel ? resolve(u.dir, String(manifest.panel).replace(/^\.\//, '')) : ''
        def = {
          ...def,
          name: def.name || manifest.name,
          description: def.description || manifest.description,
          version: def.version || manifest.version,
          panel: def.panel || (panelFile && existsSync(panelFile) ? manifest.panel : undefined),
          capabilities: def.capabilities || manifest.capabilities,
          api: Math.max(Number(def.api || 1) || 1, manifest.api),
          kind: def.kind || manifest.kind,
          reusable: def.reusable ?? manifest.reusable,
          reloadOnConfig: def.reloadOnConfig ?? manifest.reloadOnConfig,
        }
      }
      if (disposed || (revisions.get(key) || 0) !== revision) return null
      if (!stillWanted()) { resyncRequested = true; return null }
      const why = checkDef(def, u.id)
      if (why) throw new Error(why)
    } catch (error) {
      if (disposed || (revisions.get(key) || 0) !== revision) return null
      if (!stillWanted()) { resyncRequested = true; return null }
      errors.set(key, { message: String(error.message || error).slice(0, 800), at: Date.now(), source: 'user', fallback: builtinDefs.has(u.id) })
      bumpNavigation() // 加载失败也进导航（availability=error）
      log.warn(`模块「${key}」加载失败：`, error.message)
      userSeen.set(u.id, { ...u, stamp: stampOfTarget(u) })
      return null
    }
    userSeen.set(u.id, { ...u, stamp })
    // 替换内置模块：记下替换时内置模块的版本，以后内置的更新了提醒一声
    const b = builtinDefs.get(u.id)
    const extra: Record<string, any> = { dir: u.dir }
    if (instance) extra.instance = instance
    if (b) {
      extra.replaces = b.version
      const m = modCfg(u.id)
      if (!m.forkedFrom) setConfig({ ...getConfig(), modules: { ...getConfig().modules, [u.id]: { ...m, forkedFrom: b.version || version } } })
    }
    // setConfig 可能同步触发安全模式或关闭模块，再确认一次才执行 apply。
    if (disposed || (revisions.get(key) || 0) !== revision) return null
    if (!stillWanted()) { resyncRequested = true; return null }
    return start(def, 'user', extra)
  }

  /** 这个 id 现在该跑哪个版本：'user' | 'builtin' | null（关着）。 */
  function wanted(id, users) {
    if (!isEnabled(id)) return null
    const hasUser = isUserOn() && users.some((u) => u.id === id)
    if (hasUser && !(builtinDefs.has(id) && modCfg(id).useBuiltin)) return 'user'
    return builtinDefs.has(id) ? 'builtin' : null
  }

  /** 插件加载时：内置模块同步启动（被替换 / 关掉的跳过），自己写的随后异步加载。 */
  function boot() {
    if (disposed) return Promise.resolve()
    const users = isUserOn() ? scanUser() : []
    for (const def of builtins) if (wanted(def.id, users) === 'builtin') startSync(def)
    return (async () => {
      await loadLib()
      if (disposed) return
      globalThis.aurabot = { lib, src: pathToFileURL(SRC).href, version, apiVersion: API_VERSION, modules: publicHandle, Schema, h }
      installDocs()
      await sync()
      if (disposed) return
      startWatching()
    })().catch((error) => log.error('加载自己写的模块出错：', error.message))
  }

  /**
   * 盯着 modules 目录：文件一变就同步（事件驱动），不再每 3 秒扫一遍。
   * 事件可能丢（网络盘 / 编辑器原子替换），所以留一个 30 秒的版本戳兜底——
   * 兜底只比 mtime，不重新 import。
   */
  function startWatching() {
    const dir = userDir()
    try { mkdirSync(dir, { recursive: true }) } catch (error) {}
    const kick = () => {
      if (disposed || pendingSync) return
      pendingSync = setTimeout(() => {
        pendingSync = null
        sync().catch((error) => log.warn('检查模块变化出错：', error.message))
      }, 150)
      pendingSync.unref?.()
    }
    try {
      watcher = watch(dir, { recursive: true, persistent: false }, (_event, file) => {
        // 快照目录是我们自己写的，别自己触发自己
        if (file && String(file).includes(SNAP)) return
        kick()
      })
      watcher.on?.('error', (error) => log.warn('模块目录监听出错：', error.message))
    } catch (error) {
      // Linux 上 fs.watch 不支持 recursive：退回老办法，别让热重载整个失效
      log.warn(`模块目录监听不支持递归（${error.message}），退回 3 秒轮询`)
      watching = setInterval(() => { sync().catch((error) => log.warn('检查模块变化出错：', error.message)) }, 3000)
      watching.unref?.()
      return
    }
    watching = setInterval(() => { sync().catch((error) => log.warn('检查模块变化出错：', error.message)) }, 30_000)
    watching.unref?.()
  }

  /** 按配置和文件夹的现状，把该开的开、该关的关、改过的重新加载。 */
  let syncing = null
  let resyncRequested = false
  async function syncPass() {
    const users = isUserOn() ? scanUser() : []
    const ids = new Set([
      ...builtinDefs.keys(),
      ...users.map((u) => u.id),
      ...[...live.values()].map((rec) => rec.moduleId),
    ])
    for (const id of ids) {
      if (disposed || resyncRequested) return
      const want = wanted(id, users)
      const rec = live.get(id)
      const u = users.find((x) => x.id === id)
      if (!want) { if (hasModule(id)) stopModule(id); continue }
      if (want === 'builtin') {
        if (rec && rec.source === 'builtin') { await syncInstances(id, users); continue }
        if (hasModule(id)) stopModule(id)
        if (errors.get(id)?.source === 'builtin' && !rec) continue // 内置的启动失败过，别每 3 秒重试
        startSync(builtinDefs.get(id))
        await syncInstances(id, users)
        continue
      }
      // 自己写的：没跑、换了文件、改过 → (重新)加载
      const seen = userSeen.get(id)
      const changed = !seen || seen.file !== u.file || seen.stamp !== stampOfTarget(u)
      if (rec && rec.source === 'user' && !changed) { await syncInstances(id, users); continue }
      if (!changed && (!rec || rec.fallback)) continue // 上次加载失败、文件也没改：等改了再试
      // 代码变了：主实例和所有额外实例一起换代，别让实例继续跑旧代码
      if (hasModule(id)) stopModule(id, { quiet: true })
      clearInstanceSeen(id)
      if (seen && changed) log.info(`模块「${id}」文件改了，重新加载`)
      const revision = revisions.get(id) || 0
      const ok = await startUser(u)
      if (disposed) return
      // import 期间被停止或改了配置时，由下一次检查决定是否启动。
      if ((revisions.get(id) || 0) !== revision || resyncRequested) continue
      // 替换版加载失败：先用回内置的，免得这项功能直接没了
      if (!ok && builtinDefs.has(id)) {
        startSync(builtinDefs.get(id))
        const back = live.get(id)
        if (back) { back.fallback = true; log.warn(`模块「${id}」：你的版本没加载成功，先用内置的`) }
      }
      await syncInstances(id, users)
    }
    for (const id of [...userSeen.keys()]) if (!users.some((u) => u.id === id)) { userSeen.delete(id); if (errors.get(id)?.source === 'user') errors.delete(id); bumpNavigation() /* 安装的模块被删了：导航摘要要变 */ }
  }

  /** 清掉某个模块所有实例的「上次配置」记录（重载 / 卸载时用）。 */
  function clearInstanceSeen(id) {
    for (const key of [...instanceSeen.keys()]) {
      if (key === id || key.startsWith(`${id}@`)) instanceSeen.delete(key)
    }
  }

  /**
   * 把 `ext.<id>.instances` 和正在跑的额外实例对齐。
   *
   * 只给用户模块开多实例（内置模块的 apply 是同步单例，没有可重复调用的入口）；
   * 清单没写 `reusable: true` 时，残留的实例一律停掉。
   */
  async function syncInstances(id, users) {
    const rec = live.get(id)
    const def = rec?.def || builtinDefs.get(id)
    const u = users.find((x) => x.id === id)
    const reusable = Boolean(def?.reusable)
    if (reusable && !u) {
      const key = `${id}@`
      if (!instanceSeen.has(key)) {
        instanceSeen.set(key, '')
        log.debug?.(`模块「${id}」声明了 reusable，但它不是用户模块，额外实例暂不支持`)
      }
      return
    }
    const wanted = reusable && isEnabled(id) && u ? instancesOf(id).filter((item) => item.enabled) : []
    // 1) 配置里已经没有的实例：停掉
    for (const key of [...live.keys()]) {
      const running = live.get(key)
      if (!running || key === id || running.moduleId !== id) continue
      if (wanted.some((item) => instanceKey(id, item.id) === key)) continue
      stop(key, { quiet: true })
      instanceSeen.delete(key)
      errors.delete(key)
      log.info(`模块「${id}」实例 ${running.instance} 已按配置移除`)
    }
    // 2) 该有的实例：没跑 / 配置改过（含代码重载后 instanceSeen 被清空）→ 启动
    for (const item of wanted) {
      if (disposed || resyncRequested) return
      const key = instanceKey(id, item.id)
      const snapshot = JSON.stringify(item.config || {})
      const running = live.get(key)
      if (running && running.source === 'user' && instanceSeen.get(key) === snapshot) continue
      if (running) stop(key, { quiet: true })
      errors.delete(key)
      const started = await startUser(u, item.id)
      if (started) {
        instanceSeen.set(key, snapshot)
      } else if (!errors.has(key)) {
        // startUser 在「配置里已经没有这个实例」时会直接返回 null，这里不当作失败
        instanceSeen.delete(key)
      }
    }
  }

  function sync() {
    if (disposed) return Promise.resolve()
    if (syncing) { resyncRequested = true; return syncing }
    syncing = (async () => {
      do {
        resyncRequested = false
        await syncPass()
      } while (resyncRequested && !disposed)
    })().finally(() => { syncing = null })
    return syncing
  }

  /** 强制重新加载一个模块（面板「重新加载」）。 */
  async function reload(id) {
    stopModule(id, { quiet: true })
    clearInstanceSeen(id)
    errors.delete(id)
    userSeen.delete(id)
    await sync()
    return status().find((m) => m.id === id) || null
  }

  /**
   * 面板保存设置后的收尾。
   *
   * 默认什么都不做：内置模块和多数插件用的是 `ctx.settings()`，每次读都是新值，重载反而丢内存态。
   * 清单里写了 `aurabot.reloadOnConfig: true` 的模块才重载 —— 那些在 `apply(ctx, config)` 里
   * 直接把 config 存进闭包的插件，重载一次最省心。
   */
  async function reloadOnConfigChange(beforeExt: Record<string, unknown> = {}, nextExt: Record<string, unknown> = {}) {
    const ids = new Set([...Object.keys(beforeExt || {}), ...Object.keys(nextExt || {})])
    for (const id of ids) {
      const changed = JSON.stringify((beforeExt || {})[id]) !== JSON.stringify((nextExt || {})[id])
      if (!changed) continue
      // 有实例的模块：改配置（改实例、加实例、删实例、改主配置里的 token）必须让实例重连，
      // 否则面板上明明改了、实际还在用旧参数跑。
      const runningInstance = [...live.values()].some((rec) => rec.moduleId === id && rec.key !== id)
      if (runningInstance || instancesOf(id).length) {
        await reload(id).catch(() => {})
        continue
      }
      if (live.get(id)?.def?.reloadOnConfig !== true) continue
      await reload(id).catch(() => {})
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearInterval(watching)
    clearTimeout(pendingSync)
    try { watcher?.close?.() } catch (error) {}
    watcher = null
    for (const id of [...live.keys()].reverse()) stop(id, { quiet: true })
    routes.clear()
    listeners.clear()
    if (globalThis.aurabot?.modules === publicHandle) delete globalThis.aurabot
  }

  // ---------- 事件 ----------
  function emit(event, ...args) {
    if (disposed || event === 'chat/delivery') return
    for (const { fn } of listeners.get(event) || []) {
      try { const r = fn(...args); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch (error) {}
    }
  }
  /** 依次问每个模块，第一个返回真值的接管（收到消息时用）。 */
  async function claim(event, ...args) {
    for (const { fn } of listeners.get(event) || []) {
      try { if (await fn(...args)) return true } catch (error) {}
    }
    return false
  }
  /** 依次让每个模块改写一个值（发回复前用）：返回 undefined 不改，null 拦下。 */
  async function filter(event, value, ...args) {
    let v = value
    for (const { fn } of listeners.get(event) || []) {
      try {
        const r = await fn(v, ...args)
        if (r === null) return null
        if (r !== undefined) v = r
      } catch (error) {}
    }
    return v
  }
  /** 同步版（人格、规则、模型选择这些地方不能等）：监听函数返回 Promise 的不算。 */
  function filterSync(event, value, ...args) {
    let v = value
    for (const { fn } of listeners.get(event) || []) {
      try {
        const r = fn(v, ...args)
        if (r && typeof r.then === 'function') continue
        if (r === null) return null
        if (r !== undefined) v = r
      } catch (error) {}
    }
    return v
  }

  // ---------- 汇总给插件其他部分用 ----------
  function buildTools(where) {
    const out = []
    const names = new Set()
    for (const rec of live.values()) {
      for (const b of rec.tools) {
        let r
        try { r = typeof b === 'function' ? b(where) : b } catch (error) { note(rec.id, '生成工具', error); continue }
        for (const t of [].concat(r || [])) {
          if (!t || !t.name) continue
          if (names.has(t.name)) { log.debug(`工具 ${t.name} 重名，模块「${rec.id}」的没挂`); continue }
          names.add(t.name)
          out.push(t)
        }
      }
    }
    return out
  }
  function contextFor(args) {
    const parts = []
    for (const rec of live.values()) {
      for (const fn of rec.contexts) {
        try { const t = fn(args); if (t) parts.push(String(t)) } catch (error) {}
      }
    }
    return parts.join('\n\n')
  }
  function rules(kind) {
    const out = []
    for (const rec of live.values()) {
      for (const fn of rec.rules) {
        try { const t = typeof fn === 'function' ? fn(kind, getConfig()) : fn; for (const line of [].concat(t || [])) if (line) out.push(String(line)) } catch (error) {}
      }
    }
    return out
  }
  const commands = () => [...live.values()].flatMap((r) => r.commands)
  const dshTools = () => [...live.values()].flatMap((r) => r.dshTools.map((t) => ({ ...t, module: r.moduleId, instance: r.instance })))
  /** 内置模块里没在跑的（关掉的、被替换的）。 */
  const builtinOff = () => new Set([...builtinDefs.keys()].filter((id) => live.get(id)?.source !== 'builtin'))

  async function handle(path, req, res) {
    const r = routes.get(path)
    // 路由的 id 是注册表键（主实例 = 模块 id，额外实例 = id@名字）
    if (!r || !live.has(r.id)) return { ok: false, message: '这个功能所在的模块没开（面板「已安装」里看看）', moduleOff: true }
    return r.handler(req, res)
  }

  /**
   * 模块声明的能力（package.json.aurabot.capabilities，v1 回退 module.json）：
   * 内置模块没有清单就当未声明（[]）。子智能体委派这类「要本机权限」的能力靠它把关（一审 #177）。
   */
  function capabilitiesOf(id) {
    const key = String(id || '')
    if (!ID_RE.test(key)) return []
    for (const dir of [idDir(key), join(BUILTIN_DIR, String(key).split('/').pop())]) {
      if (!existsSync(dir)) continue
      const { manifest } = readManifest(dir, { id: key })
      if (manifest) return manifest.capabilities
    }
    return []
  }

  // ---------- 面板 ----------
  function status() {
    const users = isUserOn() ? scanUser() : scanUser().map((u) => ({ ...u, safe: true }))
    // 文件夹刚删掉、还没来得及停的模块也列出来（下一轮检查就停）
    const moduleIds = [...live.values()].map((rec) => rec.moduleId)
    const ids = [...builtinDefs.keys(), ...[...new Set([...users.map((u) => u.id), ...moduleIds])].filter((id) => !builtinDefs.has(id)).sort()]
    return ids.map((id) => {
      const b = builtinDefs.get(id)
      const u = users.find((x) => x.id === id)
      const rec = live.get(id)
      // 主实例没跑但额外实例在跑时，定义从实例上取，面板照样能显示名称/设置字段
      const instanceRecs = [...live.values()].filter((item) => item.moduleId === id && item.key !== id)
      const def: any = rec?.def || instanceRecs[0]?.def || b || {}
      const m = modCfg(id)
      const err = errors.get(id)
      return {
        id,
        name: def.name || id,
        description: def.description || '',
        version: def.version || '',
        kind: def.kind === 'adapter' ? 'adapter' : 'plugin',
        reusable: Boolean(def.reusable),
        builtin: Boolean(b),
        builtinVersion: b?.version || '',
        hasUser: Boolean(u),
        community: Boolean(u && existsSync(join(u.dir, '.aurabot-source.json'))),
        userDir: u?.dir || '',
        safeSkipped: Boolean(u?.safe),
        running: rec ? rec.source : null, // 'builtin' | 'user' | null
        // 额外实例：面板按这个列表出「实例」卡片；配置在 ext.<id>.instances
        instances: instanceRecs.map((item) => ({
          id: item.instance,
          key: item.key,
          running: item.source,
          startedAt: item.startedAt,
          error: errors.get(item.key)?.message || '',
          errors: item.errors,
          tools: toolNames(item),
          commands: item.commands.map((c) => c.name),
          routes: [...routes].filter(([, route]) => route.id === item.key).map(([p]) => p.replace('/aurabot/api', '')),
        })),
        fallback: Boolean(rec?.fallback),
        enabled: m.enabled !== false,
        useBuiltin: Boolean(m.useBuiltin),
        forkedFrom: m.forkedFrom || '',
        outdated: Boolean(b && rec?.source === 'user' && m.forkedFrom && m.forkedFrom !== b.version),
        error: err ? err.message : '',
        errors: rec ? rec.errors : [],
        tools: rec ? toolNames(rec) : [],
        commands: rec ? rec.commands.map((c) => c.name) : [],
        routes: [...routes].filter(([, r]) => r.id === id).map(([p]) => p.replace('/aurabot/api', '')),
        settings: rec?.source === 'user' || instanceRecs.length || (!rec && u) ? (def.settings || []) : [],
        defaults: def.defaults || {},
        // 内置模块也能带面板：内置和用户模块走同一条加载链路，面板只按「定义里有没有声明 panel」判断。
        // 不再要求 rec.source === 'user'，否则内置模块写了 panel.js 也永远显示不出来。
        // 仍然要求模块在跑（rec 存在），没跑起来的模块没有面板代码可读。
        panel: Boolean(rec && def.panel),
        // 接口是不是挂在根路径（内置模块的老路径）；面板里的 call() 靠它决定加不加 /ext/<id> 前缀
        routesAtRoot: routesAtRoot(id),
        tab: def.tab || '',
        navGroup: typeof def.navGroup === 'string' ? def.navGroup : '',
        flag: typeof def.flag === 'string' ? def.flag : (def.settings || []).some((f) => f?.key === 'enabled') ? 'enabled' : '',
        keepPanel: Boolean(def.keepPanel),
        startedAt: rec?.startedAt || 0,
      }
    })
  }
  function toolNames(rec) {
    const names = []
    for (const b of rec.tools) {
      try {
        const r = typeof b === 'function' ? b({ chat: { chatId: 'private:0', kind: 'private', userId: '0' }, level: 'full', sessionId: '' }) : b
        for (const t of [].concat(r || [])) if (t?.name) names.push(t.name)
      } catch (error) {}
    }
    return names
  }

  // ---------- 面板首屏：导航摘要（方案 §二/§2.1） ----------
  /**
   * 从内存注册表生成导航摘要：内置定义（builtinDefs）+ 用户模块扫描缓存（userSeen）+
   * 运行记录（live）+ 错误表（errors）+ 配置（modCfg）。**绝不调 scanUser() 重扫模块目录，
   * 也不执行工具构造器**（toolNames 那套不走）——首屏读取只准碰内存。
   * 每项：id/name/tab/navGroup/hasSettings/hasPanel/enabled/running/platforms/availability。
   */
  function summarizeModules() {
    // live 的键可能是 `id@实例名`：导航按模块 id 去重，额外实例只体现在 instanceCount 上
    const liveIds = [...live.values()].map((rec) => rec.moduleId)
    const ids = new Set([...builtinDefs.keys(), ...userSeen.keys(), ...liveIds])
    const modules = [...ids].sort().map((id) => {
      const b = builtinDefs.get(id)
      const seen = userSeen.get(id)
      const rec = live.get(id)
      const instanceRecs = [...live.values()].filter((item) => item.moduleId === id && item.key !== id)
      const def: any = rec?.def || instanceRecs[0]?.def || b || {}
      const m = modCfg(id)
      const err = errors.get(id)
      const enabled = m.enabled !== false
      const availability = rec ? 'ready'
        : err ? 'error'
        : !enabled ? 'disabled'
        : (b || seen) ? 'stopped' // 有定义/有安装记录但没在跑（被关、被替换、等待加载）
        : 'unloaded' // 只有扫描缓存残影，定义还没拿到
      return {
        id,
        name: def.name || id,
        tab: def.tab || '',
        navGroup: typeof def.navGroup === 'string' ? def.navGroup : '',
        hasSettings: Array.isArray(def.settings) && def.settings.length > 0,
        hasPanel: Boolean(rec && def.panel),
        kind: def.kind === 'adapter' ? 'adapter' : 'plugin',
        reusable: Boolean(def.reusable),
        enabled,
        running: rec ? rec.source : null, // 'builtin' | 'user' | null
        instanceCount: instanceRecs.length,
        platforms: Array.isArray(def.platforms) ? def.platforms.map(String) : [],
        availability, // ready | error | disabled | stopped | unloaded
        error: err && !rec ? err.message : '',
      }
    })
    return { navigationRevision: navigationRevisionCounter, modules }
  }

  /** file 是不是在 root 目录里面（root 自己不算；越过 root 的 ../ 一律不算）。 */
  function inside(root, file) {
    const rel = relative(resolve(root), resolve(file))
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /**
   * 模块的面板代码（panel.js），面板拿去执行。
   * 内置模块也允许带面板：两者本来就是同一条加载链路，面板只需要「定义里声明了 panel」。
   * 面板文件从模块自己的文件夹读：用户模块在数据目录 modules/<id>，内置模块在 packages/<id>；
   * 两边都要求落在各自的根目录里，防止 panel 写成 ../../xxx 去读根目录外面的文件。
   */
  function panelSource(id) {
    // 主实例没跑、只有额外实例在跑时，面板代码也从同一个定义里取
    const rec = live.get(id) || [...live.values()].find((item) => item.moduleId === id && item.def.panel)
    if (!rec || !rec.def.panel) return null
    // 内置模块的根目录是 packages/<id>；id 先按 ID_RE 校验，别让奇怪的名字把根目录带到外面去。
    const builtin = rec.source !== 'user'
    const root = builtin
      ? (ID_RE.test(String(id)) ? join(BUILTIN_DIR, id) : '')
      : (rec.dir || userSeen.get(id)?.dir || '')
    if (!root) return null
    const file = resolve(root, typeof rec.def.panel === 'string' ? rec.def.panel : 'panel.js')
    if (!inside(root, file) || !existsSync(file)) return null
    return readFileSync(file, 'utf8')
  }

  /** 新建一个自己写的模块（从模板）。 */
  function create(id, name) {
    if (!ID_RE.test(id)) return { ok: false, message: 'id 要小写字母开头，只能有小写字母、数字和 -，比如 weather' }
    const dir = idDir(id)
    if (existsSync(dir)) return { ok: false, message: `modules/${id} 已经有了` }
    mkdirSync(dir, { recursive: true })
    const tpl = readFileSync(join(BUILTIN_DIR, '_template', 'index.mjs'), 'utf8')
    writeFileSync(join(dir, 'index.mjs'), tpl.replaceAll('__TOOL__', id.replace(/-/g, '_')).replaceAll('__ID__', id).replaceAll('__NAME__', String(name || id).replace(/['\\\n]/g, '')), 'utf8')
    installDocs()
    return { ok: true, dir, file: join(dir, 'index.mjs'), message: `建好了：${join(dir, 'index.mjs')}` }
  }

  /**
   * 取一份内置模块源码（key 相对 src/，扩展名是 .js）。
   * 发布包里读的是同级编译产物；开发期只有 .ts 源码，就地转成 JS——
   * 复制出去的用户模块要能直接跑，不能依赖构建步骤。
   */
  function builtinSource(key) {
    const { root, rel } = sourceRootOf(key)
    const direct = join(root, ...rel.split('/'))
    if (existsSync(direct)) return readFileSync(direct, 'utf8')
    const tsFile = join(root, ...rel.replace(/\.js$/, '.ts').split('/'))
    return transpileToJs(readFileSync(tsFile, 'utf8'), tsFile)
  }

  /** 开发期的兜底：把 TS 源码转成等价 JS（装了 typescript 才有；发布包走编译产物，不会到这里）。 */
  function transpileToJs(source, file) {
    let ts
    try {
      ts = createRequire(import.meta.url)('typescript')
    } catch {
      throw new Error('既没有编译产物也没有 typescript：先运行 npm run build 再复制模块')
    }
    const out = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
    })
    return out.outputText.replace(/(from\s*['"]|import\(\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
  }

  /** 删除用户模块：先停掉，再把源码和本地改动归档到 modules/.trash；默认保留数据和设置，purge 才清掉。 */
  async function removeModule(id, { purge = false } : RemoveModuleOptions = {}) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, message: 'id 不对' }
    // 单文件插件：modules/<id>.mjs。归档方式和文件夹模块一样，只是搬的是一个文件。
    const singleFile = join(userDir(), `${id}.mjs`)
    if (existsSync(singleFile)) {
      const trashDir = join(userDir(), '.trash')
      mkdirSync(trashDir, { recursive: true })
      const folder = `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      stopModule(id)
      try {
        mkdirSync(join(trashDir, folder), { recursive: true })
        renameSync(singleFile, join(trashDir, folder, `${id}.mjs`))
        log.info(`面板删除单文件模块「${id}」，源码归档到 modules/.trash/${folder}`)
        if (purge) {
          rmSync(dataDir('modules-data', id), { recursive: true, force: true })
          const cfg = getConfig()
          const { [id]: _ext, ...ext } = cfg.ext || {}
          const { [id]: _mod, ...modules } = cfg.modules || {}
          setConfig({ ...cfg, ext, modules })
        }
      } finally {
        await sync()
      }
      const dataStatus = purge ? '数据和设置已清除' : '数据和设置已保留'
      return { ok: true, archive: `modules/.trash/${folder}`, message: `删掉了，源码已移到 modules/.trash/${folder}。${dataStatus}。` }
    }
    const dir = idDir(id)
    if (!inside(userDir(), dir)) return { ok: false, message: 'id 不对' }
    if (!existsSync(dir)) return { ok: false, message: `modules/${id} 不存在` }
    if (!lstatSync(dir).isDirectory()) return { ok: false, message: `modules/${id} 不是文件夹` }
    const trash = join(userDir(), '.trash')
    mkdirSync(trash, { recursive: true })
    if (!lstatSync(trash).isDirectory()) return { ok: false, message: 'modules/.trash 不是文件夹，没法归档' }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folder = `${id}-${stamp}-${randomUUID().slice(0, 8)}`
    const archive = `modules/.trash/${folder}`
    stopModule(id)
    try {
      renameSync(dir, join(trash, folder))
      log.info(`面板删除模块「${id}」，源码归档到 ${archive}`)
      if (purge) {
        rmSync(dataDir('modules-data', id), { recursive: true, force: true })
        const cfg = getConfig()
        const { [id]: _ext, ...ext } = cfg.ext || {}
        const { [id]: _mod, ...modules } = cfg.modules || {}
        setConfig({ ...cfg, ext, modules })
      }
    } finally {
      await sync()
    }
    const dataStatus = purge ? '数据和设置已清除' : '数据和设置已保留'
    const fallback = builtinDefs.has(id) ? '内置版本会继续运行。' : ''
    return { ok: true, archive, message: `删掉了，源码和本地改动已移到 ${archive}。${dataStatus}。${fallback}` }
  }

  const { installDocs, promptFor } = createDocs({ userDir, version, getConfig })

  const publicHandle = { use: exportsOf, has: hasModule, list: () => status().map(({ id, name, running }) => ({ id, name, running })), emit }

  return {
    boot, sync, reload, dispose, status, create, remove: removeModule, promptFor, panelSource, reloadOnConfigChange,
    // 对外按模块 id 停 —— 一起停掉它的额外实例
    stop: (id, options) => stopModule(id, options),
    use: exportsOf, has: hasModule, running: (id) => live.get(id)?.source || null, generation: () => generation,
    /** 某个模块正在跑的额外实例名（面板/调试用）。 */
    instances: (id) => [...live.values()].filter((rec) => rec.moduleId === id && rec.key !== id).map((rec) => rec.instance),
    capabilitiesOf,
    // 面板首屏提速：导航摘要（纯内存）与导航版本号（安装/启停/失败/重载时递增）
    summarizeModules, navigationRevision: () => navigationRevisionCounter,
    emit, claim, filter, filterSync, buildTools,
    // 插件核心自己听事件（不属于任何模块，不会被撤掉）
    listen: (event, fn) => { const item = { id: '@core', fn }; listeners.set(event, [...(listeners.get(event) || []), item]); return () => listeners.set(event, (listeners.get(event) || []).filter((x) => x !== item)) }, contextFor, rules, commands, dshTools, builtinOff, handle,
    hasRoute: (path) => routes.has(path),
    routeAccess: (path) => routes.get(path)?.access || null,
    dir: userDir,
  }
}
