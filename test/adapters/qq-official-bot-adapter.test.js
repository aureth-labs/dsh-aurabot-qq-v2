// QQ 官方机器人适配器：群 @ 事件 → 群消息 API；单聊事件 → 用户消息 API。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQQOfficialBotSpec } from '../../packages/adapters/qq/qq-official/src/index.ts'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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
        this.push({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess-2', user: { id: 'bot-openid' } } }),
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
  let socket = null

  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (path === '/app/getAppAccessToken') return jsonResponse({ access_token: 'tok-2', expires_in: 7200 })
    if (path.endsWith('/messages')) return jsonResponse({ id: 'm-out', timestamp: '2026-11-26T08:00:00Z' })
    return jsonResponse({ message: 'not found' }, 404)
  }

  const spec = createQQOfficialBotSpec({
    appId: 'app-2',
    clientSecret: 'secret-2',
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
  }

  return {
    spec,
    runtime,
    requests,
    messages,
    get socket() {
      return socket
    },
  }
}

test('官方机器人：群 @ 消息走 group_openid，回复带 msg_id 与递增 msg_seq', async (t) => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)
  t.after(() => harness.spec.disconnect(bot, {}))

  assert.equal(bot.status, 'online')
  assert.equal(bot.selfId, 'bot-openid')

  harness.socket.push({
    op: 0,
    s: 2,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'in-1',
      group_openid: 'group-openid-1',
      content: ' 点歌 稻香',
      author: { member_openid: 'member-1' },
      timestamp: '2026-11-26T08:00:00Z',
    },
  })

  assert.equal(harness.messages.length, 1)
  assert.equal(harness.messages[0].type, 'group')
  assert.equal(harness.messages[0].channelId, 'group-openid-1')
  assert.equal(harness.messages[0].userId, 'member-1')
  assert.equal(harness.messages[0].content, '点歌 稻香')

  await bot.sendMessage('group-openid-1', '收到', { replyTo: 'in-1' })
  await bot.sendMessage('group-openid-1', '马上', { replyTo: 'in-1' })

  const sends = harness.requests.filter((request) => request.url.endsWith('/v2/groups/group-openid-1/messages'))
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0].body, { content: '收到', msg_type: 0, msg_id: 'in-1', msg_seq: 1 })
  assert.equal(sends[1].body.msg_seq, 2)
})

test('官方机器人：单聊事件用 user_openid 当会话 id', async (t) => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)
  t.after(() => harness.spec.disconnect(bot, {}))

  harness.socket.push({
    op: 0,
    s: 2,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'in-2',
      content: '你好',
      author: { user_openid: 'user-openid-1' },
    },
  })

  assert.equal(harness.messages[0].type, 'private')
  assert.equal(harness.messages[0].channelId, 'user-openid-1')

  await bot.sendPrivateMessage('user-openid-1', '你好呀')
  const send = harness.requests.at(-1)
  assert.equal(send.url, 'https://api.test/v2/users/user-openid-1/messages')
  assert.equal(send.body.content, '你好呀')
})

test('官方机器人：断开后 socket 关闭，发送抛错', async () => {
  const harness = createHarness()
  const bot = await harness.spec.connect({}, harness.runtime)

  await harness.spec.disconnect(bot, {})
  assert.equal(harness.socket.closed, true)
  await assert.rejects(() => bot.sendMessage('group-openid-1', 'hi'))
})
