import findChrome from 'puppeteer-finder'
import { executable } from './executable.ts'

export interface BrowserCandidate { path: string; source: string }
const overrides = ['AURABOT_BROWSER', 'PUPPETEER_EXECUTABLE_PATH', 'CHROME_PATH']
let cache: BrowserCandidate[] | undefined

export function findBrowsers(refresh = false): BrowserCandidate[] {
  if (cache && !refresh) return cache.slice()
  const found = new Map<string, BrowserCandidate>()
  const add = (path: string, source: string) => {
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (path && !found.has(key) && executable(path)) found.set(key, { path, source })
  }
  for (const env of overrides) add(process.env[env]?.trim() || '', 'env:' + env)
  try { add(findChrome(), 'puppeteer-finder') } catch {}
  cache = [...found.values()]
  return cache.slice()
}

export function findBrowser(refresh = false) { return findBrowsers(refresh)[0]?.path ?? null }

export function browserStatus() {
  const candidates = findBrowsers()
  return { found: Boolean(candidates.length), path: candidates[0]?.path || '', candidates,
    message: candidates.length ? '' : '请在本机安装 Chrome 或 Edge，也可用 AURABOT_BROWSER 指定可执行文件。' }
}
