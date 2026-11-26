import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { filesOf, SNAP, stampOfTarget } from './loader.ts'

type Source = { dir: string; file: string; single?: boolean }

export function createImporter(root: string) {
  const prefix = pathToFileURL(root).href + '/'
  let hooks: ReturnType<typeof registerHooks> | undefined
  const roots = new Map<string, string>()
  let closed = false
  let pending = 0

  function enableResolution() {
    hooks ??= registerHooks({
      resolve(specifier, context, next) {
        if (!context.parentURL?.startsWith(prefix)) return next(specifier, context)
        if (specifier === '@aurabot/plugin-api') {
          const file = import.meta.url.endsWith('.ts') ? './public-api.ts' : './public-api.js'
          return next(new URL(file, import.meta.url).href, context)
        }
        if (context.parentURL.includes('/' + SNAP + '/')
          && specifier.startsWith('.') && specifier.endsWith('.js')) {
          const js = new URL(specifier, context.parentURL)
          const ts = new URL(js.href.slice(0, -3) + '.ts')
          if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts))) return next(ts.href, context)
        }
        return next(specifier, context)
      },
    })
  }

  async function importSource(source: Source) {
    enableResolution()
    const stamp = stampOfTarget(source)
    if (source.single) return { mod: await import(pathToFileURL(source.file).href + '?v=' + stamp), stamp }

    let parent = roots.get(source.dir)
    if (!parent) {
      const cache = join(source.dir, SNAP)
      mkdirSync(cache, { recursive: true })
      parent = mkdtempSync(join(cache, 'host-'))
      roots.set(source.dir, parent)
    }
    const target = join(parent, stamp)
    const entry = relative(source.dir, source.file)
    const typescript = entry.endsWith('.ts')
    if (!existsSync(target)) {
      const stage = join(parent, randomUUID())
      mkdirSync(stage, { recursive: true })
      try {
        for (const file of filesOf(source.dir)) {
          const from = join(source.dir, file)
          const to = join(stage, file)
          mkdirSync(dirname(to), { recursive: true })
          if (typescript && file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            writeFileSync(to, stripTypeScriptTypes(readFileSync(from, 'utf8'), { mode: 'transform' }))
          } else copyFileSync(from, to)
        }
        const pkgFile = join(stage, 'package.json')
        const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')) : {}
        if (!pkg.type) writeFileSync(pkgFile, JSON.stringify({ ...pkg, type: 'module' }))
        renameSync(stage, target)
      } finally {
        if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
      }
    }
    const mod = await import(pathToFileURL(join(target, entry)).href)
    return { mod, stamp }
  }

  function cleanup() {
    if (!closed || pending) return
    hooks?.deregister()
    for (const dir of roots.values()) rmSync(dir, { recursive: true, force: true })
    roots.clear()
  }

  return {
    async load(source: Source) {
      if (closed) throw new Error('插件加载器已关闭')
      pending++
      try { return await importSource(source) }
      catch (error) {
        if (error instanceof ReferenceError && /(?:^|\s)(module|exports|require) is not defined/.test(error.message))
          throw new Error('插件只支持 ESM；请使用 import 与具名 export', { cause: error })
        throw error
      } finally { pending--; cleanup() }
    },
    dispose() { closed = true; cleanup() },
  }
}
