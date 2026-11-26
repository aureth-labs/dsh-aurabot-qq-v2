import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../../../src/core/store/index.ts'
import type { StickerSource } from '../../../src/core/message/media/sticker.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { createStickerStore } from './store.ts'

export function primaryLibrary(ctx: PluginContext) {
  const home = dataDir('stickers')
  const bindingFile = join(home, 'account.json')
  let bound = readJson(bindingFile, () => null)?.selfId || ''
  let current: ReturnType<typeof createStickerStore> | undefined
  let previous = ''
  let active = true
  const source = () => ctx.get<{ capture(): StickerSource | undefined }>('primary-sticker-source')?.capture()
  function select() {
    if (!active) throw Error('表情库已卸载')
    const self = source()?.selfId
    const expected = String(ctx.root.config.botQQ || '')
    if (self && !bound && (self === expected || !existsSync(join(home, 'index.json')))) {
      writeJson(bindingFile, { selfId: self })
      bound = self
    }
    const id = self || expected
    const directory = !id || id === bound || (!self && !bound) ? home :
      ctx.dataDir('accounts', createHash('sha256').update(JSON.stringify(['primary', id])).digest('hex'))
    const key = JSON.stringify([directory, id])
    if (!current || previous !== key) {
      current?.dispose()
      previous = key
      current = createStickerStore({ dsh: ctx.harness, generate: ctx.ask, getConfig: ctx.root.read,
        source: () => { const account = source(); return account?.selfId === id ? account : undefined },
        directory, log: ctx.logger })
    }
    return current
  }
  ctx.on('onebot/ready', () => { if (active) select() })
  ctx.effect(() => { active = false; current?.dispose() })
  return { select, source }
}
