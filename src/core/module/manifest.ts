// 模块清单：只读 package.json 的 `aurabot` 段。
// 面板、市场、加载器都走这一个函数，避免三处各读各的。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface ModuleManifest {
  /** 对外 ID：平铺模块就是包名，装了 scope 的是 `owner/name` */
  id: string
  /** 收录地址里的作者 */
  owner: string
  /** 展示名 */
  name: string
  version: string
  description: string
  category: string
  /** 插件类型：普通插件 `plugin`，适配器插件 `adapter`（市场/面板据此分组）。 */
  kind: 'plugin' | 'adapter'
  /** 允许多份配置。适配器默认允许（同平台多账号），普通插件默认单实例。 */
  reusable: boolean
  platforms: string[]
  capabilities: string[]
  minPluginVersion: string
  api: number
  inject: string[]
  requires: string[]
  panel: string
  /** 面板保存设置后要不要重载这个模块（apply 里的 config 才会是新的）。默认 false。 */
  reloadOnConfig: boolean
  /** 入口绝对路径；找不到就是 '' */
  entry: string
  dir: string
}

export interface ManifestResult {
  manifest: ModuleManifest | null
  error: string
}

// 顺序即优先级：发行为主的 mjs / js 在前，TS 放最后 ——
// 只有「本地在写源码、还没构建」时才会落到 index.ts（加载时转成 JS 再跑）。
const FALLBACK_ENTRY = ['index.mjs', 'index.js', 'index.ts', 'src/index.ts']
const DEFAULT_PANEL = './dist/panel.js'
/** 默认入口；产物不存在时再回退到源码入口，方便本地还没构建的情况。 */
const DEFAULT_ENTRY = 'lib/index.js'

function readJson(file: string): any {
  try {
    if (!existsSync(file)) return null
    if (!statSync(file).isFile()) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function strings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : fallback
}

/** 模块入口：package.json 的 main 优先，其次 index.mjs / index.js。 */
export function entryOf(dir: string): string {
  const pkg = readJson(join(dir, 'package.json'))
  const main = str(pkg?.main)
  if (main) {
    const file = resolve(dir, main)
    const path = relative(dir, file)
    if (!path || path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return ''
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  for (const name of FALLBACK_ENTRY) {
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  return ''
}

/** 宿主只跑 ESM。CommonJS 的入口早点拒绝，别等到 import 时报一句看不懂的错。 */
export function assertEsm(dir: string, entry: string): string {
  if (!entry) return '找不到入口文件（package.json 的 main，或 index.mjs / index.js）'
  if (/\.c(?:js|ts)$/i.test(entry)) return '入口是 CommonJS，宿主只支持 ESM（.ts、.mjs 或 type: module 的 .js）'
  const pkg = readJson(join(dir, 'package.json'))
  const type = str(pkg?.type).toLowerCase()
  if (type === 'commonjs' && /\.(?:js|ts)$/i.test(entry)) {
    return 'package.json 里 type 是 commonjs，宿主只支持 ESM（把 type 改成 module，或用 .mjs）'
  }
  return ''
}

/**
 * 读一个模块目录的清单。只认 package.json.aurabot。
 * 没有时返回 error，让调用方决定是跳过还是报错。
 */
export function readManifest(dir: string, options: { id?: string } = {}): ManifestResult {
  const pkg = readJson(join(dir, 'package.json'))
  const aurabot = pkg && typeof pkg.aurabot === 'object' && pkg.aurabot ? pkg.aurabot : null
  const entry = entryOf(dir)

  if (pkg && aurabot) {
    const name = str(pkg.name)
    const scope = name.startsWith('@') && name.includes('/') ? name.slice(1).split('/')[0] : ''
    const flat = name.includes('/') ? name.split('/').pop() || '' : name
    const owner = str(aurabot.owner, scope)
    const id = options.id || (owner ? `${owner}/${flat}` : flat)
    const manifest: ModuleManifest = {
      id,
      owner,
      name: str(aurabot.displayName, flat || id),
      version: str(pkg.version, '0.0.0'),
      description: str(pkg.description),
      category: str(aurabot.category, 'other'),
      kind: str(aurabot.kind) === 'adapter' ? 'adapter' : 'plugin',
      reusable: aurabot.reusable === undefined ? str(aurabot.kind) === 'adapter' : aurabot.reusable === true,
      platforms: strings(aurabot.platforms, Number(aurabot.api ?? 2) >= 2 ? ['*'] : ['qq']),
      capabilities: strings(aurabot.capabilities),
      minPluginVersion: str(aurabot.minPluginVersion),
      api: Number(aurabot.api ?? 2) || 2,
      requires: strings(aurabot.requires),
      inject: strings(aurabot.inject),
      panel: str(aurabot.panel, str(pkg.dsh?.client?.panel, DEFAULT_PANEL)),
      reloadOnConfig: aurabot.reloadOnConfig === true,
      entry,
      dir,
    }
    // 常见情况：main 指向 lib/index.js，但本地还没构建。给出的是「入口问题」不是「清单问题」。
    const error = entry ? assertEsm(dir, entry) : `找不到入口文件（${DEFAULT_ENTRY} 还没构建？跑一次 npm run build）`
    return { manifest, error }
  }

  return { manifest: null, error: '没有 package.json.aurabot' }
}
