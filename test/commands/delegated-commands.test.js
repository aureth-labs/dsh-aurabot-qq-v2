import { test } from 'node:test'
import { cleanupDir } from '../helpers/cleanup.js'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockOneBot } from '../helpers/mock-onebot.js'
import { modelPreferences } from '../../packages/modules/llm/selection.ts'
import { createFakeDsh } from '../helpers/fake-dsh.js'
import { canUseDelegatedCommand, delegatedCommandKey } from '../../src/chat/policy/rules/delegation.ts'
import { normalize } from '../../src/core/config/index.ts'

const owner = '10000001'
const guest = '10000002'
const guest2 = '10000003'

test('授权按私聊、命令和 QQ 号分别检查，扩展命令验证模块身份', () => {
  const cfg = normalize({ ownerQQ: owner, allow: { private: [guest] }, commandAllow: { reset: [guest], 'ext:other:画图': [guest] } })
  const msg = { kind: 'private', userId: guest }
  assert.equal(canUseDelegatedCommand(cfg, msg, 'reset'), true)
  assert.equal(canUseDelegatedCommand(cfg, msg, 'model'), false)
  assert.equal(canUseDelegatedCommand(cfg, { ...msg, kind: 'group' }, 'reset'), false)
  assert.equal(canUseDelegatedCommand(cfg, { ...msg, userId: guest2 }, 'reset'), false)
  assert.equal(delegatedCommandKey({ name: '画图', ext: { module: 'imagegen' } }), '')
  assert.equal(delegatedCommandKey({ name: '画图', ext: { module: 'other', delegatable: true } }), 'ext:other:画图')
  assert.equal(delegatedCommandKey({ name: '画图', ext: { module: 'other', delegatable: true, sensitive: true } }), '')
  assert.equal(canUseDelegatedCommand(cfg, msg, 'ext:other:画图'), true)
  assert.equal(canUseDelegatedCommand(cfg, msg, 'ext:another:画图'), false)
  assert.equal(delegatedCommandKey({ name: '画图', ext: { module: '../other', delegatable: true } }), '')
})

test('QQ 消息入口执行已授权重开，拒绝未授权的全局开关和群内命令', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-delegated-'))
  process.env.AURABOT_DATA_DIR = dir
  const mock = await startMockOneBot({ selfId: '20000002' })
  t.after(() => mock.close())
  const config = { enabled: true, ownerQQ: owner, botQQ: '20000002',
    allow: { private: [guest], groups: ['30000003'] }, commandAllow: { reset: [guest], model: [guest], 'ext:probe:hello': [guest] },
    onebot: { httpUrl: mock.httpUrl, wsUrl: mock.wsUrl, httpToken: mock.token, wsToken: mock.token }, merge: { enabled: false }, modules: { commands: { enabled: true } } }
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
  mkdirSync(join(dir, 'modules', 'probe'), { recursive: true })
  writeFileSync(join(dir, 'modules', 'probe', 'index.mjs'), `export const name = 'probe'
export function apply(ctx) {
  ctx.private().command('hello').action(({ session }) => {
    if (ctx.root.config.commandAllow['ext:probe:hello']?.includes(session.userId)) {
      globalThis.__delegatedProbe = (globalThis.__delegatedProbe || 0) + 1
    }
  })
}`)
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ chats: { [`private:${guest}`]: { sessionId: 'old-session' } } }))
  const fake = createFakeDsh({ brain: async () => '' })
  const { apply } = await import('../../packages/app/index.ts')
  const api = apply(fake.ctx)
  await api.ready
  t.after(() => { delete globalThis.__delegatedProbe; fake.dispose(); cleanupDir(dir) })
  const message = (text, group = false) => ({ post_type: 'message', message_type: group ? 'group' : 'private',
    self_id: 20000002, user_id: Number(guest), ...(group ? { group_id: 30000003 } : {}), message_id: 123,
    sender: { user_id: Number(guest), nickname: '访客' }, message: [{ type: 'text', data: { text } }] })
  const ownerMessage = (text, group = false) => {
    const event = message(text, group)
    event.user_id = Number(owner)
    event.sender.user_id = Number(owner)
    return event
  }
  await api.hub.onMessage(message('/权限 添加 命令 off ' + guest))
  await api.hub.onMessage(ownerMessage('/权限 添加 命令 off ' + guest, true))
  assert.equal((await fake.call('/state')).json().config.commandAllow.off, undefined)
  const panel = await fake.call('/permissions/subject', { id: guest, changes: { mood: true } }, { 'content-type': 'application/json' })
  assert.equal(panel.json().ok, true)
  const denied = await fake.call('/permissions/subject', { id: guest, changes: { status: true, off: true } }, { 'content-type': 'application/json' })
  assert.equal(denied.json().ok, false)
  assert.equal((await fake.call('/state')).json().config.commandAllow.status.includes(guest), false)
  await api.hub.onMessage(ownerMessage('/权限 添加 命令 status ' + guest))
  assert.equal((await fake.call('/state')).json().config.commandAllow.status.includes(guest), true)
  await api.hub.onMessage(ownerMessage('/权限 移除 命令 status ' + guest))
  assert.equal((await fake.call('/state')).json().config.commandAllow.status.includes(guest), false)
  assert.equal((await fake.call('/state')).json().config.commandAllow.mood.includes(guest), true)
  await api.hub.onMessage(message('/reset'))
  assert.equal(JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')).chats[`private:${guest}`], undefined)
  assert.deepEqual(fake.ctx.workspaceRegistry.archivedSessionIds, ['old-session'])
  await api.hub.onMessage(message('/off'))
  assert.equal((await fake.call('/state')).json().config.enabled, true)
  assert.equal((await fake.call('/state')).json().config.commandAllow.reset.includes(guest), true)
  await api.modules.use('adapter-qq-onebot-v11').ready
  mock.push({ ...message('/hello'), message_id: 124 })
  for (let i = 0; i < 50 && !globalThis.__delegatedProbe; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(globalThis.__delegatedProbe, 1)
  const sessions = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'))
  sessions.chats['group:30000003'] = { sessionId: 'group-session' }
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(sessions))
  await api.hub.onMessage(message('/reset', true))
  mock.push({ ...message('/hello', true), message_id: 125 })
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(globalThis.__delegatedProbe, 1)
  assert.equal(JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')).chats['group:30000003'].sessionId, 'group-session')
})

test('模型选择按登录身份与房间保存，重启后可单独清除', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-models-'))
  t.after(() => cleanupDir(dir))
  const file = join(dir, 'models.json')
  const first = { platform: 'telegram', botId: 'a', type: 'private', id: '42' }
  const other = { ...first, botId: 'b' }
  const choice = { provider: 'vendor', model: 'scheduled' }
  const load = () => modelPreferences(file, async () => [])
  load().set(first, 'login', choice)
  const models = load()
  assert.deepEqual(models.get(first, 'login'), choice)
  for (const target of [other, { ...first, platform: 'qq' }, { ...first, type: 'group' }]) {
    assert.equal(models.get(target, 'login'), null)
  }
  assert.equal(models.get(first, 'replacement'), null)
  models.set(other, 'login', choice)
  models.set(first, 'login', null)
  assert.equal(load().get(first, 'login'), null)
  assert.deepEqual(load().get(other, 'login'), choice)
})
