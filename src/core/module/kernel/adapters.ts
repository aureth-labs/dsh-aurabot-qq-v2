import { readManifest } from '../manifest.ts'
import { scanUser, type ModuleDef, type ModuleRecord } from '../loader.ts'
import type { createImporter } from '../importer.ts'
import { isSchema } from '../../config/shape/schema.ts'
import { loadDefinition } from './definition.ts'
import { normalizePluginEdit } from './settings.ts'
import type { RawConfig } from '../../config/state/shared.ts'

function describe(def: ModuleDef, needsLoad: boolean) {
  const schema = isSchema(def.config) ? def.config : undefined
  return {
    id: def.id,
    name: def.name || def.id,
    platforms: Array.isArray(def.platforms) ? def.platforms.map(String) : ['*'],
    reusable: Boolean(def.reusable),
    needsLoad,
    fields: schema?.toSettings() ?? [],
    validate: (settings: Record<string, unknown>) => schema?.validate(settings),
    normalize: (old: RawConfig, next: RawConfig) => normalizePluginEdit({ ...def, settings: schema?.toSettings() }, old, next),
  }
}

export function createAdapterCatalog(
  builtins: ReadonlyMap<string, ModuleDef>,
  live: ReadonlyMap<string, ModuleRecord>,
  importer: ReturnType<typeof createImporter>,
  allowUser: () => boolean,
  useBuiltin: (id: string) => boolean,
) {
  function candidates() {
    return allowUser()
      ? scanUser().filter((source) => !(builtins.has(source.id) && useBuiltin(source.id)))
      : []
  }
  function list() {
    const packages = new Map(
      [...builtins]
        .filter(([, def]) => def.kind === 'adapter')
        .map(([id, def]) => [id, describe(def, false)]),
    )
    for (const source of candidates()) {
      packages.delete(source.id)
      const current = live.get(source.id)
      if (current?.source === 'user') {
        if (current.def.kind === 'adapter') packages.set(source.id, describe(current.def, false))
        continue
      }
      const { manifest } = readManifest(source.dir, { id: source.id })
      if (manifest?.kind === 'adapter')
        packages.set(source.id, describe({ ...manifest, id: source.id }, true))
    }
    return [...packages.values()]
  }
  async function resolve(id: unknown) {
    const entry = list().find((adapter) => adapter.id === id)
    if (!entry?.needsLoad) return entry
    const source = candidates().find((source) => source.id === id)
    if (!source) return
    const { def } = await loadDefinition(importer, source)
    if (
      def.kind === 'adapter' &&
      candidates().some((current) => current.id === id && current.file === source.file)
    )
      return describe(def, false)
  }
  return { list, resolve }
}
