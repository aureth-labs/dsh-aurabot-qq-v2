// QQ 频道适配器：网关握手 → READY → 收消息 → 发送 → 断开。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQQGuildSpec } from '../../packages/adapters/qq/qq-guild/src/index.ts'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 假网关：连上就推 HELLO，收到 IDENTIFY 就回 READY，之后测试可以自己推事件。 */
class FakeGatewaySocket {
  constructor() {
    this.handlers = {}
    this.sent = []
    this.closed = false
    queueMicrotask(() => this.push({ op: 10, d: { heartbeat_interval: 30000 } }))
  }

  addEventListener(type, handler) {
    ;(this.handlers[type] ||= []).push(handler)
  }

  send(raw) {
    const payload = JSON.parse(raw)
    this.sent.push(payload)
    if (payload.op === 2) {
      queueMicrotask(() =>
        this.push({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess-1', user: { id: 'bot-1' } } }),
      )
    }
  }

  close() {
    this.closed = true
  }

  push(payload) {
    this.emit('message', { data: JSON.stringify(payload) })
  }

  emit(type, event) {
    for (const handler of this.handlers[type] || []) handler(event)
  }
}

function createHarness() {
  const requests = []
  const messages = []
  const events = []
  let socket = null

  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (path === '/app/getAppAccessToken') return jsonResponse({ access_token: 'tok-1', expires_in: 7200 })
    if (path.endsWith('/users/@me/dms')) return jsonResponse({ channel_id: 'dm-chan-1' })
    if (path.endsWith('/messages')) return jsonResponse({ id: 'msg-1' })
    return jsonResponse({ message: 'not found' }, 404)
  }

  const spec = createQQGuildSpec({
    appId: 'app-1',
    clientSecret: 'secret-1',
    tokenEndpoint: 'https://token.test/app/getAppAccessToken',
    apiBase: 'https://api.test',
    fetchImpl,
    socketFactory: () => {
      socket = new FakeGatewaySocket()
      return socket
    },
  })

  const runtime = {
    platform: 'qq',
    log: () => {},
    emitMessage: (message) => messages.push(message),
    emitEvent: (type, payload) => events.push({ type, payload }),
  }

  return {
    spec,
    runtime,
    requests,
    messages,
    events,
    get socket() {
      return socket
    },
  }
}

test('频道：READY 后上线，收到 @ 消息去掉前缀，回消息走频道 API', async (t) => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)
  t.after(() => harness.spec.disconnect(bot, {}))

  assert.equal(bot.status, 'online')
  assert.equal(bot.selfId, 'bot-1')

  harness.socket.push({
    op: 0,
    s: 2,
    t: 'AT_MESSAGE_CREATE',
    d: {
      id: 'm-1',
      channel_id: 'chan-1',
      guild_id: 'guild-1',
      content: '<@!bot-1> 今天吃啥',
      author: { id: 'u-1', username: '小明' },
      timestamp: '2026-11-26T08:00:00Z',
    },
  })

  assert.equal(harness.messages.length, 1)
  assert.equal(harness.messages[0].content, '今天吃啥')
  assert.equal(harness.messages[0].type, 'group')
  assert.equal(harness.messages[0].channelId, 'chan-1')
  assert.equal(harness.messages[0].userId, 'u-1')

  await bot.sendMessage('chan-1', '<text>吃鱼</text><image url="https://x/y.png"/>')
  const send = harness.requests.at(-1)
  assert.equal(send.url, 'https://api.test/channels/chan-1/messages')
  assert.equal(send.body.content, '吃鱼[图片]')

  harness.socket.push({ op: 0, s: 3, t: 'GUILD_CREATE', d: { id: 'guild-9' } })
  assert.deepEqual(harness.events.at(-1), { type: 'GUILD_CREATE', payload: { id: 'guild-9' } })
})

test('频道：私信要先开 DM 频道，开过就复用', async (t) => {
  const harness = createHarness()
  const bot = await harness.spec.connect({ dmGuildId: 'guild-1' }, harness.runtime)
  t.after(() => harness.spec.disconnect(bot, {}))

  await bot.sendPrivateMessage('u-2', '在吗')
  await bot.sendPrivateMessage('u-2', '还在吗')

  const dms = harness.requests.filter((request) => request.url.endsWith('/users/@me/dms'))
  assert.equal(dms.length, 1)
  assert.deepEqual(dms[0].body, { recipient_id: 'u-2', source_guild_id: 'guild-1' })

  const sends = harness.requests.filter((request) => request.url.endsWith('/channels/dm-chan-1/messages'))
  assert.equal(sends.length, 2)
  assert.equal(sends[0].body.content, '在吗')
})

test('频道：没填 dmGuildId 时私信直接报错，不瞎发', async (t) => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)
  t.after(() => harness.spec.disconnect(bot, {}))

  await assert.rejects(() => bot.sendPrivateMessage('u-3', 'hi'), /dmGuildId/)
})

test('频道：断线后 bot 下线，发送抛错', async () => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)

  await harness.spec.disconnect(bot, {})
  assert.equal(bot.status, 'offline')
  assert.equal(harness.socket.closed, true)
  await assert.rejects(() => bot.sendMessage('chan-1', 'hi'))
})

test('频道：缺 appId / clientSecret 时不给连接', async () => {
  const harness = createHarness()
  await assert.rejects(() => harness.spec.connect({ appId: '', clientSecret: '' }, harness.runtime), /appId/)
})
