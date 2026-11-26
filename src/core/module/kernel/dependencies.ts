import type { ModuleError, ModuleRecord } from '../loader.ts'
import { ServiceError, type ServiceRegistry } from '../../service/registry.ts'

export function trackDependencies(
  services: ServiceRegistry,
  live: ReadonlyMap<string, ModuleRecord>,
  errors: Map<string, ModuleError>,
  stop: (key: string, options: { quiet: boolean }) => unknown,
  sync: () => Promise<void>,
  report: (error: unknown) => void,
) {
  let scheduled = false
  const ready = (key: string) => {
    const error = errors.get(key)?.service
    return error && services.has(error.service) === error.readyWhenPresent
  }
  const off = services.onChange((name, present) => {
    if (!present) {
      for (const [key, rec] of [...live]) {
        if (!rec.def.inject?.includes(name) || live.get(key) !== rec) continue
        stop(key, { quiet: true })
        const service = new ServiceError(name, true, `等待服务「${name}」重新上线`)
        errors.set(key, { source: rec.source, message: service.message, at: Date.now(), service })
      }
    }
    if (scheduled || ![...errors.keys()].some(ready)) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if ([...errors.keys()].some(ready)) void sync().catch(report)
    })
  })
  return { ready, off }
}
