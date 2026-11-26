// 插件发现、清单及入口契约。

import type { ServiceError } from '../service/registry.ts'
import type { SettingsField } from '../config/shape/schema.ts'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryOf as entryOfManifest } from './manifest.ts'
import { dataDir } from '../store/index.ts'
import { createHash } from 'node:crypto'

/** 扩展接口版本。v2 起不再兼容 v1 的 api 对象。 */
export const API_VERSION = 2
export const MIN_API_VERSION = 2

/** 模块清单：内置模块的 def，或 package.json.aurabot 读出来的东西。 */
export interface ModuleDef {
  id: string
  name?: string
  description?: string
  version?: string
  api?: number
  /** 插件类型：`plugin` 普通插件 / `adapter` 适配器插件。 */
  packageDir?: string
  kind?: 'plugin' | 'adapter'
  /** 允许多份配置；适配器默认 true。 */
  reusable?: boolean
  panel?: string
  inject?: string[]
  capabilities?: string[]
  defaults?: Record<string, unknown>
  settings?: Array<Omit<Partial<SettingsField>, 'type'> & { type?: string }>
  config?: unknown
  apply?: (...args: never[]) => unknown
  [key: string]: unknown
}

/** 运行中的一个模块实例。 */
export interface ModuleRecord {
  /** 注册表键。主实例等于模块 id；额外实例是 `id@实例名`，这样老接口、老配置路径都不用动。 */
  key: string
  /** 模块 id。同一份插件的所有实例共用一个 moduleId。 */
  moduleId: string
  /** 额外实例名；主实例没有这个字段。 */
  instance?: string
  id: string
  def: ModuleDef
  source: 'builtin' | 'user'
  exports: Record<string, any> | null
  offs: Array<() => void>
  tools: any[]
  /** 每轮回复前由模块追加的上下文片段。 */
  contexts: any[]
  /** 追加到系统提示的规则行。 */
  rules: any[]
  commands: Array<{ name: string; [key: string]: unknown }>
  dshTools: any[]
  errors: any[]
  startedAt: number
  /** 用户模块的文件夹。 */
  dir?: string
  /** 停止过程中：启动流程看到就别再往下走。 */
  stopped?: boolean
  /** 正在清理：清理过程中重复触发要跳过。 */
  cleaning?: boolean
  /** 用户模块起不来时回落成内置的。 */
  fallback?: boolean
  /** 替换内置模块时记下的内置版本。 */
  replaces?: string
}

/** 启动失败 / 加载失败。 */
export interface ModuleError { service?: ServiceError; adapter?: boolean; message: string; at: number; source?: string; fallback?: boolean }

/** 磁盘上扫到的用户模块。 */
export interface UserModule { id: string; dir: string; safe?: boolean; version?: string; [key: string]: unknown }

export const REPO = fileURLToPath(new URL('../../..', import.meta.url)) // 插件根（发布态是 lib/）
export const PKG = join(REPO, 'packages') // 插件与适配器包（发布态是 lib/packages/）
export const BUILTIN_DIR = join(PKG, 'modules')
/** 内置模块目录（社区安装时判断会不会替换内置用）。 */
export const builtinDir = () => BUILTIN_DIR

// 平铺 id 或 owner/name（带 scope 安装）
export const ID_RE = /^(?:[a-z][a-z0-9-]{1,39}|[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,39})$/
export const DOC = 'API.md'
export const TYPES = 'aurabot.d.ts'
// 文档与类型声明放在 sdk/ 下：内置模块目录只留实现，用户目录仍拿平铺文件名。
export const DOC_SRC = 'sdk/API.md'
export const TYPES_SRC = 'sdk/aurabot.d.ts'
// 从内置搬到社区库的模块：接口路径不变，面板页照常能用
export const STABLE_ROUTES = new Set(['pet', 'douyin', 'heybox', 'group-admin'])

export const userDir = () => dataDir('modules')
/** id → 安装目录：平铺的在 modules/<id>，带 scope 的在 modules/<owner>/<name>。 */
export const idDir = (id) => join(userDir(), ...String(id || '').split('/'))

/** 额外实例的注册表键。模块 id 不含 `@`（ID_RE 管着），所以不会歧义。 */
export const instanceKey = (id: string, instance: string) => `${id}@${instance}`
/** 实例名：小写字母数字开头，允许字母数字、`-`、`_`，最长 40。 */
export const INSTANCE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i

// 加载自己写的模块时跳过的目录：依赖、加载快照、版本库
export const SKIP_DIRS = new Set(['node_modules', '.aurabot-cache', '.git'])
export const SNAP = '.aurabot-cache'

/** 模块文件夹里所有文件（含子目录，不含依赖和快照）。 */
export function filesOf(dir, base = dir, out = []) {
  let list = []
  try { list = readdirSync(dir, { withFileTypes: true }) } catch (error) { return out }
  for (const e of list) {
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) filesOf(full, base, out) }
    else if (e.isFile()) out.push(relative(base, full))
  }
  return out
}

/** 模块的「版本戳」：任何文件改了、加了、删了都会变。 */
export function stampOf(dir) {
  const hash = createHash('sha256')
  for (const f of filesOf(dir).sort()) {
    try {
      const stat = statSync(join(dir, f), { bigint: true })
      hash.update(JSON.stringify([f, String(stat.mtimeNs), String(stat.ctimeNs), String(stat.size)]))
    } catch { hash.update(JSON.stringify([f, null])) }
  }
  return hash.digest('hex')
}
/** 单个模块的版本戳：单文件插件只看它自己那一个文件，别被隔壁模块的改动带着重载。 */
export function stampOfTarget(u) {
  if (!u) return ''
  if (u.single) {
    try { return String(statSync(u.file, { bigint: true }).ctimeNs) } catch { return '' }
  }
  return stampOf(u.dir)
}
// 入口：package.json 的 main 优先，其次 index.mjs / index.js（见 core/manifest.ts）
export const entryOf = (dir) => entryOfManifest(dir)

/**
 * 数据目录 modules/ 里有哪些模块（目录名以 _ 或 . 开头的跳过）：[{ id, dir, file }]
 * 三种布局：
 * - modules/<id>/            普通多文件模块
 * - modules/<owner>/<name>/  带 scope 的模块（id 是 owner/name）
 * - modules/<id>.mjs         单文件插件（只认 ESM；写起来就是一个 apply 函数）
 */
export function scanUser() {
  const out = []
  const root = userDir()
  let names = []
  try { names = readdirSync(root, { withFileTypes: true }) } catch (error) { return out }
  const push = (dir, id) => {
    const file = entryOf(dir)
    if (file) out.push({ id, dir, file })
  }
  for (const e of names) {
    if (/^[_.]/.test(e.name)) continue
    // 单文件插件：直接躺在 modules/ 下的 .mjs。
    // 不认 .js —— 用户目录里没有 package.json 兜 type，.js 会被 Node 当成 CommonJS，import 必炸。
    if (!e.isDirectory()) {
      if (!e.isFile() || !e.name.endsWith('.mjs')) continue
      const id = e.name.slice(0, -4)
      if (!ID_RE.test(id)) continue
      out.push({ id, dir: root, file: join(root, e.name), single: true })
      continue
    }
    const dir = join(root, e.name)
    // 自己有清单/入口 → 平铺模块；否则看它是不是 scope 目录（modules/<owner>/<name>）
    const own = existsSync(join(dir, 'package.json')) || entryOf(dir)
    if (own) { push(dir, e.name); continue }
    let subs = []
    try { subs = readdirSync(dir, { withFileTypes: true }) } catch (error) { continue }
    for (const sub of subs) {
      if (!sub.isDirectory() || /^[_.]/.test(sub.name)) continue
      push(join(dir, sub.name), `${e.name}/${sub.name}`)
    }
  }
  return out
}

/** 检查模块定义，返回出错原因（没问题返回空串）。 */
export function checkDef(def, id) {
  if (!def || typeof def !== 'object') return '入口要具名导出 apply(ctx, config)（看 API.md）'
  if (typeof def.apply !== 'function') return '模块里没有 apply(ctx, config) 函数'
  if (!ID_RE.test(String(def.id || id || ''))) return `模块 id「${def.id ?? id ?? ''}」不对：小写字母开头，只能有小写字母、数字和 -，2~40 个字`
  // 带 scope 的安装目录是 modules/<owner>/<name>，入口里写 <name> 就行
  if (id && def.id && def.id !== id && def.id !== String(id).split('/').pop()) return `模块 id「${def.id}」要和文件夹名「${id}」一样`
  if (def.inject !== undefined && (!Array.isArray(def.inject) || def.inject.some(name => typeof name !== 'string' || !name.trim()))) return 'inject 应为服务名称数组'
  const want = Number(def.api ?? API_VERSION)
  if (want > API_VERSION) return `这个模块要扩展接口 v${want}，现在的插件只有 v${API_VERSION}，先更新插件`
  if (want < MIN_API_VERSION) return `这个模块是按扩展接口 v${want} 写的，现在最低支持 v${MIN_API_VERSION}，按更新说明改一下`
  return ''
}

/** 具名导出 → 模块定义。和 Koishi 一样：name / Config / apply，id 取文件夹名。 */
export function namedModuleDef(mod) {
  if (!mod) return undefined
  const apply = typeof mod.apply === 'function' ? mod.apply : null
  if (!apply) return undefined
  const raw = {
    name: mod.name,
    description: mod.description ?? mod.usage,
    version: mod.version,
    kind: mod.kind,
    reusable: mod.reusable,
    reloadOnConfig: mod.reloadOnConfig,
    panel: mod.panel,
    tab: mod.tab,
    navGroup: mod.navGroup,
    platforms: mod.platforms,
    config: mod.config ?? mod.Config,
    defaults: mod.defaults,
    settings: mod.settings,
    capabilities: mod.capabilities,
    inject: mod.inject,
    api: mod.api,
    apply: mod.apply,
  }
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined))
}

/**
 * 从「别人家的 Schema」里捞默认值。
 *
 * 插件模板带的是自己实现的 Schema（`{ meta: { type, default, dict } }`），不是宿主的 Schema；
 * 不认它的话 `config.enabled` 会是 undefined，插件一上来就是关着的。
 * 这里只做一件保守的事：把 meta.default 一层层拼出来，面板存过的值仍然覆盖它。
 */
export function schemaDefaults(schema) {
  if (!schema || typeof schema !== 'object') return undefined
  const meta = (schema as { meta?: any }).meta
  if (!meta || typeof meta !== 'object') return undefined
  if (meta.type === 'object' && meta.dict && typeof meta.dict === 'object') {
    const out = {}
    for (const [key, sub] of Object.entries(meta.dict)) out[key] = schemaDefaults(sub)
    return out
  }
  return meta.default
}

/**
 * 把「别人家的 Schema」（模板仓库 plugin-api.js 里那份 `{ meta: { type, dict, flags } }`）
 * 翻成面板的 settings 字段。
 *
 * 宿主自己的 Schema 有 toSettings()；外部插件带的是精简版，不认它的话
 * 适配器的 endpoint / token 这类字段在面板里一个都不显示。
 */
function hasSecretMeta(meta): boolean {
  if (!meta || typeof meta !== 'object') return false
  return Boolean(meta.flags?.includes('role:secret') || Object.values(meta.dict || {}).some(node => hasSecretMeta(node?.['meta'])) || hasSecretMeta(meta.items?.meta))
}

export function settingsFromMeta(schema) {
  const meta = schema && typeof schema === 'object' ? (schema as { meta?: any }).meta : undefined
  if (!meta || meta.type !== 'object' || !meta.dict || typeof meta.dict !== 'object') return []
  const fields = []
  for (const [key, node] of Object.entries(meta.dict)) {
    const sub = node && typeof node === 'object' ? (node as { meta?: any }).meta : undefined
    if (!sub) continue
    const flags = Array.isArray(sub.flags) ? sub.flags.map(String) : []
    const field: Record<string, unknown> = {
      key,
      label: sub.description || key,
      type: hasSecretMeta(sub) ? 'password'
        : sub.type === 'boolean' ? 'switch'
          : sub.type === 'number' ? 'number'
            : sub.type === 'union' ? 'select'
              : 'text',
    }
    if (sub.description) field.hint = sub.description
    if (sub.default !== undefined) field.default = sub.default
    if (sub.min !== undefined) field.min = sub.min
    if (sub.max !== undefined) field.max = sub.max
    if (sub.type === 'union' && Array.isArray(sub.options)) {
      field.options = sub.options.map((item) => (item && typeof item === 'object' && 'value' in item
        ? { value: String(item.value), label: String(item.label ?? item.value) }
        : { value: String(item), label: String(item) }))
    }
    if (flags.includes('hidden')) field.hidden = true
    if (flags.includes('experimental')) field.experimental = true
    if (flags.includes('deprecated')) field.deprecated = true
    fields.push(field)
  }
  return fields
}

