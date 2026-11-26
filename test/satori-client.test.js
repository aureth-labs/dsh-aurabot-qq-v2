// S7：Satori Client 的连接/鉴权/重连，以及事件 → InboundMessage 的翻译。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SatoriClient, satoriEndpoints } from '../src/core/message/satori-client.ts'
import { inboundOf } from '../src/adapters/satori/index.ts'

const silentLog = { debug() {}, info() {}, warn() {}, error() {} }

class FakeSocket {
  static OPEN = 1
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.closed = null
    FakeSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN
      this.onopen?.({})
    })
  }

  send(raw) {
    this.sent.push(JSON.parse(raw))
  }

  close(code, reason) {
    this.readyState = 3
    this.closed = { code, reason }
    this.onclose?.({ code, reason })
  }

  receive(packet) {
    this.onmessage?.({ data: JSON.stringify(packet) })
  }
}

test('地址归一：http / ws / 末尾带 v1 都拆得出 HTTP 根和事件地址', () => {
  assert.deepEqual(satoriEndpoints('http://127.0.0.1:5140'), {
    http: 'http://127.0.0.1:5140',
    ws: 'ws://127.0.0.1:5140/v1/events',
  })
  assert.deepEqual(satoriEndpoints('wss://bot.example.com/satori/v1'), {
    http: 'https://bot.example.com/satori',
    ws: 'wss://bot.example.com/satori/v1/events',
  })
})

test('连上先发 IDENTIFY，收 READY 才算连上', async () => {
  FakeSocket.instances.length = 0
  const events = []
  const client = new SatoriClient({
    endpoint: 'http://127.0.0.1:5140',
    token: 'secret',
    log: silentLog,
    webSocketImpl: FakeSocket,
    onEvent: (event) => events.push(event),
  })

  const connecting = client.connect()
  await new Promise((resolve) => setImmediate(resolve))
  const socket = FakeSocket.instances[0]
  assert.deepEqual(socket.sent[0], { op: 3, body: { token: 'secret' } })

  socket.receive({ op: 4, body: { logins: [{ user: { id: '42' }, platform: 'discord' }] } })
  const logins = await connecting
  assert.equal(logins[0].user.id, '42')
  assert.equal(client.connected, true)

  socket.receive({ op: 0, body: { sn: 9, type: 'message-created' } })
  assert.equal(events.length, 1)
  client.close()
})

test('掉线后自动重连，并带上一次收到的 sn 做会话恢复', async () => {
  FakeSocket.instances.length = 0
  const client = new SatoriClient({
    endpoint: 'http://127.0.0.1:5140',
    log: silentLog,
    webSocketImpl: FakeSocket,
    maxBackoffMs: 1,
  })

  const connecting = client.connect()
  await new Promise((resolve) => setImmediate(resolve))
  const first = FakeSocket.instances[0]
  first.receive({ op: 4, body: { logins: [{ user: { id: '42' } }] } })
  await connecting
  first.receive({ op: 0, body: { sn: 77, type: 'message-created' } })

  first.close(1006, 'network')
  // 退避下限是 1 秒（避免网络抖动时把对端打爆），所以这里要等过 1 秒
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const second = FakeSocket.instances[1]
  assert.ok(second, '应该自动建了第二条连接')
  assert.deepEqual(second.sent[0], { op: 3, body: { sn: 77 } })
  client.close()
})

test('事件翻成 InboundMessage：私聊、群聊、元素树都对', () => {
  const direct = []
  const bot = { rememberDirect: (userId, channelId) => direct.push([userId, channelId]) }

  const privateMessage = inboundOf({
    type: 'message-created',
    timestamp: 1_700_000_000_000,
    message: { id: 'm1', content: '<text>你好</text><img src="https://example.com/a.png"/>' },
    channel: { id: 'direct-1', type: 1 },
    user: { id: '7', name: '小明' },
  }, bot)
  assert.equal(privateMessage.type, 'private')
  assert.equal(privateMessage.channelId, 'direct-1')
  assert.equal(privateMessage.content, '你好')
  assert.equal(privateMessage.elements.length, 2)
  assert.deepEqual(direct, [['7', 'direct-1']])

  const groupMessage = inboundOf({
    type: 'message-created',
    message: { id: 'm2', content: '<text>在吗</text>' },
    channel: { id: 'channel-9', type: 0 },
    guild: { id: 'guild-1' },
    user: { id: '8', nick: '小红' },
  }, bot)
  assert.equal(groupMessage.type, 'group')
  assert.equal(groupMessage.guildId, 'guild-1')
  assert.equal(groupMessage.userName, '小红')

  assert.equal(inboundOf({ type: 'guild-added' }, bot), null)
})
