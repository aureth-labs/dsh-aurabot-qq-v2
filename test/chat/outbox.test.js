import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurabot-outbox-'))

const { createOutbox } = await import('../../packages/modules/chat-bridge/qq/delivery/outbox.ts')
const log = { info () {}, warn () {}, debug () {} }
const text = (content) => [{ type: 'text', attrs: { content } }]

function make (o = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-outbox-case-'))
  return createOutbox({ log, now: () => 1_000_000, file: join(dir, 'outbox', 'queue.json'), ...o })
}

test('确定没发出去的消息入队，连上后补发并删除', async () => {
  let now = 1_000_000
  const q = make({ now: () => now })
  assert.equal(q.add({ message: text('hi'), chatId: 'private:1', note: '回复' }).ok, true)
  assert.equal(q.status().count, 1)
  let calls = 0
  const deliveries = []
  const report = (item, result) => deliveries.push([item.chatId, result.message_id])
  const failed = await q.flush(async () => { calls++; throw Object.assign(new Error('ECONNREFUSED'), { transport: true }) }, () => true, report)
  assert.equal(calls, 1)
  assert.equal(failed.left, 1)
  assert.deepEqual(deliveries, [])
  now += 2_000
  const ok = await q.flush(async () => { calls++; return { message_id: 9 } }, () => true, report)
  assert.equal(ok.sent, 1)
  assert.equal(q.status().count, 0)
  assert.deepEqual(deliveries, [['private:1', 9]])
})

test('超时/不确定的发送直接丢弃，避免重复', async () => {
  const q = make()
  q.add({ message: text('x'), chatId: 'private:1', note: '可能已发出' })
  const r = await q.flush(async () => { throw Object.assign(new Error('超时'), { uncertain: true }) })
  assert.equal(r.dropped, 1)
  assert.equal(q.status().count, 0)
})

test('过期消息不补发', async () => {
  let now = 2_000_000
  const q = make({ now: () => now })
  q.add({ message: text('x'), chatId: 'group:1', kind: 'proactive', note: '过期' })
  now += 61_000
  const r = await q.flush(async () => { throw new Error('不应该调用') })
  assert.equal(r.sent, 0)
  assert.equal(q.status().count, 0)
})

test('队列落盘可恢复，媒体和空消息不入队', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-outbox-file-'))
  const file = join(dir, 'outbox', 'queue.json')
  const q = createOutbox({ log, file })
  assert.equal(q.add({ message: [], chatId: 'group:1' }).ok, false)
  assert.equal(q.add({ message: [{ type: 'image', attrs: { url: 'x' } }], chatId: 'group:1' }).ok, false)
  q.add({ message: text('a'), chatId: 'group:1' })
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 1)
  assert.equal(createOutbox({ log, file }).status().count, 1)
})

test('模式改变后旧 AI 群回复不补发；模块消息仍补发', async () => {
  const q = make(), calls = []
  q.add({ message: text('结果'), chatId: 'group:30000003', incomingReply: true })
  q.add({ message: text('结果'), chatId: 'group:30000003' })
  const result = await q.flush(async (item) => calls.push(item), item => !item.incomingReply)
  assert.equal(result.dropped, 1); assert.equal(result.sent, 1); assert.equal(calls.length, 1)
})

test('主动发言带来路，补发回调能看到原消息', async () => {
  const q = make()
  const message = text('刚看到一只猫')
  q.add({ message, chatId: 'private:1', proactive: 'purpose' })
  const flushed = []
  await q.flush(async () => ({ message_id: 7 }), () => true, (item) => flushed.push(item))
  assert.equal(flushed[0].proactive, 'purpose')
  assert.deepEqual(flushed[0].message, message)
  q.add({ message, chatId: 'private:1' })
  await q.flush(async () => ({ message_id: 8 }), () => true, (item) => flushed.push(item))
  assert.equal('proactive' in flushed[1], false)
})
