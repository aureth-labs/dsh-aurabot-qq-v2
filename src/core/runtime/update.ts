const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z.-]+)?$/i

export function compareVersions(a: string, b: string) {
  const parts = (v: string) => String(v ?? '').split('+', 1)[0].match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/)
  const left = parts(a), right = parts(b)
  if (!left || !right) return 0
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i])
    if (diff) return diff
  }
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4])
  const x = left[4].split('.'), y = right[4].split('.')
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i])
    if (xn && yn) return Number(x[i]) - Number(y[i])
    if (xn !== yn) return xn ? -1 : 1
    return x[i] < y[i] ? -1 : 1
  }
  return x.length - y.length
}

export const wantsUnstable = (choice: unknown, version: string) => typeof choice === 'boolean' ? choice : version.split('+')[0].includes('-')

interface Options {
  pkg: { name: string; version: string }
  log?: { debug(...args: unknown[]): void }
  fetchImpl?: typeof fetch
  unstable?: () => boolean | null
}
interface Release {
  ok: boolean
  current: string
  latest: string
  newer: boolean
  channel: string
  message?: string
}

export function createUpdateChecker({ pkg, log, fetchImpl = fetch, unstable = () => null }: Options) {
  const cache = new Map<boolean, { until: number; value: Promise<Release> }>()
  async function lookup(preview: boolean): Promise<Release> {
    const result = { current: pkg.version, latest: '', newer: false, channel: preview ? 'preview' : 'latest' }
    try {
      const url = 'https://registry.npmjs.org/-/package/' + encodeURIComponent(pkg.name) + '/dist-tags'
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
      if (response.status === 404) return { ...result, ok: true, message: '此包尚无 npm 发布记录' }
      if (!response.ok) throw Error('HTTP ' + response.status)
      const tags = await response.json() as Record<string, unknown>
      const versions = (preview ? ['latest', 'next', 'beta', 'rc'] : ['latest']).map(tag => tags[tag])
        .filter((v): v is string => typeof v === 'string' && VERSION.test(v) && (preview || !wantsUnstable(null, v)))
      const latest = versions.sort(compareVersions).at(-1) || ''
      return { ...result, ok: true, latest, newer: Boolean(latest && compareVersions(latest, pkg.version) > 0),
        ...(!latest && { message: '当前订阅的渠道尚无版本' }) }
    } catch (error) {
      log?.debug('npm 版本检查失败', String(error))
      return { ...result, ok: false, message: '无法读取 npm 版本信息' }
    }
  }
  return async function check({ force = false } = {}) {
    const preview = wantsUnstable(unstable(), pkg.version)
    const old = cache.get(preview)
    if (old && (old.until === Infinity || (!force && old.until > Date.now()))) return old.value
    const entry = { until: Infinity, value: lookup(preview) }
    cache.set(preview, entry)
    const result = await entry.value
    entry.until = Date.now() + (result.ok ? 6 * 3600_000 : 60_000)
    return result
  }
}

export function changelogSection(text: string, version: string) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.match(/^##\s+v?([^\s]+)(?:\s|$)/)?.[1] === version)
  if (start < 0) return ''
  const end = lines.findIndex((line, i) => i > start && /^##\s/.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}
