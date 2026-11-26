import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from '../helpers/fake-dsh.js'
import { cleanupDir } from '../helpers/cleanup.js'

test('平台权限限制指令、子会话与频道，跨实例封禁在插件事件前生效', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-identity-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  const plugin = join(dir, 'modules', 'authority-probe')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, 'index.mjs'), `
    export const name = '权限检查'
    export function apply(ctx) {
      let seen = 0
      ctx.on('before-parse', () => seen++)
      ctx.server.get('/seen', () => ({ seen }))
      ctx.command('gate').authority(3).alias('alternate').action(({session}) => session.send('level ' + session.authority))
      ctx.command('nested', session => session.execute('alternate'))
      ctx.command('grant', async session => { await session.authorize('guest', 3); await session.send('ok') })
    }
  `)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    enabled: true, owners: [{ platform: 'alpha', userId: 'boss' }], modules: { sandbox: { enabled: false } },
  }))
  const fake = createFakeDsh({ brain: async () => '' })
  t.after(() => { fake.dispose(); if (old === undefined) delete process.env.AURABOT_DATA_DIR; else process.env.AURABOT_DATA_DIR = old; cleanupDir(dir) })
  await (await import('../../packages/app/index.ts')).apply(fake.ctx).ready
  const call = async (path, body) => (await fake.call(path, body, { 'content-type': 'application/json' })).json()
  const send = async (platform = 'alpha', userId = 'guest', text = 'nested') =>
    call('/debug/adapter', { platform, type: 'group', userId, userName: '平台昵称', channelId: 'room/42', text })
  const user = { platform: 'alpha', botId: 'alpha:debug', kind: 'user', id: 'guest', alias: '版主' }
  const save = (key, level) => call('/panel/identities/edit', { action: 'save', ...key, level })
  const seen = async () => (await call('/ext/authority-probe/seen')).seen
  assert.equal((await send()).sent.length, 0)
  assert.equal((await send('alpha', 'boss')).sent[0].content, 'level 5')
  assert.match((await send('alpha', 'guest', 'grant')).result.error, /5 级/)
  assert.equal((await send('alpha', 'boss', 'grant')).sent[0].content, 'ok')
  assert.equal((await save(user, 3)).ok, true)
  assert.equal((await send()).sent[0].content, 'level 3')
  const channel = { ...user, kind: 'group', id: 'room/42', alias: '管理组' }
  await save(channel, 4)
  const before = await seen()
  assert.equal((await send()).sent.length, 0)
  assert.equal(await seen(), before)
  await save(channel, null)
  await save({ ...user, botId: '' }, 0)
  assert.equal((await send()).sent.length, 0)
  assert.equal(await seen(), before)
  await send('beta')
  assert.equal(await seen(), before + 1)
  const rows = (await call('/panel/identities?table=users&q=guest')).rows
  assert.equal(rows.length, 3)
  assert.equal(rows.find(r => r.botId === user.botId).effective, 0)
  assert.equal((await save({ ...user, id: 'boss' }, 0)).ok, false)
  assert.equal((await call('/panel/identities/edit', { action: 'remove', ...user, botId: '' })).ok, true)
  assert.equal((await send()).sent[0].content, 'level 3')
})
