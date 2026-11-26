// 单文件插件：modules/<id>.mjs 直接当模块用（只认 ESM，写完保存就热重载）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeModulesDir(files) {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-single-'))
  const dir = join(root, 'modules')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8')
  return { root, dir }
}

test('scanUser：认 modules/<id>.mjs，其他一律不认', async () => {
  const { root, dir } = makeModulesDir({
    'echo.mjs': 'export default function apply() {}',
    'legacy.js': 'module.exports = {}',
    '_draft.mjs': 'export default {}',
    'Bad Name.mjs': 'export default {}',
  })
  process.env.AURABOT_DATA_DIR = root
  try {
    const { scanUser } = await import('../src/core/module/index.ts')
    const found = scanUser()

    assert.deepEqual(found.map((item) => item.id), ['echo'])
    assert.equal(found[0].single, true)
    assert.equal(found[0].file, join(dir, 'echo.mjs'))
  } finally {
    delete process.env.AURABOT_DATA_DIR
    rmSync(root, { recursive: true, force: true })
  }
})

test('scanUser：文件夹模块和单文件模块可以共存', async () => {
  const { root, dir } = makeModulesDir({ 'quick.mjs': 'export default function apply() {}' })
  mkdirSync(join(dir, 'folder-mod'))
  writeFileSync(join(dir, 'folder-mod', 'index.mjs'), 'export default function apply() {}', 'utf8')
  process.env.AURABOT_DATA_DIR = root
  try {
    const { scanUser } = await import('../src/core/module/index.ts')
    const ids = scanUser().map((item) => item.id).sort()
    assert.deepEqual(ids, ['folder-mod', 'quick'])
  } finally {
    delete process.env.AURABOT_DATA_DIR
    rmSync(root, { recursive: true, force: true })
  }
})
