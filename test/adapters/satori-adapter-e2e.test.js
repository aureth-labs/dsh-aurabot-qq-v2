// S7 端到端：起一个真的 Satori 服务端（HTTP + WebSocket），让适配器连上去收发一条消息。
//
// 这个测试故意不 mock SatoriClient：握手、IDENTIFY、READY、事件推送、message.create、
// 断开，全都走真实实现，唯一的替身是「平台那一端」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { startAdapter } from '../../src/core/bot/adapter/contract.ts'
import { BotRegistry } from '../../src/core/bot/bot/registry.ts'
import { satoriAdapter } from '../../packages/adapters/satori/src/index.ts'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function frame(text) {
  const payload = Buffer.from(text, 'utf8')
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, payload])
}

/** 解出缓冲区里所有完整的客户端帧（客户端发的帧一定带掩码）。 */
function decodeFrames(buffer) {
  const frames = []
  let cursor = 0
  while (cursor + 2 <= buffer.length) {
    const first = buffer[cursor]
    const second = buffer[cursor + 1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) === 0x80
    let length = second & 0x7f
    let offset = cursor + 2
    if (length === 126) {
      if (offset + 2 > buffer.length) break
      length = buffer.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      if (offset + 8 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(offset))
      offset += 8
    }
    const maskLength = masked ? 4 : 0
    if (offset + maskLength + length > buffer.length) break
    const mask = masked ? buffer.subarray(offset, offset + 4) : null
    offset += maskLength
    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
    frames.push({ opcode, text: payload.toString('utf8') })
    cursor = offset + length
  }
  return { frames, rest: buffer.subarray(cursor) }
}

/** 一个最小可用的 Satori 服务端：只实现这个测试用到的路由与信令。 */
async function startSatoriServer() {
  const state = {
    socket: null,
    token: '',
    identifySn: undefined,
    posts: [],
    closed: false,
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body = {}
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch {
        body = {}
      }
      if (req.method === 'POST' && req.url === '/v1/message.create') {
        state.posts.push({ headers: req.headers, body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { id: `sent-${state.posts.length}` } }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 404, message: 'not found' } }))
    })
  })

  server.on('upgrade', (req, socket) => {
    const key = String(req.headers['sec-websocket-key'] || '')
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    state.socket = socket
    let pending = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk])
      const { frames, rest } = decodeFrames(pending)
      pending = rest
      for (const item of frames) {
        if (item.opcode === 0x8) {
          state.closed = true
          socket.end()
          continue
        }
        let packet = null
        try {
          packet = JSON.parse(item.text)
        } catch {
          continue
        }
        if (packet.op === 3) {
          state.token = String(packet.body?.token ?? '')
          state.identifySn = packet.body?.sn
          socket.write(frame(JSON.stringify({
            op: 4,
            body: { logins: [{ user: { id: '42', name: 'Satori Bot' }, platform: 'discord' }] },
          })))
        } else if (packet.op === 1) {
          socket.write(frame(JSON.stringify({ op: 2 })))
        }
      }
    })
    socket.on('error', () => {})
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    endpoint: `http://127.0.0.1:${port}`,
    state,
    pushEvent(event) {
      state.socket.write(frame(JSON.stringify({ op: 0, body: event })))
    },
    async close() {
      if (state.closing) return
      state.closing = true
      // 测试失败时连接可能还挂着，close() 会一直等；先掐掉所有连接再关
      state.socket?.destroy()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitFor(check, timeoutMs = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待超时')
}

test('Satori 适配器：真连服务端、收事件、发消息、断开', async (t) => {
  const server = await startSatoriServer()
  let handle = null
  // 断言失败也要把连接和 server 收掉，否则测试进程会挂在那儿不退出
  t.after(async () => {
    await handle?.dispose().catch(() => {})
    await server.close()
  })
  const registry = new BotRegistry()
  const inbound = []
  const online = []
  registry.on('online', (bot) => online.push(bot.id))

  handle = await startAdapter(
    registry,
    satoriAdapter(),
    { endpoint: server.endpoint, token: 'secret-token', platform: 'discord' },
    {
      platform: 'discord',
      log: () => {},
      emitMessage: (message) => inbound.push(message),
    },
  )

  assert.equal(handle.bot.id, '42')
  assert.equal(handle.bot.platform, 'discord')
  assert.equal(handle.bot.status, 'online')
  assert.equal(server.state.token, 'secret-token')
  assert.deepEqual(online, ['42'])
  assert.equal(registry.get('42'), handle.bot)

  server.pushEvent({
    sn: 1,
    type: 'message-created',
    timestamp: 1_700_000_000_000,
    message: { id: 'm1', content: '<text>你好</text>' },
    channel: { id: 'chan-1', type: 0 },
    guild: { id: 'guild-1' },
    user: { id: 'u1', name: '小明' },
  })
  const message = await waitFor(() => inbound[0])
  assert.equal(message.type, 'group')
  assert.equal(message.channelId, 'chan-1')
  assert.equal(message.content, '你好')
  assert.equal(message.guildId, 'guild-1')

  await handle.bot.sendMessage('chan-1', '收到啦')
  const post = await waitFor(() => server.state.posts[0])
  assert.equal(post.headers.authorization, 'Bearer secret-token')
  assert.equal(post.headers['satori-platform'], 'discord')
  assert.equal(post.body.channel_id, 'chan-1')
  assert.match(post.body.content, /<text>收到啦<\/text>/)

  // 没收到过这个人的私聊就拿不到直聊频道 id，必须明确报错而不是静默丢消息
  await assert.rejects(() => handle.bot.sendPrivateMessage('nobody', '在吗'), /直聊频道/)

  server.pushEvent({
    sn: 2,
    type: 'message-created',
    message: { id: 'm2', content: '<text>私聊</text>' },
    channel: { id: 'dm-9', type: 1 },
    user: { id: 'u9', name: '小红' },
  })
  await waitFor(() => inbound[1])
  await handle.bot.sendPrivateMessage('u9', '收到')
  const dm = await waitFor(() => server.state.posts[1])
  assert.equal(dm.body.channel_id, 'dm-9')

  await handle.dispose()
  await waitFor(() => server.state.closed)
  assert.equal(registry.get('42'), undefined)
  await server.close()
})
