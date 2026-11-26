// 模块的来源与定义：内置目录、用户目录、加载 lib、扫描定义、校验与 schema 默认值。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { entryOf as entryOfManifest } from '../config/manifest.ts'
import { dataDir } from '../store/index.ts'
import { ROOT } from '../support/root.ts'
import { createRequire } from 'node:module'

/** 扩展接口版本：只加不改。哪天不得不改已有的东西才升到 2，并在更新说明里写清楚怎么迁移。 */
export const API_VERSION = 2
export const MIN_API_VERSION = 1

/** 模块清单：内置模块的 def，或 v2 package.json.aurabot / v1 module.json 读出来的东西。 */
export interface ModuleDef {
  id: string
  name?: string
  description?: string
  version?: string
  api?: number
  /** 插件类型：`plugin` 普通插件 / `adapter` 适配器插件。 */
  kind?: 'plugin' | 'adapter'
  /** 允许多份配置；适配器默认 true。 */
  reusable?: boolean
  panel?: string
  capabilities?: string[]
  defaults?: Record<string, unknown>
  settings?: Array<{ key?: string; type?: string; label?: string; [key: string]: unknown }>
  files?: string[]
  config?: unknown
  apply?: (...args: never[]) => unknown
  setup?: (...args: never[]) => unknown
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
  /** 每轮回复前由模块追加的上下文片段（v1 的 context 钩子）。 */
  contexts: any[]
  /** 追加到系统提示的规则行（v1 的 rules 钩子）。 */
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
export interface ModuleError { message: string; at: number; source?: string; fallback?: boolean }

/** 磁盘上扫到的用户模块。 */
export interface UserModule { id: string; dir: string; safe?: boolean; version?: string; [key: string]: unknown }

export const SRC = fileURLToPath(new URL('../../', import.meta.url)) // 插件的 src/（发布态是 lib/src/）
export const BUILTIN_DIR = join(SRC, 'modules')
/** 内置模块目录（社区安装时判断会不会替换内置用）。 */
export const builtinDir = () => BUILTIN_DIR
// 平铺 id（v1 老模块）或 owner/name（v2 带 scope 安装）
export const ID_RE = /^[a-z][a-z0-9-]{1,39}(\/[a-z][a-z0-9-]{1,39})?$/
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

/** 内部源码全部按「相对 src 的路径」开放出来：lib('features/memory.js') → 那个文件导出的全部东西。 */
export const libCache = new Map()
export async function loadLib() {
  if (libCache.size) return libCache
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) { if (!['templates', 'separator', '_template'].includes(e.name)) walk(full) }
      else if (e.name.endsWith('.js') || e.name.endsWith('.ts')) files.push(full)
    }
  }
  walk(SRC)
  for (const f of files) {
    const key = relative(SRC, f).split(sep).join('/').replace(/\.ts$/, '.js')
    try { libCache.set(key, await import(pathToFileURL(f).href)) } catch (error) {}
  }
  return libCache
}
export function lib(key) {
  const k = String(key || '').replace(/^\.?\/?(src\/)?/, '')
  const hit = libCache.get(k) || libCache.get(k + '.js')
  if (!hit) throw new Error(`没有 ${key} 这个内部文件（看 API.md 的「内部源码」一节）`)
  return hit
}
export const libKeys = () => [...libCache.keys()].sort()

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
  let t = 0
  const files = filesOf(dir)
  for (const f of files) { try { t = Math.max(t, statSync(join(dir, f)).mtimeMs) } catch (error) {} }
  return Math.round(t) + files.length / 1000
}
/** 单个模块的版本戳：单文件插件只看它自己那一个文件，别被隔壁模块的改动带着重载。 */
export function stampOfTarget(u) {
  if (!u) return 0
  if (u.single) {
    try { return Math.round(statSync(u.file).mtimeMs) } catch (error) { return 0 }
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
    const own = existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'module.json')) || entryOf(dir)
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
  if (!def || (typeof def !== 'object' && typeof def !== 'function')) return '入口文件要 export default 一个对象或 apply 函数（看 API.md）'
  // v2：export default function apply(ctx, config) —— id 取文件夹名
  if (typeof def === 'function') {
    if (!id) return '函数形态的入口必须放在以模块 id 命名的文件夹里'
    if (!ID_RE.test(String(id))) return `模块 id「${id}」不对：小写字母开头，只能有小写字母、数字和 -，2~40 个字`
    return ''
  }
  if (typeof def.setup !== 'function' && typeof def.apply !== 'function') return '模块里没有 setup(api) 或 apply(ctx, config) 函数'
  if (!ID_RE.test(String(def.id || id || ''))) return `模块 id「${def.id ?? id ?? ''}」不对：小写字母开头，只能有小写字母、数字和 -，2~40 个字`
  // 带 scope 的安装目录是 modules/<owner>/<name>，入口里写 <name> 就行
  if (id && def.id && def.id !== id && def.id !== String(id).split('/').pop()) return `模块 id「${def.id}」要和文件夹名「${id}」一样`
  const want = Number(def.api ?? 1)
  if (want > API_VERSION) return `这个模块要扩展接口 v${want}，现在的插件只有 v${API_VERSION}，先更新插件`
  if (want < MIN_API_VERSION) return `这个模块是按扩展接口 v${want} 写的，现在最低支持 v${MIN_API_VERSION}，按更新说明改一下`
  return ''
}

/**
 * 没有 default 导出时，从具名导出拼一个模块定义。
 *
 * 模板仓库 / Koishi 的习惯是 `export const name` + `export const config` + `export function apply`，
 * 没有默认导出；这里把这种写法也认成模块，省得每个插件都改一遍。
 */
export function namedModuleDef(mod) {
  if (!mod) return undefined
  const apply = typeof mod.apply === 'function' ? mod.apply : typeof mod.setup === 'function' ? mod.setup : null
  if (!apply) return undefined
  const raw = {
    name: mod.name,
    description: mod.description,
    version: mod.version,
    // 插件类型与多实例：模板仓库用「具名导出」写法（export const kind/reusable），
    // 漏了这几个字段会让适配器在面板里变成普通插件、reusable 也永远起不来第二份配置。
    kind: mod.kind,
    reusable: mod.reusable,
    reloadOnConfig: mod.reloadOnConfig,
    panel: mod.panel,
    tab: mod.tab,
    navGroup: mod.navGroup,
    platforms: mod.platforms,
    config: mod.config,
    defaults: mod.defaults,
    settings: mod.settings,
    capabilities: mod.capabilities,
    api: mod.api,
    apply: mod.apply,
    setup: mod.setup,
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
      type: flags.includes('role:secret') ? 'password'
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

/** 把一份源码里指向插件内部的相对 import 改成走 lib()，这样复制出去也能跑。 */
export function rewriteImports(code, fromKey, keep = new Set()) {
  const base = fromKey.split('/').slice(0, -1)
  const target = (spec) => {
    if (!/^\.\.?\//.test(spec)) return null
    const parts = [...base]
    for (const seg of spec.split('/')) {
      if (seg === '..') parts.pop()
      else if (seg !== '.') parts.push(seg)
    }
    const key = parts.join('/').replace(/\.ts$/, '.js')
    return keep.has(key) ? null : key
  }
  const names = (list) => list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ')
  let out = code.replace(/import\s+(\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (m, def, list, spec) => {
    const key = target(spec)
    if (!key) return m
    const d = def ? `const ${def.replace(/[\s,]/g, '')} = __lib('${key}').default\n` : ''
    return `${d}const { ${names(list)} } = __lib('${key}')`
  })
  out = out.replace(/import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (m, name, spec) => {
    const key = target(spec)
    return key ? `const ${name} = __lib('${key}')` : m
  })
  out = out.replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (m, name, spec) => {
    const key = target(spec)
    return key ? `const ${name} = __lib('${key}').default` : m
  })
  out = out.replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g, (m, spec) => {
    const key = target(spec)
    return key ? `Promise.resolve(__lib('${key}'))` : m
  })
  // 插件里带的数据文件（new URL('./x.py', import.meta.url)）：指回插件目录
  out = out.replace(/new URL\(\s*['"](\.\.?\/[^'"]*)['"]\s*,\s*import\.meta\.url\s*\)/g, (m, spec) => {
    const key = target(spec)
    return key ? `new URL('${key}', globalThis.aurabot.src)` : m
  })
  if (out !== code) out = "const __lib = globalThis.aurabot.lib // 插件内部源码（复制出来后靠它找到插件里的文件）\n" + out
  return out
}

/**
 * @param {object} o
 * @param {object} o.ctx        DSH 给插件的 ctx
 * @param {object} o.core       核心对象（hub、onebot、snowluma、local……），模块通过 api.core 拿到
 * @param {Function} o.getConfig
 * @param {Function} o.setConfig
 * @param {object} o.logger
 * @param {string} o.version     插件版本
 * @param {object[]} o.builtins  内置模块定义（按启动顺序）
 */
// ── 出站治理（主动发言策略的模块侧接线，见 docs/OUTBOUND-POLICY-DESIGN.md / CONTRACT §5）──
// 第一道判定放在**模块包装层**：模块的每次发送都带上宿主绑定的 moduleId 去问策略，
// 放行才真的调 hub；hub 侧的 setOutboundGuard 是第二道保险（覆盖任何绕过包装层的直调）。
// 未注入服务（core.outbound 缺失：旧环境 / 纯测试）时全部返回放行 —— 完全惰性、零开销。
