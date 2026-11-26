import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { createImporter } from '../importer.ts'
import { checkDef, namedModuleDef, type ModuleDef } from '../loader.ts'
import { assertEsm, readManifest } from '../manifest.ts'

export async function loadDefinition(
  importer: ReturnType<typeof createImporter>,
  source: { id: string; dir: string; file: string },
) {
  const formatError = assertEsm(source.dir, source.file)
  if (formatError) throw new Error(formatError)
  const { mod, stamp } = await importer.load(source)
  const named = namedModuleDef(mod)
  if (!named) throw new Error('入口要具名导出 apply(ctx, config)')
  const { manifest } = readManifest(source.dir, { id: source.id })
  const def: ModuleDef = { ...manifest, ...named, id: source.id }
  if (manifest) {
    def.api = Math.max(Number(named.api || 1) || 1, manifest.api)
    if (!named.panel && manifest.panel && !existsSync(resolve(source.dir, String(manifest.panel))))
      delete def.panel
  }
  const error = checkDef(def, source.id)
  if (error) throw new Error(error)
  return { def, stamp }
}
