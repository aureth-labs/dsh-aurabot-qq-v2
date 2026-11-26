import { isObj, type RawConfig } from './state/shared.ts'

type Field = { key: string; type?: string }
export type PluginFields = ReadonlyMap<string, readonly Field[]>

function view(config: RawConfig, fields: readonly Field[]): RawConfig {
  const result: RawConfig = {}
  for (const { key, type } of fields) {
    if (!Object.hasOwn(config, key)) continue
    if (type === 'password') {
      result[key] = ''
      result[key + 'Set'] = Boolean(config[key])
    } else {
      result[key] = config[key]
    }
  }
  return result
}

export function publicPluginSettings(ext: Record<string, RawConfig>, schemas: PluginFields) {
  const result: Record<string, RawConfig> = {}
  for (const [id, config] of Object.entries(ext)) {
    const fields = schemas.get(id)
    if (!fields) continue
    const form = view(config, fields)
    if (Array.isArray(config.instances)) form.instances = config.instances.filter(isObj).map(row => ({
      id: row.id ?? row.name, label: row.label, enabled: row.enabled,
      config: view(isObj(row.config) ? row.config : {}, fields),
    }))
    result[id] = form
  }
  return result
}

function restore(config: RawConfig, old: RawConfig, fields: readonly Field[]) {
  for (const { key, type } of fields) {
    if (type !== 'password') continue
    const value = config[key]
    if (value === null) config[key] = ''
    else if (value === '' || value === undefined) {
      if (Object.hasOwn(old, key)) config[key] = old[key]
      else delete config[key]
    }
    delete config[key + 'Set']
  }
}

export function restorePluginSettings(next: Record<string, RawConfig>, previous: Record<string, RawConfig>, incoming: unknown, schemas: PluginFields) {
  if (!isObj(incoming)) return
  for (const [id, patch] of Object.entries(incoming)) {
    const fields = schemas.get(id)
    if (!fields || !isObj(patch) || !isObj(next[id])) continue
    const old = previous[id] ?? {}
    const config = next[id] = structuredClone(next[id])
    restore(config, old, fields)
    if (!Array.isArray(patch.instances) || !Array.isArray(config.instances)) continue
    const prior = new Map((Array.isArray(old.instances) ? old.instances : []).filter(isObj).map(row => [row.id ?? row.name, row.config]))
    for (const row of config.instances.filter(isObj)) {
      const original = prior.get(row.id ?? row.name)
      row.config = { ...(isObj(original) ? original : {}), ...(isObj(row.config) ? row.config : {}) }
      restore(row.config as RawConfig, isObj(original) ? original : {}, fields)
    }
  }
}
