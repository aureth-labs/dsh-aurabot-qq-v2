import { isDeepStrictEqual } from 'node:util'
import type { createHttp } from '../../http.ts'
import type { AdapterRegistry } from '../../../../src/core/bot/adapter/registry.ts'
import type { createModules } from '../../../../src/core/module/kernel/create.ts'
import type { AurabotConfig } from '../../../../src/core/config/shape/defaults.ts'
import { mergeFromPanel } from '../../../../src/core/config/panel.ts'
import { instanceSettings, publicPluginSettings } from '../../../../src/core/config/plugin-settings.ts'
import { INSTANCE_RE, instanceKey } from '../../../../src/core/module/loader.ts'
type Data = Record<string, unknown>
interface Options {
  http: ReturnType<typeof createHttp>
  mods: ReturnType<typeof createModules>
  adapterRegistry: AdapterRegistry
  getConfig: () => AurabotConfig
  setConfig: (next: AurabotConfig) => unknown
  onReloadError: (error: Error) => void
}
function record(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {}
}
const fail = (message: string) => ({ ok: false, message })
export function registerConnectionRoutes({ http, mods, adapterRegistry, getConfig, setConfig, onReloadError }: Options) {
  function connections() {
    const rows = adapterRegistry.connections()
    for (const instance of mods.failedAdapters()) {
      if (!rows.some((row) => row.instance === instance))
        rows.push({ instance, platform: '', id: '', selfId: '', status: 'error' })
    }
    return rows
  }
  http.route('/panel/connections', () => ({ ok: true, connections: connections() }))
  http.route('/panel/adapters', () => {
    const cfg = getConfig()
    const installed = mods.adapterCatalog.list()
    const forms = publicPluginSettings(cfg.ext, new Map(installed.map((d) => [d.id, d.fields])))
    return {
      ok: true,
      owners: cfg.owners,
      adapters: installed.map(({ validate, normalize, ...d }) => ({
        ...d,
        enabled: cfg.modules[d.id]?.enabled !== false,
        settings: forms[d.id] ?? {},
      })),
      connections: connections(),
    }
  })
  http.route('/panel/adapter-form', async (req) => {
    const { adapterId } = record(await http.readBody(req))
    const adapter = await mods.adapterCatalog.resolve(adapterId)
    if (!adapter) return fail('请选择已安装的平台适配器')
    const { validate, normalize, ...form } = adapter
    const settings = publicPluginSettings(getConfig().ext, new Map([[adapter.id, adapter.fields]]))
    return { ok: true, adapter: { ...form, settings: settings[adapter.id] ?? {} } }
  })
  http.route('/panel/connect', async (req) => {
    if (req.method !== 'POST') return fail('请使用 POST')
    const body = record(await http.readBody(req))
    const { adapterId, ownerId, platform, instance = '' } = body
    const adapter = await mods.adapterCatalog.resolve(adapterId)
    if (!adapter) return fail('请选择已安装的平台适配器')
    if (
      typeof platform !== 'string' ||
      !/^[a-z][\w.-]{0,63}$/.test(platform) ||
      (!adapter.platforms.includes('*') && !adapter.platforms.includes(platform))
    )
      return fail('平台与适配器不匹配')
    if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 256 || /[\p{Cc}]/u.test(ownerId))
      return fail('请输入有效的主人 ID')
    if (typeof instance !== 'string' || (instance && (!adapter.reusable || !INSTANCE_RE.test(instance))))
      return fail('此适配器不支持该实例名')
    const cfg = getConfig()
    const id = adapter.id
    if (
      body.settings !== undefined &&
      (body.settings === null || typeof body.settings !== 'object' || Array.isArray(body.settings))
    )
      return fail('适配器配置应为对象')
    const input = { ...record(body.settings) }
    const keys = new Set(adapter.fields.map((f) => f.key))
    if (Object.keys(input).some((key) => !keys.has(key))) return fail('含有适配器未声明的配置项')
    if (keys.has('platform')) input.platform = platform
    const old = record(cfg.ext[id])
    const rows = Array.isArray(old.instances) ? old.instances.map(record) : []
    const row = rows.find((r) => (r.id ?? r.name) === instance)
    const changes = { ...row, id: instance, enabled: true, config: { ...record(row?.config), ...input } }
    const settings = instance
      ? { instances: row ? rows.map((r) => (r === row ? changes : r)) : [...rows, changes] }
      : input
    const owners = cfg.owners.some((o) => o.platform === platform && o.userId === ownerId.trim() && !o.botId)
      ? cfg.owners
      : [...cfg.owners, { platform, userId: ownerId.trim() }]
    const patch = { owners, enabled: true, modules: { [id]: { enabled: true } }, ext: { [id]: settings } }
    const next = mergeFromPanel(cfg, patch, new Map(mods.fields).set(id, adapter.fields))
    const result = adapter.validate(instanceSettings(next.ext[id], adapter.fields, instance))
    if (result && !result.ok) return fail(result.error || '适配器配置无效')
    try {
      next.ext[id] = adapter.normalize(old, next.ext[id])
    } catch (error) {
      return fail(error instanceof Error ? error.message : '适配器配置无效')
    }
    const key = instance ? instanceKey(id, instance) : id
    if (!isDeepStrictEqual(cfg, next)) setConfig(next)
    else if (connections().some((row) => row.instance === key && row.status === 'error')) void mods.reload(id).catch(onReloadError)

    const bot = connections().find((b) => b.instance === key && (!b.platform || b.platform === platform))
    return { ok: true, state: bot?.status || 'waiting', instance: key, platform }
  })
}
