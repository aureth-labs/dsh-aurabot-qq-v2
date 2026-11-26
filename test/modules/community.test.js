import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { cleanupDir } from '../helpers/cleanup.js'

const zip = (files) => { // 和 mods 仓库 makeZip 同格式
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const path = Buffer.from(name)
    const body = deflateRawSync(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(8, 8)
    head.writeUInt32LE(crc32(data), 14)
    head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(path.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    head.copy(central, 6, 4, 30)
    central.writeUInt32LE(offset, 42)
    locals.push(head, path, body)
    centrals.push(central, path)
    offset += head.length + path.length + body.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  const n = Object.keys(files).length
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(n, 8)
  end.writeUInt16LE(n, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

test('readZip 拒绝路径穿越、绝对路径和反斜杠', () => {
  for (const name of ['../evil.js', 'a/../../evil.js', '/etc/x', 'C:/x', 'a\\b.js']) assert.throws(() => readZip(zip({ [name]: 'x' })), /不安全/, name)
  assert.equal(readZip(zip({ 'a/b.js': 'hi' })).get('a/b.js').toString(), 'hi')
})

let root, createCommunity, readZip
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'aurabot-market-'))
  process.env.AURABOT_DATA_DIR = root
  ;({ createCommunity, readZip } = await import('../../src/core/module/market/community.ts'))
})
after(() => cleanupDir(root))

function fixture(name) {
  const id = 'author/' + name
  const pkg = { name, type: 'module', main: 'lib/index.js', version: '2.0.0-beta.1', aurabot: { api: 2 } }
  const url = 'https://fixture.invalid/' + name + '.zip'
  const bytes = zip({ 'package.json': JSON.stringify(pkg), 'lib/index.js': 'export function apply() {}' })
  const entry = { id, name, owner: 'author', source: '', version: pkg.version, api: 2, minPluginVersion: '2.0.0-beta.1',
    artifact: { url, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
  const index = { schema: 2, entries: [entry], revoked: [] }
  const target = join(root,'modules',id)
  const calls = []
  let startError = ''
  const config = { ext: { market: { registryUrl: 'https://fixture.invalid/catalog.json' } } }
  const deps = { mods: {
    status: () => existsSync(target) ? [{ id, name, error: startError }] : [],
    sync: async () => { calls.push(market.progress()?.stage) }, stop() {}
  }, getConfig: () => config, setConfig: next => Object.assign(config,next), log: { info() {}, warn() {} },
    version: '2.0.0-beta.1', retryMs: 1,
    fetcher: async link => link === url ? new Response(bytes) : Response.json(index) }
  const market = createCommunity(deps)
  return { id, entry, target, index, deps, market, calls, fail: message => { startError = message } }
}

test('索引按配置寻址，拒绝旧格式和不兼容的发行版', async () => {
  const { market, index, id, entry, deps } = fixture('compat')
  assert.equal(market.registryUrl(), deps.getConfig().ext.market.registryUrl)
  assert.equal((await market.list()).list[0].id, id)
  for (const patch of [{ api: 1 }, { minPluginVersion: '2.0.0' }, { requires: ['author/missing'] }]) {
    const initial = { ...entry }
    Object.assign(entry, patch)
    assert.equal((await market.install(id)).ok, false)
    Object.assign(entry, initial)
    delete entry.requires
  }
  index.revoked.push({ id, versions: [entry.version], reason: '撤回' })
  assert.match((await market.install(id)).message, /撤回/)
  index.schema = 1
  await assert.rejects(market.list({ force: true }), /schema 2/)
})

test('发行包安装、启动回滚和卸载保留原文件', async () => {
  const { market, id, entry, target, fail, calls } = fixture('transaction')
  const install = await market.install(id)
  assert.equal(install.ok, true, install.message)
  assert.equal(market.progress(), null)
  assert(calls.includes('start'))
  writeFileSync(join(target,'local.txt'),'保留')
  fail('启动失败')
  assert.match((await market.install(id)).message, /启动失败/)
  assert.equal(readFileSync(join(target,'local.txt'),'utf8'),'保留')
  fail('')
  entry.artifact.sha256 = '0'.repeat(64)
  assert.match((await market.install(id)).message, /校验/)
  assert.equal(market.source(id).version, entry.version)
  const removed = await market.remove(id)
  assert.equal(removed.ok,true)
  assert.equal(readFileSync(join(root,removed.archive,'local.txt'),'utf8'),'保留')
})

test('保留本地同名插件，网络错误可以重试', async () => {
  const { id, market, deps, target } = fixture('local')
  mkdirSync(target,{recursive:true})
  assert.match((await market.install(id)).message,/自己的文件夹/)
  let attempts = 0
  const offline = createCommunity({ ...deps, fetcher: () => { attempts++; throw Error('offline') } })
  await assert.rejects(offline.list(),/offline/)
  assert.equal(attempts,2)
})
