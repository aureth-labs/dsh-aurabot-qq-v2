// 找本机的浏览器：扫码登录 B 站 / 网易云、复用登录态都要开一个真浏览器。
//
// 顺序：
// 1. 环境变量（用户明确指定，永远优先）：AURABOT_BROWSER / PUPPETEER_EXECUTABLE_PATH / CHROME_PATH
// 2. `puppeteer-finder`（optionalDependency，跨平台，认 Windows 注册表）
// 3. 手写常见安装路径（兜底：没装 optional 依赖、或 finder 认不出来时）
//
// 找不到就返回空数组，**不抛错**——调用方自己决定是提示用户手填 Cookie 还是报错。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface BrowserCandidate {
  path: string
  /** 从哪找到的：env / puppeteer-finder / 内置路径表 */
  source: string
}

const require = createRequire(import.meta.url)

const ENV_KEYS = ['AURABOT_BROWSER', 'PUPPETEER_EXECUTABLE_PATH', 'CHROME_PATH']

let cache: BrowserCandidate[] | null = null

function fromEnv(): BrowserCandidate[] {
  const out: BrowserCandidate[] = []
  for (const key of ENV_KEYS) {
    const value = String(process.env[key] || '').trim()
    if (value) out.push({ path: value, source: `env:${key}` })
  }
  return out
}

function fromFinder(): BrowserCandidate[] {
  try {
    const find = require('puppeteer-finder')
    const found = typeof find === 'function' ? find() : null
    const list = Array.isArray(found) ? found : found ? [found] : []
    return list.map((item: unknown) => String(item || '')).filter(Boolean).map((path: string) => ({ path, source: 'puppeteer-finder' }))
  } catch {
    // 没装这个 optional 依赖、或者本机一个浏览器都没有：都算「这条路过不去」
    return []
  }
}

function commonPaths(): string[] {
  const programFiles = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean) as string[]
  const win = [
    'Google\\Chrome\\Application\\chrome.exe',
    'Google\\Chrome Beta\\Application\\chrome.exe',
    'Microsoft\\Edge\\Application\\msedge.exe',
    'Chromium\\Application\\chrome.exe',
  ]
  const winPaths = programFiles.flatMap((base) => win.map((rest) => join(base, rest)))
  const macPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ]
  return [...winPaths, ...macPaths, ...linuxPaths]
}

function uniq(list: BrowserCandidate[]): BrowserCandidate[] {
  const seen = new Set<string>()
  const out: BrowserCandidate[] = []
  for (const item of list) {
    const key = item.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * 本机所有能找到的浏览器，顺序即优先级。
 * @param refresh 传 true 重新探测（默认第一次的结果会缓存，面板轮询不用每次扫盘）
 */
export function findBrowsers(refresh = false): BrowserCandidate[] {
  if (cache && !refresh) return cache
  const found = uniq([
    ...fromEnv(),
    ...fromFinder(),
    ...commonPaths().map((path) => ({ path, source: '内置路径表' })),
  ]).filter((item) => {
    try {
      return existsSync(item.path)
    } catch {
      return false
    }
  })
  cache = found
  return found
}

/** 最优先的那个；一个都没有返回 null。 */
export function findBrowser(refresh = false): string | null {
  return findBrowsers(refresh)[0]?.path ?? null
}

/** 面板展示用：只给路径和来源，不含任何用户数据。 */
export function browserStatus() {
  const list = findBrowsers()
  return { found: list.length > 0, path: list[0]?.path ?? '', candidates: list }
}
