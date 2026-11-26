// 聊天流水存储：写入后立即可读，忘记/删除立即生效，不同天互不串数据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseSync } from 'node:sqlite'
import { createMessageLogScope } from '../../src/core/store/messages.ts'
import { createHub } from '../../packages/modules/chat-bridge/qq/index.ts'
import { normalize } from '../../src/core/config/index.ts'
import { cleanupDir } from '../helpers/cleanup.js'

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-chatlog-cache-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  const cfg = normalize({ enabled: true, workspaceDir: dir, voice: { enabled: false }, stickers: { enabled: false } })
  const hub = createHub({
    dsh: {},
    getConfig: () => cfg,
    log: Object.fromEntries(['info', 'warn', 'debug', 'error'].map((k) => [k, () => {}])),
    onebot: { async call() { return { message_id: 1 } } },
  })
  t.after(() => {
    hub.dispose()
    if (old === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = old
    cleanupDir(dir)
  })
  return hub
}

const localDay = (at = Date.now()) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('同一天的流水写入后立即可读', (t) => {
  const hub = setup(t)
  const day = localDay()
  assert.equal(hub.logChat('private:1', '用户', '第一条', '1'), true)
  const first = hub.chatLogOf(day)
  const second = hub.chatLogOf(day)
  assert.equal(first.length, 1)
  assert.deepEqual(second.map((r) => r.text), ['第一条'])

  assert.equal(hub.logChat('private:1', '用户', '第二条', '1'), true)
  const third = hub.chatLogOf(day)
  assert.equal(third.length, 2)
  assert.deepEqual(third.map((r) => r.text), ['第一条', '第二条'])
})

test('忘记和删除流水立即生效', (t) => {
  const hub = setup(t)
  const day = localDay()
  hub.logChat('private:9', '用户', '这句话以后别记住', '9')
  const before = hub.chatLogOf(day)
  assert.equal(before.length, 1)

  assert.ok(hub.forgetChatLog('9', '别记住') >= 1)
  const afterForget = hub.chatLogOf(day)
  assert.equal(afterForget.length, 1)
  assert.ok(afterForget[0].forgottenAt > 0)

  hub.deleteChatLog(day)
  assert.deepEqual(hub.chatLogOf(day), [])
})

test('不同天的流水互不串数据', (t) => {
  const hub = setup(t)
  const now = Date.now()
  const yesterday = localDay(now - 86400_000)
  const today = localDay(now)
  hub.logChat('private:1', '用户', '昨天的话', '1', { at: now - 86400_000 })
  hub.logChat('private:1', '用户', '今天的话', '1', { at: now })
  const a = hub.chatLogOf(yesterday)
  const b = hub.chatLogOf(today)
  assert.deepEqual(a.map((r) => r.text), ['昨天的话'])
  assert.deepEqual(b.map((r) => r.text), ['今天的话'])
  assert.deepEqual(hub.chatLogOf(yesterday).map((r) => r.text), ['昨天的话'])
})

test('按日迁移独立回滚并保留原件，另一连接提交后读取最新流水', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-daily-migration-'))
  const today = '2026-11-27', previous = '2026-11-26'
  const file = join(dir, previous + '.jsonl')
  const line = JSON.stringify({ t: 1, text: '历史' })
  writeFileSync(file, line + '\n{')
  const scope = createMessageLogScope()
  const store = scope.open(dir)
  t.after(() => { scope.close(); cleanupDir(dir) })
  store.append(today, { t: 9, text: '新消息' })
  assert.throws(() => store.read(previous), /第 2 行/)
  assert.equal(existsSync(file), true)
  writeFileSync(file, line)
  assert.deepEqual(store.read(previous).map(row => row.text), ['历史'])
  assert.ok(existsSync(file + '.migrated'))
  const peer = new DatabaseSync(join(dir, 'messages.db'))
  try {
    peer.prepare('INSERT INTO messages(day,t,payload) VALUES(?,?,?)').run(previous, 0, JSON.stringify({ t: 0, text: '补录' }))
    assert.deepEqual(store.read(previous).map(row => row.text), ['补录', '历史'])
    assert.throws(() => store.mutate(previous, row => {
      if (row.t === 1) throw Error('撤销本次修改')
      return { ...row, text: '改动' }
    }), /撤销/)
    assert.deepEqual(store.read(previous).map(row => row.text), ['补录', '历史'])
    store.remove(previous)
    assert.deepEqual(store.days(), [today])
  } finally { peer.close() }
})
