// 模块清单：v2 读 package.json 的 `aurabot` 段，v1 回退 module.json。
// 面板、市场、加载器都走这一个函数，避免三处各读各的。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ModuleManifest {
  /** 对外 ID：平铺模块就是包名，装了 scope 的是 `owner/name` */
  id: string
  /** 收录地址里的作者，v1 模块没有 */
  owner: string
  /** 展示名 */
  name: string
  version: string
  description: string
  category: string
  platforms: string[]
  capabilities: string[]
  minPluginVersion: string
  api: number
  requires: string[]
  panel: string
  /** 入口绝对路径；找不到就是 '' */
  entry: string
  dir: string
  /** 清单来自哪儿 */
  source: 'package' | 'module.json'
}

export interface ManifestResult {
  manifest: ModuleManifest | null
  error: string
}

// 顺序即优先级：发行为主的 mjs / js 在前，TS 放最后 ——
// 只有「本地在写源码、还没构建」时才会落到 index.ts（加载时转成 JS 再跑）。
const LEGACY_ENTRY = ['index.mjs', 'index.js', 'index.ts']
const DEFAULT_PANEL = './dist/panel.js'
/** v2 的默认入口（和文档一致）；产物不存在时再回退旧入口，方便本地还没构建的情况。 */
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
    const file = join(dir, main)
    if (existsSync(file)) return file
  }
  for (const name of LEGACY_ENTRY) {
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  return ''
}

/** 宿主只跑 ESM。CommonJS 的入口早点拒绝，别等到 import 时报一句看不懂的错。 */
export function assertEsm(dir: string, entry: string): string {
  if (!entry) return '找不到入口文件（package.json 的 main，或 index.mjs / index.js）'
  if (/\.cjs$/i.test(entry)) return '入口是 CommonJS（.cjs），宿主只支持 ESM'
  const pkg = readJson(join(dir, 'package.json'))
  const type = str(pkg?.type).toLowerCase()
  if (type === 'commonjs' && /\.js$/i.test(entry)) {
    return 'package.json 里 type 是 commonjs，宿主只支持 ESM（把 type 改成 module，或用 .mjs）'
  }
  return ''
}

/**
 * 读一个模块目录的清单。v2（package.json.aurabot）优先，没有就回退 v1 的 module.json。
 * 两个都没有时返回 error，让调用方决定是跳过还是报错。
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
      platforms: strings(aurabot.platforms, ['qq']),
      capabilities: strings(aurabot.capabilities),
      minPluginVersion: str(aurabot.minPluginVersion),
      api: Number(aurabot.api ?? 2) || 2,
      requires: strings(aurabot.requires),
      panel: str(aurabot.panel, str(pkg.dsh?.client?.panel, DEFAULT_PANEL)),
      entry,
      dir,
      source: 'package',
    }
    // 常见情况：main 指向 lib/index.js，但本地还没构建。给出的是「入口问题」不是「清单问题」。
    const error = entry ? assertEsm(dir, entry) : `找不到入口文件（${DEFAULT_ENTRY} 还没构建？跑一次 npm run build）`
    return { manifest, error }
  }

  const legacy = readJson(join(dir, 'module.json'))
  if (!legacy) {
    return { manifest: null, error: '没有 package.json.aurabot，也没有 module.json' }
  }
  const id = options.id || str(legacy.id, '')
  const manifest: ModuleManifest = {
    id,
    owner: '',
    name: str(legacy.name, id),
    version: str(legacy.version, '0.0.0'),
    description: str(legacy.description),
    category: str(legacy.category, 'other'),
    platforms: strings(legacy.platforms, ['qq']),
    capabilities: strings(legacy.capabilities),
    minPluginVersion: str(legacy.minPluginVersion),
    api: Number(legacy.api ?? 1) || 1,
    requires: strings(legacy.requires),
    panel: str(legacy.panel, 'panel.js'),
    entry,
    dir,
    source: 'module.json',
  }
  return { manifest, error: entry ? '' : '找不到入口文件（index.mjs / index.js）' }
}
