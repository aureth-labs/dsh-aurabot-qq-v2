import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuleDef, ModuleRecord, ModuleError, UserModule } from '../loader.ts'

interface CatalogOptions {
  builtinDefs: ReadonlyMap<string, ModuleDef>
  live: ReadonlyMap<string, ModuleRecord>
  errors: ReadonlyMap<string, ModuleError>
  routes: ReadonlyMap<string, { id: string }>
  userSeen: ReadonlyMap<string, unknown>
  discover: () => UserModule[]
  isUserOn: () => boolean
  routesAtRoot: (id: string) => boolean
  modCfg: (id: string) => { enabled?: boolean; useBuiltin?: boolean; forkedFrom?: string }
  revision: () => number
}

export function createModuleCatalog({
  builtinDefs,
  live,
  errors,
  routes,
  userSeen,
  discover,
  isUserOn,
  routesAtRoot,
  modCfg,
  revision,
}: CatalogOptions) {
  function instancesByModule() {
    const groups = new Map<string, ModuleRecord[]>()
    for (const record of live.values()) {
      if (record.key === record.moduleId) continue
      const group = groups.get(record.moduleId)
      if (group) group.push(record)
      else groups.set(record.moduleId, [record])
    }
    return groups
  }
  function status() {
    const users = new Map(discover().map((source) => [source.id, source]))
    const instances = instancesByModule()

    const moduleIds = [...live.values()].map((rec) => rec.moduleId)
    const ids = [
      ...builtinDefs.keys(),
      ...[...new Set([...users.keys(), ...moduleIds])].filter((id) => !builtinDefs.has(id)).sort(),
    ]
    return ids.map((id) => {
      const b = builtinDefs.get(id)
      const u = users.get(id)
      const rec = live.get(id)

      const instanceRecs = instances.get(id) ?? []
      const def = rec?.def ?? instanceRecs[0]?.def ?? b ?? { id }
      const m = modCfg(id)
      const err = errors.get(id)
      return {
        id,
        name: def.name || id,
        description: def.description || '',
        version: def.version || '',
        kind: def.kind === 'adapter' ? 'adapter' : 'plugin',
        reusable: Boolean(def.reusable),
        builtin: Boolean(b),
        builtinVersion: b?.version || '',
        hasUser: Boolean(u),
        community: Boolean(u && existsSync(join(u.dir, '.aurabot-source.json'))),
        userDir: u?.dir || '',
        safeSkipped: Boolean(u && !isUserOn()),
        running: rec ? rec.source : null, // 'builtin' | 'user' | null

        instances: [...instanceRecs.map((item) => ({
          id: item.instance,
          key: item.key,
          running: item.source,
          startedAt: item.startedAt,
          error: errors.get(item.key)?.message || '',
          errors: item.errors,
          tools: toolNames(item),
          commands: item.commands.map((c) => c.name),
          routes: [...routes]
            .filter(([, route]) => route.id === item.key)
            .map(([p]) => p.replace('/aurabot/api', '')),
        })), ...[...errors].filter(([key]) => key.startsWith(id + '@') && !live.has(key)).map(([key, error]) => ({
          id: key.slice(id.length + 1), key, running: null, startedAt: null, error: error.message,
          errors: [], tools: [], commands: [], routes: [],
        }))],
        fallback: Boolean(rec?.fallback),
        enabled: m.enabled !== false,
        useBuiltin: Boolean(m.useBuiltin),
        forkedFrom: m.forkedFrom || '',
        outdated: Boolean(b && rec?.source === 'user' && m.forkedFrom && m.forkedFrom !== b.version),
        error: err ? err.message : '',
        errors: rec ? rec.errors : [],
        tools: rec ? toolNames(rec) : [],
        commands: rec ? rec.commands.map((c) => c.name) : [],
        routes: [...routes].filter(([, r]) => r.id === id).map(([p]) => p.replace('/aurabot/api', '')),
        settings: (def.settings || []).map((field) =>
          field.type === 'password' ? { ...field, default: '' } : field,
        ),
        defaults: Object.fromEntries(
          Object.entries(def.defaults || {}).map(([key, value]) => [
            key,
            def.settings?.some((field) => field.key === key && field.type === 'password') ? '' : value,
          ]),
        ),

        panel: Boolean(rec && def.panel),

        routesAtRoot: routesAtRoot(id),
        tab: typeof def.tab === 'string' ? def.tab : '',
        navGroup: typeof def.navGroup === 'string' ? def.navGroup : '',
        flag:
          typeof def.flag === 'string'
            ? def.flag
            : (def.settings || []).some((f) => f?.key === 'enabled')
              ? 'enabled'
              : '',
        keepPanel: Boolean(def.keepPanel),
        startedAt: rec?.startedAt || 0,
      }
    })
  }
  function toolNames(rec: ModuleRecord) {
    const names = []
    for (const b of rec.tools) {
      try {
        const r =
          typeof b === 'function'
            ? b({ chat: { chatId: 'private:0', kind: 'private', userId: '0' }, level: 'full', sessionId: '' })
            : b
        for (const t of [].concat(r || [])) if (t?.name) names.push(t.name)
      } catch (error) {}
    }
    return names
  }

  function summarizeModules() {
    const instances = instancesByModule()
    const liveIds = [...live.values()].map((rec) => rec.moduleId)
    const ids = new Set([...builtinDefs.keys(), ...userSeen.keys(), ...liveIds])
    const modules = [...ids].sort().map((id) => {
      const b = builtinDefs.get(id)
      const seen = userSeen.get(id)
      const rec = live.get(id)
      const instanceRecs = instances.get(id) ?? []
      const def = rec?.def ?? instanceRecs[0]?.def ?? b ?? { id }
      const m = modCfg(id)
      const err = errors.get(id)
      const enabled = m.enabled !== false
      const availability = rec
        ? 'ready'
        : err
          ? 'error'
          : !enabled
            ? 'disabled'
            : b || seen
              ? 'stopped' // 有定义/有安装记录但没在跑（被关、被替换、等待加载）
              : 'unloaded' // 只有扫描缓存残影，定义还没拿到
      return {
        id,
        name: def.name || id,
        tab: typeof def.tab === 'string' ? def.tab : '',
        navGroup: typeof def.navGroup === 'string' ? def.navGroup : '',
        hasSettings: Array.isArray(def.settings) && def.settings.length > 0,
        hasPanel: Boolean(rec && def.panel),
        kind: def.kind === 'adapter' ? 'adapter' : 'plugin',
        reusable: Boolean(def.reusable),
        enabled,
        running: rec ? rec.source : null, // 'builtin' | 'user' | null
        instanceCount: instanceRecs.length,
        platforms: Array.isArray(def.platforms) ? def.platforms.map(String) : [],
        availability, // ready | error | disabled | stopped | unloaded
        error: err && !rec ? err.message : '',
      }
    })
    return { navigationRevision: revision(), modules }
  }

  return { status, summarizeModules }
}
