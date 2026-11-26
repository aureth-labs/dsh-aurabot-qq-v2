// 聊天流水存储：写入后立即可读，忘记/删除立即生效，不同天互不串数据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createHub } from '../../src/chat/hub/index.ts'
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
