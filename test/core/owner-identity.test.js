import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig, mergeFromPanel, normalize, publicConfig } from '../../src/core/config/index.ts'
import { isOwnerOf, ownerId } from '../../src/core/config/owners.ts'
import { migrateConfig } from '../../packages/app/migrations/config.ts'
import { cleanupDir } from '../helpers/cleanup.js'

test('V2 配置迁移保留原文件，旧面板换主人保留其他平台与限实例条目', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-owners-'))
  const oldDir = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  t.after(() => {
    if (oldDir === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = oldDir
    cleanupDir(dir)
  })
  const file = join(dir, 'config.json')
  const original = JSON.stringify({ ownerQQ: '123', ownerIds: ['123', '456'], botQQ: '10001', onebot: { wsUrl: 'ws://x', wsToken: 't' } })
  writeFileSync(file, original)
  migrateConfig(dir)
  const migrated = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(migrated.ext['adapter-qq-onebot-v11'], { wsUrl: 'ws://x', wsToken: 't', selfId: '10001' })
  for (const key of ['ownerQQ', 'ownerIds', 'botQQ', 'onebot']) assert.equal(Object.hasOwn(migrated, key), false)
  const cfg = loadConfig()
  assert.equal(ownerId(cfg), '123')
  assert.equal(Object.hasOwn(cfg, 'ownerQQ'), false)
  assert.equal(readFileSync(file + '.before-v2', 'utf8'), original)
  assert.deepEqual(cfg.owners.map(row => row.userId), ['123', '456'])
  assert.equal(isOwnerOf(cfg, '123', 'matrix'), false)
  const matrix = { platform: 'matrix', botId: 'work', userId: '@Alice:chat' }
  const mixed = saveConfig({ ...cfg, owners: [...cfg.owners, matrix] }, cfg)
  assert.equal(isOwnerOf(mixed, { platform: 'matrix', bot: { id: 'work' }, userId: matrix.userId }), true)
  assert.equal(isOwnerOf(mixed, matrix.userId, 'matrix', 'home'), false)
  assert.equal(isOwnerOf(mixed, matrix.userId, 'matrix'), false)
  const changed = saveConfig(mergeFromPanel(mixed, { owners: [{ platform: 'qq', userId: '789' }, matrix] }), mixed)
  assert.equal(ownerId(changed), '789')
  assert.equal(isOwnerOf(changed, matrix.userId, 'matrix', 'work'), true)
  assert.equal(isOwnerOf(changed, '123', 'qq'), false)
  assert.equal(isOwnerOf(changed, '789'), false)
  saveConfig(mergeFromPanel(changed, { owners: [] }), changed)
  assert.deepEqual(loadConfig().owners, [])
  assert.equal(ownerId(loadConfig()), '')
  assert.equal(readFileSync(file + '.before-v2', 'utf8'), original)
})

test('凭据按插件实例遮罩与回填，离线未知插件配置只留在服务端', () => {
  const schemas = new Map([['transport', [{ key: 'endpoint' }, { key: 'token', type: 'password' }]]])
  const cfg = normalize({ ext: {
    transport: { token: 'primary-fixture', instances: [
      { id: 'a', config: { endpoint: 'one', token: 'a-fixture' } },
      { id: 'b', config: { endpoint: 'two', token: 'b-fixture' } },
    ] }, disabled: { other: 'offline-fixture' },
  } })
  const form = publicConfig(cfg, schemas)
  assert.doesNotMatch(JSON.stringify(form), /-fixture/)
  const rows = form.ext.transport.instances.reverse()
  rows[0].config.endpoint = 'edited'
  rows[1].config.token = null
  rows.push({ id: 'c', config: { token: '' } })
  const next = mergeFromPanel(cfg, form, schemas)
  assert.equal(next.ext.transport.token, 'primary-fixture')
  assert.deepEqual(next.ext.transport.instances.map(row => row.config.token), ['b-fixture', '', undefined])
  assert.equal(next.ext.disabled.other, 'offline-fixture')
  assert.equal(cfg.ext.transport.instances[0].config.token, 'a-fixture')
})
