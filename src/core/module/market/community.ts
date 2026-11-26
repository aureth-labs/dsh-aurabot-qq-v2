import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from '../../store/index.ts'
import { compareVersions } from '../../runtime/update.ts'
import type { AurabotConfig } from '../../config/index.ts'
import type { AreaLogger } from '../../support/log/logger.ts'
import { API_VERSION, ID_RE, idDir, userDir } from '../loader.ts'
import { readManifest } from '../manifest.ts'
import { MAX_ZIP_BYTES, parseCatalog, REGISTRY_URL, type CommunityIndex, type CommunityModuleEntry } from './catalog.ts'
import { readZip } from './zip.ts'

export { REGISTRY_URL, PAGES_URL } from './catalog.ts'
export { readZip, compareVersions }
export const SOURCE_FILE = '.aurabot-source.json'

interface Source { id: string; version: string; sha256: string }
interface ModuleStatus { id: string; name: string; enabled?: boolean; error?: string; description?: string }
interface MarketModules {
  status(): ModuleStatus[]
  sync(): Promise<unknown>
  stop(id: string): unknown
}
export interface CommunityDeps {
  mods: MarketModules
  getConfig(): AurabotConfig
  setConfig(config: AurabotConfig): void
  log: AreaLogger
  version: string
  registryUrl?: string
  fetcher?: typeof fetch
  retryMs?: number
}
interface Progress { id: string; name: string; stage: 'index' | 'download' | 'install' | 'start'; received: number; total: number }

function readSource(id: string): Source | undefined {
  if (!ID_RE.test(id)) return
  try {
    const source = JSON.parse(readFileSync(join(idDir(id), SOURCE_FILE), 'utf8')) as Source
    if (source.id === id && typeof source.version === 'string') return source
  } catch {}
}

function directory(path: string) {
  mkdirSync(path, { recursive: true })
  if (!lstatSync(path).isDirectory()) throw new Error('插件目录不能是链接')
}

export function createCommunity({ mods, getConfig, setConfig, log, version, registryUrl, fetcher = fetch, retryMs = 1000 }: CommunityDeps) {
  let cache: { at: number; url: string; index: CommunityIndex } | undefined
  let busy = false
  let progress: Progress | null = null
  const registry = () => registryUrl || String(getConfig().ext?.market?.registryUrl || process.env.AURABOT_REGISTRY_URL || REGISTRY_URL).trim()

  async function fetchResponse(url: string, timeout: number) {
    const get = () => fetcher(url, { signal: AbortSignal.timeout(timeout), headers: { 'cache-control': 'no-cache' } })
    let response: Response
    try { response = await get() } catch {
      await new Promise(done => setTimeout(done, retryMs))
      response = await get()
    }
    if (!response.ok) throw new Error('市场请求失败，HTTP ' + response.status)
    return response
  }

  async function loadIndex(force: boolean) {
    const url = registry()
    if (!force && cache?.url === url && Date.now() - cache.at < 300_000) return cache.index
    const index = parseCatalog(await (await fetchResponse(url, 20_000)).json())
    cache = { index, url, at: Date.now() }
    return index
  }

  function blocked(index: CommunityIndex, entry: CommunityModuleEntry) {
    if (entry.api !== API_VERSION) return '需要插件接口 v' + entry.api + '，当前接口为 v' + API_VERSION
    if (compareVersions(entry.minPluginVersion, version) > 0) return '需要 AuraBot ' + entry.minPluginVersion + ' 或更新版本'
    const revoked = index.revoked?.find(r => r.id === entry.id && r.versions.includes(entry.version))
    if (revoked) return '发行版已撤回：' + revoked.reason
    const installed = new Set(mods.status().map(m => m.id))
    const missing = entry.requires?.filter(id => !installed.has(id))
    return missing?.length ? '要先装：' + missing.join('、') : ''
  }

  async function list({ force = false } = {}) {
    const index = await loadIndex(force)
    const entries = index.entries.map(entry => {
      const installed = readSource(entry.id)?.version || ''
      return { ...entry, name: entry.displayName || entry.name, installed, foreign: !installed && existsSync(idDir(entry.id)),
        update: Boolean(installed && compareVersions(entry.version, installed) > 0), blocked: blocked(index, entry) }
    })
    const ids = new Set(entries.map(entry => entry.id))
    const delisted = mods.status().flatMap(m => {
      const source = ids.has(m.id) ? undefined : readSource(m.id)
      return source ? [{ id: m.id, name: m.name, version: source.version, installed: source.version, delisted: true, description: m.description }] : []
    })
    const revoked = (index.revoked || []).flatMap(r => {
      const installed = readSource(r.id)?.version
      return installed && r.versions.includes(installed) ? [{ id: r.id, version: installed, reason: r.reason }] : []
    })
    return { list: [...entries, ...delisted], revoked, generatedAt: index.generatedAt, downloads: { at: 0, source: '' } }
  }

  async function download(entry: CommunityModuleEntry, registryUrl: string) {
    const { url, size, sha256 } = entry.artifact
    progress = { id: entry.id, name: entry.displayName || entry.name, stage: 'download', total: size, received: 0 }
    const mirror = entry.artifact.mirror
    let response: Response
    if (mirror) {
      try { response = await fetchResponse(new URL(mirror,registryUrl).href, 120_000) }
      catch { response = await fetchResponse(url, 120_000) }
    } else response = await fetchResponse(url, 120_000)
    if (!response.body) throw new Error('安装包为空')
    const chunks: Uint8Array[] = []
    for await (const chunk of response.body) {
      progress.received += chunk.byteLength
      if (progress.received > size || progress.received > MAX_ZIP_BYTES) throw new Error('安装包大小与索引不符')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('安装包校验不通过')
    return readZip(bytes)
  }

  async function exclusive(action: () => Promise<{ ok: boolean; message: string; archive?: string }>) {
    if (busy) return { ok: false, message: '上一个操作还没做完，稍等' }
    busy = true
    try { return await action() } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('模块市场操作失败：', message)
      return { ok: false, message }
    } finally { busy = false; progress = null }
  }

  const install = (id: string, _options?: { confirmReplace?: boolean }) => exclusive(async () => {
    if (!ID_RE.test(id) || !id.includes('/')) throw new Error('请输入市场插件的 owner/name')
    progress = { id, name: id, stage: 'index', received: 0, total: 0 }
    const catalogUrl = registry()
    const index = await loadIndex(true)
    const entry = index.entries.find(e => e.id === id)
    if (!entry) throw new Error('社区库里没有「' + id + '」')
    const why = blocked(index, entry)
    if (why) throw new Error(why)
    const target = idDir(id)
    directory(userDir())
    const parent = dirname(target)
    directory(parent)
    if (readManifest(parent).manifest) throw new Error('作者目录已被本地插件占用')
    if (existsSync(target) && (!lstatSync(target).isDirectory() || !readSource(id))) throw new Error('这是你自己的文件夹，请先移走它')
    const files = await download(entry, catalogUrl)
    progress.stage = 'install'
    const stage = mkdtempSync(join(userDir(), '.install-'))
    const backup = join(userDir(), '.previous-' + randomUUID())
    try {
      for (const [name, data] of files) {
        const path = join(stage, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, data)
      }
      const { manifest, error } = readManifest(stage)
      if (!manifest || error) throw new Error(error || '发行包清单无效')
      const pkg = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
      if (pkg.name !== entry.name || pkg.type !== 'module' || manifest.version !== entry.version || pkg.aurabot.api !== entry.api) throw new Error('安装包内容和索引对不上')
      writeFileSync(join(stage, SOURCE_FILE), JSON.stringify({ id, version: entry.version, sha256: entry.artifact.sha256, source: entry.source, installedAt: new Date().toISOString() }))
      if (existsSync(target)) renameSync(target, backup)
      let placed = false
      try {
        renameSync(stage, target)
        placed = true
        progress.stage = 'start'
        await mods.sync()
        const status = mods.status().find(m => m.id === id)
        if (!status || status.error) throw new Error(status?.error || '宿主没有发现安装的插件')
      } catch (error) {
        if (placed) rmSync(target, { force: true, recursive: true })
        if (existsSync(backup)) renameSync(backup, target)
        await mods.sync()
        throw error
      }
      rmSync(backup, { force: true, recursive: true })
    } finally { rmSync(stage, { force: true, recursive: true }) }
    log.info('已安装 ' + id + '@' + entry.version)
    return { ok: true, message: '已安装 ' + id + '@' + entry.version }
  })

  const remove = (id: string, { purge = false } = {}) => exclusive(async () => {
    if (!ID_RE.test(id) || !readSource(id)) throw new Error('只能卸载市场安装的插件')
    const target = idDir(id)
    directory(dirname(target))
    if (!lstatSync(target).isDirectory()) throw new Error('无法归档插件目录')
    const trash = join(userDir(), '.trash')
    directory(trash)
    const folder = id.replace('/', '__') + '-' + randomUUID()
    const archive = 'modules/.trash/' + folder
    mods.stop(id)
    try {
      renameSync(target, join(trash, folder))
      if (purge) {
        rmSync(dataDir('modules-data', id), { recursive: true, force: true })
        const cfg = getConfig()
        const { [id]: _settings, ...ext } = cfg.ext || {}
        const { [id]: _module, ...modules } = cfg.modules || {}
        setConfig({ ...cfg, ext, modules })
      }
    } finally { await mods.sync() }
    return { ok: true, archive, message: '已卸载，源码已归档到 ' + archive }
  })
  return { progress: () => progress, registryUrl: registry, list, install, remove, source: readSource }
}
