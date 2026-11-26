// S6 契约：v2 清单（package.json.aurabot）优先，v1（module.json）回退；入口按 main → index.mjs → index.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest, entryOf, assertEsm } from '../../src/core/module/manifest.ts'
import { cleanupDir } from '../helpers/cleanup.js'

function tempModule(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-manifest-'))
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return dir
}

test('v2：从 package.json.aurabot 读清单', () => {
  const dir = tempModule({
    'package.json': {
      name: 'weather',
      version: '1.2.3',
      description: '查天气',
      type: 'module',
      main: 'lib/index.js',
      aurabot: {
        owner: 'shangxue',
        displayName: '天气',
        category: 'tool',
        capabilities: ['network'],
        api: 2,
        platforms: ['qq'],
      },
    },
    'lib/index.js': 'export default function apply() {}\n',
  })
  const { manifest, error } = readManifest(dir)
  assert.equal(error, '')
  assert.equal(manifest.id, 'shangxue/weather')
  assert.equal(manifest.owner, 'shangxue')
  assert.equal(manifest.name, '天气')
  assert.equal(manifest.version, '1.2.3')
  assert.equal(manifest.api, 2)
  assert.deepEqual(manifest.capabilities, ['network'])
  assert.equal(manifest.entry, join(dir, 'lib/index.js'))
  assert.deepEqual(manifest.platforms, ['qq'])
  cleanupDir(dir)
})

test('仅有 V1 module.json 时明确报告缺少 V2 清单', () => {
  const dir = tempModule({
    'module.json': { id: 'weather', name: '天气', version: '0.9.0', capabilities: ['plugin-internals'] },
    'index.mjs': 'export default {}\n',
  })
  const { manifest, error } = readManifest(dir, { id: 'weather' })
  assert.equal(manifest, null)
  assert.match(error, /package\.json\.aurabot/)
  cleanupDir(dir)
})

test('入口：main 优先于 index.mjs', () => {
  const dir = tempModule({
    'package.json': { name: 'demo', version: '1.0.0', main: 'dist/entry.js', aurabot: { api: 2 } },
    'dist/entry.js': 'export default function apply() {}\n',
    'index.mjs': '// 老入口\n',
  })
  assert.equal(entryOf(dir), join(dir, 'dist', 'entry.js'))
  cleanupDir(dir)
})

test('CommonJS 入口被拒绝，ESM 放行', () => {
  const dir = tempModule({
    'package.json': { name: 'demo', version: '1.0.0', type: 'commonjs', main: 'index.js' },
    'index.js': 'module.exports = {}\n',
  })
  assert.match(assertEsm(dir, join(dir, 'index.js')), /只支持 ESM/)
  const esm = tempModule({
    'package.json': { name: 'demo', version: '1.0.0', type: 'module', main: 'index.js' },
    'index.js': 'export default {}\n',
  })
  assert.equal(assertEsm(esm, join(esm, 'index.js')), '')
  cleanupDir(dir)
  cleanupDir(esm)
})

test('没清单 / 没入口都给明确错误', () => {
  const empty = tempModule({})
  assert.match(readManifest(empty).error, /没有 package\.json\.aurabot/)
  const noEntry = tempModule({ 'package.json': { name: 'demo', version: '1.0.0', aurabot: { api: 2 } } })
  assert.match(readManifest(noEntry).error, /找不到入口文件/)
  cleanupDir(empty)
  cleanupDir(noEntry)
})
