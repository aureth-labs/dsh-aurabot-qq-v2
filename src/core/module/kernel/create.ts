import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, watch } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createPluginContext } from '../context/plugin-context.ts'
import { isSchema, Schema } from '../../config/shape/schema.ts'
import { h } from '../../message/element/element.ts'

// 和 Koishi 一样把 h 挂到全局：插件里直接写 `h('text', { content })`，不用 import。
;(globalThis as { h?: typeof h }).h ??= h
;(globalThis as { Schema?: typeof Schema }).Schema ??= Schema
import { readManifest, entryOf as entryOfManifest } from '../manifest.ts'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { dataDir } from '../../store/index.ts'
import type { SettingsField } from '../../config/shape/schema.ts'
import { PERSONA_MEMORY_MODULE } from '../privileged.ts'

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
import { createImporter } from '../importer.ts'
import { createPlugin } from '../scaffold.ts'
export * from '../governance.ts'
import { INSTANCE_RE, STABLE_ROUTES, BUILTIN_DIR, API_VERSION, instanceKey, settingsFromMeta, schemaDefaults, stampOfTarget, SNAP, scanUser, userDir, ID_RE, idDir } from '../loader.ts'
import type { ModuleDef, ModuleRecord, ModuleError } from '../loader.ts'

export * from './util.ts'
import { createApi } from './api.ts'
import { createDocs } from './docs.ts'
import { createModuleEvents } from './events.ts'
import { createContributions } from './contributions.ts'
import { createModuleCatalog } from './catalog.ts'
import { loadDefinition } from './definition.ts'
import { createAdapterCatalog } from './adapters.ts'
import { ServiceRegistry } from '../../service/registry.ts'

export function createModules({ ctx, core, getConfig, setConfig, logger, version, builtins, personaMemoryRuntime, initialServices = {} }) {
  const log = logger.child('modules')
  const importer = createImporter(userDir())
  const builtinDefs = new Map<string, ModuleDef>((builtins as ModuleDef[]).map((d) => [d.id, d]))
  const fields = new Map<string, SettingsField[]>()
  const live = new Map<string, ModuleRecord>() // id → 运行中的模块（见 start）
  const errors = new Map<string, ModuleError>() // id → { message, at }  启动失败 / 加载失败
  const routes = new Map() // 完整路径 → { id, handler }
  const pages = new Map() // 完整路径 → { id, path, name, icon, order }
  const services = new ServiceRegistry()
  for (const [name, service] of Object.entries(initialServices)) services.provide(name, service, '@core')
  const events = createModuleEvents(note)
  const {emit, emitAsync, claim, filter, filterSync} = events
  const revisions = new Map() // id → 停止次数，取消在途 import
  // 模块每次（重）启动都递增一次「代际」：hub 用它判断会话里挂的工具是不是旧模块实例的闭包。
  let generation = 0
  // 导航版本：模块安装/启停/失败/重载（含可用平台随定义变化）时递增；
  // 面板首屏轮询 /panel/pulse 拿它判断要不要重新拉导航摘要（方案 §二/§2.1）。
  let navigationRevisionCounter = 0
  const bumpNavigation = () => { navigationRevisionCounter++ }
  const userSeen = new Map() // id → { dir, file, stamp }
  /** 额外实例上一次启动时的配置快照：配置一改就重启那个实例（适配器要重连）。 */
  const instanceSeen = new Map() // 注册表键 → JSON(config)
  let watching = null
  let watcher = null
  let pendingSync = null
  let disposed = false

  const modCfg = (id) => getConfig().modules?.[id] || {}
  const isEnabled = (id) => modCfg(id).enabled !== false
  const isUserOn = () => !getConfig().safeMode
  const adapterCatalog = createAdapterCatalog(builtinDefs, live, importer, isUserOn, id => Boolean(modCfg(id).useBuiltin))
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

  const { status, summarizeModules } = createModuleCatalog({ live, errors, routes, userSeen, builtinDefs, discover: scanUser, modCfg, isUserOn, routesAtRoot, revision: () => navigationRevisionCounter })
  const { buildTools, contextFor, rules, commands, dshTools } = createContributions(live, getConfig, log, note)

  const apiOf = createApi({ logger, core, getConfig, setConfig, version, live, routes, subscribe: events.subscribe, builtinDefs, personaMemoryRuntime, isDisposed: () => disposed, note, cleanup, remove, exportsOf, hasModule, routesAtRoot, emit: (event, ...args) => emit(event, ...args), isEnabled, isUserOn, ctx })
  const makeApi = (id: string, source: string, rec: ModuleRecord) => apiOf(id, source, rec)

  /** 插件在面板侧栏注册的页面：路径唯一，模块卸载一起撤。 */
  function registerPage(rec: ModuleRecord, page: any) {
    const path = '/' + String(page?.path || '').replace(/^\/+/, '')
    if (path === '/') throw new Error('ctx.page 需要 path，例如 { path: "/sandbox", name: "聊天沙盒" }')
    const current = pages.get(path)
    if (current && current.id !== rec.key && live.has(current.id)) throw new Error(`页面 ${path} 已经被模块「${current.id}」注册`)
    const prefix = rec.instance ? `/ext/${rec.moduleId}/i/${rec.instance}` : (routesAtRoot(rec.moduleId) ? '' : `/ext/${rec.moduleId}`)
    const item = {
      id: rec.key,
      moduleId: rec.moduleId,
      path,
      name: String(page.name || path),
      icon: String(page.icon || ''),
      order: Number(page.order) || 0,
      url: /^https?:\/\//i.test(String(page.url || '')) ? String(page.url) : '/aurabot/api' + prefix + path,
    }
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

  /** Config Schema → 面板字段与默认值；官方插件额外挂 registerCommands 开关（默认关）。 */
  function prepareDef(def, source) {
    if (isSchema(def.config)) {
      def = { ...def, settings: def.config.toSettings(), defaults: def.config.defaults() }
    } else if (def.config && !(Array.isArray(def.settings) && def.settings.length)) {
      const derived = settingsFromMeta(def.config)
      if (derived.length) def = { ...def, settings: derived, defaults: { ...(schemaDefaults(def.config) || {}), ...(def.defaults || {}) } }
    }
    if (source !== 'builtin' || def.settings?.some((f) => f?.key === 'registerCommands')) return def
    return {
      ...def,
      defaults: { registerCommands: false, ...(def.defaults || {}) },
      settings: [...(def.settings || []), { key: 'registerCommands', type: 'boolean', label: '注册指令（默认关，打开后本插件的 ctx.command 才生效）' }],
    }
  }

  // ---------- 启动 / 停止 ----------
  async function start(def, source, extra : StartOptions = {}) {
    if (disposed) return null
    const id = def.id
    const instance = String(extra.instance || '').trim()
    const key = instance ? instanceKey(id, instance) : id
    def = prepareDef(def, source)
    const rec: ModuleRecord = {
      key,
      moduleId: id,
      id,
      def,
      source,
      dir: source === 'builtin' ? def.packageDir || join(BUILTIN_DIR, id) : undefined,
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
    fields.set(id, def.settings || [])
    // 设置的默认值补进配置（面板表单直接有值可改；已经填过的不动）。
    // 只有主实例落盘：额外实例的默认值由 api.settings() 在读取时合并，不往共享配置里写。
    if (source === 'user' && !instance && def.defaults && typeof def.defaults === 'object') {
      const cur = getConfig().ext?.[id] || {}
      const missing = Object.keys(def.defaults).filter((k) => !(k in cur))
      if (missing.length) setConfig({ ...getConfig(), ext: { ...getConfig().ext, [id]: { ...Object.fromEntries(missing.map((k) => [k, def.defaults[k]])), ...cur } } })
    }
    live.set(key, rec)
    if (source !== 'builtin' || errors.get(key)?.source !== 'user') errors.delete(key)
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
        startAdapter: core.adapters && ((spec, config, signal) => core.adapters.start(spec, config, signal, rec.key)),
        services,
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
      errors.set(key, { message: String(error && error.message ? error.message : error).slice(0, 800), at: Date.now(), source, adapter: def.kind === 'adapter' })
      bumpNavigation() // 启动失败也进导航（availability=error）
      log.warn(`模块「${def.name || id}」${instance ? `实例 ${instance} ` : ''}启动失败：`, error.message)
    }
    return live.get(key)
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
    let stamp = ''
    try {
      const imported = await loadDefinition(importer,u)
      def = imported.def
      stamp = imported.stamp
      if (disposed || (revisions.get(key) || 0) !== revision) return null
      if (!stillWanted()) { resyncRequested = true; return null }
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
    const starting = builtins.filter(def => wanted(def.id, users) === 'builtin').map(def => start(def, 'builtin'))
    return (async () => {
      await Promise.all(starting)
      if (disposed) return
      globalThis.aurabot = { version, apiVersion: API_VERSION, modules: publicHandle, Schema, h }
      installDocs()
      await sync()
      if (disposed) return
      startWatching()
    })().catch((error) => log.error('加载自己写的模块出错：', error.message))
  }

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
        await start(builtinDefs.get(id), 'builtin')
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
        await start(builtinDefs.get(id), 'builtin')
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

  async function syncInstances(id, users) {
    const rec = live.get(id)
    const def = rec?.def || builtinDefs.get(id)
    const u = users.find((x) => x.id === id)
    const reusable = Boolean(def?.reusable)
    const source = rec?.source
    const wanted = reusable && isEnabled(id) && source ? instancesOf(id).filter((item) => item.enabled) : []
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
      if (running && running.source === source && instanceSeen.get(key) === snapshot) continue
      if (running) stop(key, { quiet: true })
      errors.delete(key)
      const started = source === 'builtin'
        ? await start(def, 'builtin', { instance: item.id })
        : await startUser(u, item.id)
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

  async function reloadOnConfigChange(beforeExt: Record<string, unknown> = {}, nextExt: Record<string, unknown> = {}, force: readonly string[] = []) {
    const ids = new Set([...force, ...Object.keys(beforeExt), ...Object.keys(nextExt)])
    for (const id of ids) {
      const changed = JSON.stringify((beforeExt || {})[id]) !== JSON.stringify((nextExt || {})[id])
      if (!changed && !force.includes(id)) continue
      // 有实例的模块：改配置（改实例、加实例、删实例、改主配置里的 token）必须让实例重连，
      // 否则面板上明明改了、实际还在用旧参数跑。
      const runningInstance = [...live.values()].some((rec) => rec.moduleId === id && rec.key !== id)
      if (runningInstance || instancesOf(id).length) {
        await reload(id).catch(() => {})
        continue
      }
      if (!force.includes(id) && !errors.get(id)?.adapter && live.get(id)?.def?.kind !== 'adapter' && live.get(id)?.def?.reloadOnConfig !== true) continue
      await reload(id).catch(() => {})
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    events.close()
    clearInterval(watching)
    clearTimeout(pendingSync)
    try { watcher?.close?.() } catch (error) {}
    watcher = null
    for (const id of [...live.keys()].reverse()) stop(id, { quiet: true })
    importer.dispose()
    routes.clear()

    if (globalThis.aurabot?.modules === publicHandle) delete globalThis.aurabot
  }

  /** 内置模块里没在跑的（关掉的、被替换的）。 */
  const builtinOff = () => new Set([...builtinDefs.keys()].filter((id) => live.get(id)?.source !== 'builtin'))

  async function handle(path, req, res) {
    const r = routes.get(path)
    // 路由的 id 是注册表键（主实例 = 模块 id，额外实例 = id@名字）
    if (!r || !live.has(r.id)) return { ok: false, message: '这个功能所在的模块没开（面板「已安装」里看看）', moduleOff: true }
    return r.handler(req, res)
  }

  /**
   * 模块声明的能力（package.json.aurabot.capabilities）：
   * 内置模块没有清单就当未声明（[]）。子智能体委派这类「要本机权限」的能力靠它把关（一审 #177）。
   */
  function capabilitiesOf(id) {
    const key = String(id || '')
    if (!ID_RE.test(key)) return []
    const builtin = builtinDefs.get(key)
    const bundled = builtin && (builtin.packageDir || join(BUILTIN_DIR, key))
    const running = live.get(key)
    const locations = running?.dir ? [running.dir] : modCfg(key).useBuiltin ? [bundled] : [idDir(key), bundled]
    for (const dir of locations) {
      if (!dir || !existsSync(dir)) continue
      const { manifest } = readManifest(dir, { id: key })
      if (manifest) return manifest.capabilities
    }
    return []
  }

  /** file 是不是在 root 目录里面（root 自己不算；越过 root 的 ../ 一律不算）。 */
  function inside(root, file) {
    const rel = relative(resolve(root), resolve(file))
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /**
   * 模块的面板代码（panel.js），面板拿去执行。
   * 内置模块也允许带面板：两者本来就是同一条加载链路，面板只需要「定义里声明了 panel」。
   * 面板文件从模块自己的文件夹读：用户模块在数据目录 modules/<id>，内置模块由装配层指定包根；
   * 两边都要求落在各自的根目录里，防止 panel 写成 ../../xxx 去读根目录外面的文件。
   */
  function panelSource(id) {
    // 主实例没跑、只有额外实例在跑时，面板代码也从同一个定义里取
    const rec = live.get(id) || [...live.values()].find((item) => item.moduleId === id && item.def.panel)
    if (!rec || !rec.def.panel) return null
    const root = rec.dir || userSeen.get(rec.moduleId)?.dir
    if (!root) return null
    const file = resolve(root, typeof rec.def.panel === 'string' ? rec.def.panel : 'panel.js')
    if (!inside(root, file) || !existsSync(file)) return null
    return readFileSync(file, 'utf8')
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

  const { installDocs, promptFor } = createDocs({ userDir, version })

  const publicHandle = { use: exportsOf, has: hasModule, list: () => status().map(({ id, name, running }) => ({ id, name, running })), emit }

  return {
    failedAdapters: () => [...errors].filter(([key, error]) => error.adapter && isEnabled(key.split('@')[0])).map(([key]) => key),
    adapterCatalog, fields, boot, sync, reload, dispose, status, create: createPlugin, remove: removeModule, promptFor, panelSource, reloadOnConfigChange,
    // 对外按模块 id 停 —— 一起停掉它的额外实例
    stop: (id, options) => stopModule(id, options),
    use: exportsOf, has: hasModule, running: (id) => live.get(id)?.source || null, generation: () => generation,
    services: {
      get: (name: string) => services.get(name),
      has: (name: string) => services.has(name),
      require: (name: string) => services.require(name),
      names: () => services.names(),
    },
    pages: () => [...pages.values()].sort((a, b) => a.order - b.order || a.path.localeCompare(b.path)),
    /** 某个模块正在跑的额外实例名（面板/调试用）。 */
    instances: (id) => [...live.values()].filter((rec) => rec.moduleId === id && rec.key !== id).map((rec) => rec.instance),
    capabilitiesOf,
    // 面板首屏提速：导航摘要（纯内存）与导航版本号（安装/启停/失败/重载时递增）
    summarizeModules, navigationRevision: () => navigationRevisionCounter,
    emit, emitAsync, claim, filter, filterSync, buildTools,
    // 插件核心自己听事件（不属于任何模块，不会被撤掉）
    listen: (event, fn) => events.subscribe('@core', event, fn), contextFor, rules, commands, dshTools, builtinOff, handle,
    hasRoute: (path) => routes.has(path),
    routeAccess: (path) => routes.get(path)?.access || null,
    dir: userDir,
  }
}
