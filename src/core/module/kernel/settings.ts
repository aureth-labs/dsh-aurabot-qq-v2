import { isDeepStrictEqual } from 'node:util'
import { instanceSettings } from '../../config/plugin-settings.ts'
import { isSchema, Schema } from '../../config/shape/schema.ts'
import { deepMerge, isObj, type RawConfig } from '../../config/state/shared.ts'
import type { ModuleDef } from '../loader.ts'

const commandFlag = Schema.boolean().default(false)

function normalized(def: ModuleDef, input: RawConfig): RawConfig {
  const merged = deepMerge(def.defaults ?? {}, input)
  if (!isSchema(def.config)) return merged
  const checked = def.config.validate(merged)
  if (!checked.ok || !isObj(checked.value)) throw new TypeError(checked.error || '插件配置应为对象')
  const value = checked.value
  if (Object.hasOwn(merged, 'registerCommands') && !Object.hasOwn(value, 'registerCommands')) {
    const flag = commandFlag.validate(merged.registerCommands)
    if (!flag.ok) throw new TypeError('registerCommands 应为布尔值')
    value.registerCommands = flag.value
  }
  return value
}

function normalizedOverrides(own: RawConfig, effective: RawConfig): RawConfig {
  return Object.fromEntries(Object.entries(own).map(([key, value]) => {
    const next = effective[key]
    if (!Object.hasOwn(effective, key)) return [key, value]
    return [key, isObj(value) && isObj(next) ? normalizedOverrides(value, next) : next]
  }))
}

export function normalizePluginEdit(def: ModuleDef, previous: RawConfig, next: RawConfig): RawConfig {
  if (!isSchema(def.config)) return next
  const fields = def.settings ?? []
  const base = instanceSettings(next, fields)
  const result = isDeepStrictEqual(base, instanceSettings(previous, fields))
    ? { ...next } : { ...next, ...normalizedOverrides(base, normalized(def, base)) }
  if (Array.isArray(next.instances)) {
    result.instances = next.instances.map(row => {
      if (!isObj(row) || !isObj(row.config)) return row
      const id = row.id ?? row.name
      if (typeof id !== 'string') return row
      const resolved = instanceSettings(result, fields, id)
      const prior = Array.isArray(previous.instances) && previous.instances.some(r => isObj(r) && (r.id ?? r.name) === id)
      if (prior && isDeepStrictEqual(resolved, instanceSettings(previous, fields, id))) return row
      return { ...row, config: normalizedOverrides(row.config, normalized(def, resolved)) }
    })
  }
  return result
}

export function pluginSettings(def: ModuleDef, instance: string | undefined, read: () => RawConfig, warn: (message: string) => void) {
  let lastValid = def.defaults ?? {}
  let lastError = ''
  function settings() {
    try {
      lastValid = normalized(def, instanceSettings(read(), def.settings ?? [], instance))
      lastError = ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== lastError) warn(message)
      lastError = message
    }
    return structuredClone(lastValid)
  }
  function update(patch: unknown) {
    if (!isObj(patch) || Object.hasOwn(patch, 'instances')) throw new TypeError('请提交当前实例的配置字段')
    const previous = read()
    const candidate = deepMerge(instanceSettings(previous, def.settings ?? [], instance), patch)
    const value = normalized(def, candidate)
    if (isSchema(def.config) && Object.keys(patch).some(key => !Object.hasOwn(value, key)))
      throw new TypeError('含有插件未声明的配置项')
    const changes = normalizedOverrides(patch, value)
    if (!instance) return normalizePluginEdit(def, previous, deepMerge(previous, changes))
    const rows = Array.isArray(previous.instances) ? previous.instances : []
    const index = rows.findIndex(row => isObj(row) && (row.id ?? row.name) === instance)
    if (index < 0) throw new Error('插件实例已移除')
    return { ...previous, instances: rows.map((row, i) => i === index ? { ...row, config: deepMerge(row.config ?? {}, changes) } : row) }
  }
  return { settings, update }
}
