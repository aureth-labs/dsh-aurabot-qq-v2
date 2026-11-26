import { defineTool } from '../../../tools/index.ts'
import type { ModuleRecord } from '../loader.ts'
import type { AreaLogger } from '../../support/log/logger.ts'
import type { AurabotConfig } from '../../config/shape/defaults.ts'

export function createContributions(
  live: ReadonlyMap<string, ModuleRecord>,
  getConfig: () => AurabotConfig,
  log: AreaLogger,
  note: (key: string, label: string, error: unknown) => void,
) {
  function buildTools(where, sessionNative = false) {
    const out = []
    const names = new Set()
    for (const rec of live.values()) {
      const platform = where.target?.platform
      const platforms = Array.isArray(rec.def.platforms)
        ? rec.def.platforms
        : rec.source === 'user'
          ? ['*']
          : sessionNative
            ? []
            : ['qq']
      if (platform && !platforms.includes('*') && !platforms.includes(platform)) continue
      for (const b of rec.tools) {
        let r
        try {
          r = typeof b === 'function' ? b(where) : b
        } catch (error) {
          note(rec.key, '生成工具', error)
          continue
        }
        for (const t of [].concat(r || [])) {
          if (!t || !t.name) continue
          if (names.has(t.name)) {
            log.debug(`工具 ${t.name} 重名，模块「${rec.id}」的没挂`)
            continue
          }
          names.add(t.name)
          out.push(
            t.output || typeof t.execute !== 'function'
              ? t
              : defineTool({
                  ...t,
                  properties: t.parameters?.properties ?? t.properties,
                  required: t.parameters?.required ?? t.required,
                }),
          )
        }
      }
    }
    return out
  }
  function contextFor(args) {
    const parts = []
    for (const rec of live.values()) {
      for (const fn of rec.contexts) {
        try {
          const t = fn(args)
          if (t) parts.push(String(t))
        } catch (error) {}
      }
    }
    return parts.join('\n\n')
  }
  function rules(kind) {
    const out = []
    for (const rec of live.values()) {
      for (const fn of rec.rules) {
        try {
          const t = typeof fn === 'function' ? fn(kind, getConfig()) : fn
          for (const line of [].concat(t || [])) if (line) out.push(String(line))
        } catch (error) {}
      }
    }
    return out
  }
  const commands = () => [...live.values()].flatMap((r) => r.commands)
  const dshTools = () =>
    [...live.values()].flatMap((r) =>
      r.dshTools.map((t) => ({ ...t, module: r.moduleId, instance: r.instance })),
    )
  return { buildTools, contextFor, rules, commands, dshTools }
}
