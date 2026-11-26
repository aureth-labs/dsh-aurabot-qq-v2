import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { createModules } from '../../src/core/module/index.ts'
import { cleanupDir } from '../helpers/cleanup.js'

test('新建 TS 插件可使用指令，修改相对导入的子文件触发热重载', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-ts-plugin-'))
  const previous = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  const handlers = new Map()
  const pipeline = { command(name, fn) {
    handlers.set(name, fn)
    return () => handlers.delete(name)
  } }
  const log = { info() {}, warn() {}, error() {}, debug() {} }
  let config = { ext: {}, modules: {} }
  const mods = createModules({ ctx: {}, core: { pipeline }, builtins: [], version: 'test',
    logger: { child: () => log }, getConfig: () => config, setConfig: value => { config = value } })
  t.after(() => {
    mods.dispose()
    if (previous === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = previous
    cleanupDir(dir)
  })
  await mods.boot()
  assert.equal('lib' in globalThis.aurabot, false)
  const created = mods.create('tools/greet', '问候')
  assert.equal(created.ok, true)
  await mods.sync()
  const sent = []
  await handlers.get('greet')({ send: async text => sent.push(text) }, '', 'greet')
  assert.deepEqual(sent, ['你好'])
  const helper = join(created.dir, 'format.ts')
  writeFileSync(helper, "export const value: string = 'one'")
  writeFileSync(created.file, "import { value } from './format.js'\nexport function apply() { return { value } }")
  await mods.sync()
  assert.equal(mods.use('tools/greet').value, 'one')
  assert.equal(handlers.has('greet'), false)
  writeFileSync(helper, "export const value: string = 'two'")
  for (let count = 0; count < 50 && mods.use('tools/greet')?.value !== 'two'; count++) await wait(50)
  assert.equal(mods.use('tools/greet').value, 'two')
})
