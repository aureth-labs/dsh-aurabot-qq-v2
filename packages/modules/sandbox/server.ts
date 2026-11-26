// 聊天沙盒的服务端：一个本地 Satori 服务（HTTP + WebSocket）+ 一个网页聊天室。
//
// 两件事共用一份内存状态：
//   - 适配器按 Satori 协议连 `/v1/events`，发 `/v1/message.create`；
//   - 浏览器打开 `/`，通过 SSE 收消息、通过 `/_sandbox/send` 发消息。
// 消息不进数据库，重启即清空——它只是用来联调的假平台。

import http from 'node:http'
import crypto from 'node:crypto'
import { SANDBOX_PAGE } from './ui.ts'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGES = 300

export interface SandboxServerOptions {
  host?: string
  port?: number
  token?: string
  selfId?: string
  selfName?: string
  platform?: string
  /** 网页里没写昵称时用的默认身份；填主人的 QQ 号就等于「主人本人在沙盒里说话」。 */
  defaultUserId?: string
  defaultUserName?: string
  log?: (message: string) => void
}

export interface SandboxMessage {
  id: string
  at: number
  channelId: string
  channelName: string
  userId: string
  userName: string
  content: string
  direction: 'in' | 'out'
}

interface SocketConn {
  socket: any
  pending: Buffer
  authed: boolean
}

const escapeXml = (text: string) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

/** 服务端发给浏览器的帧不带掩码。 */
export function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  if (payload.length < 65536) {
    const head = Buffer.alloc(4)
    head[0] = 0x81
    head[1] = 126
    head.writeUInt16BE(payload.length, 2)
    return Buffer.concat([head, payload])
  }
  const head = Buffer.alloc(10)
  head[0] = 0x81
  head[1] = 127
  head.writeBigUInt64BE(BigInt(payload.length), 2)
  return Buffer.concat([head, payload])
}

/** 解出缓冲区里所有完整的客户端帧（客户端发的帧一定带掩码）。 */
export function decodeFrames(buffer: Buffer): { frames: Array<{ opcode: number; text: string }>; rest: Buffer } {
  const frames: Array<{ opcode: number; text: string }> = []
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

function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
    })
    req.on('end', () => {
      const text = chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function createSandboxServer(options: SandboxServerOptions = {}) {
  const host = options.host || '127.0.0.1'
  const port = options.port === undefined ? 5140 : Number(options.port)
  let actualPort = port
  const token = String(options.token || '')
  const selfId = String(options.selfId || 'sandbox-bot')
  const selfName = String(options.selfName || '沙盒机器人')
  const platform = String(options.platform || 'sandbox')
  const defaultUserId = String(options.defaultUserId || 'sandbox-user')
  const defaultUserName = String(options.defaultUserName || '沙盒用户')
  const log = options.log || (() => {})

  const messages: SandboxMessage[] = []
  let sequence = 0
  const channels = new Map<string, { id: string; name: string; type: number }>([
    ['sandbox-1', { id: 'sandbox-1', name: '沙盒群', type: 0 }],
  ])
  const sockets = new Set<SocketConn>()
  const streams = new Set<http.ServerResponse>()
  let sn = 0
  let server: http.Server | null = null
  let closing = false

  const remember = (message: SandboxMessage) => {
    messages.push(message)
    if (messages.length > MAX_MESSAGES) messages.shift()
    for (const stream of streams) {
      try {
        stream.write(`data: ${JSON.stringify(message)}\n\n`)
      } catch {
        streams.delete(stream)
      }
    }
  }

  /** 往所有已连上的 Satori 客户端推一条事件。 */
  const push = (event: Record<string, any>) => {
    const body = { sn: ++sn, timestamp: Date.now(), ...event }
    const data = frame(JSON.stringify({ op: 0, body }))
    for (const conn of sockets) {
      try {
        conn.socket.write(data)
      } catch {
        sockets.delete(conn)
      }
    }
  }

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }

  const guild = { id: 'sandbox', name: '沙盒服务器' }
  const botUser = { id: selfId, name: selfName, is_bot: true }

  const users = new Map<string, { id: string; name: string }>()
  const userOf = (id: string, name?: string) => {
    const uid = String(id || 'sandbox-user')
    if (!users.has(uid)) users.set(uid, { id: uid, name: String(name || `沙盒用户${users.size + 1}`) })
    const user = users.get(uid)!
    if (name) user.name = String(name)
    return user
  }

  const apiResult = (method: string, body: Record<string, any>) => {
    switch (method) {
      case 'message.create': {
        const channelId = String(body.channel_id || 'sandbox-1')
        const channel = channels.get(channelId) || { id: channelId, name: channelId, type: 0 }
        channels.set(channelId, channel)
        const message: SandboxMessage = {
          id: `out-${++sequence}`,
          at: Date.now(),
          channelId,
          channelName: channel.name,
          userId: selfId,
          userName: selfName,
          content: String(body.content ?? ''),
          direction: 'out',
        }
        remember(message)
        return { id: message.id }
      }
      case 'user.get':
        return userOf(String(body.user_id || ''), undefined)
      case 'friend.list':
        return [...users.values()]
      case 'guild.get':
        return guild
      case 'guild.list':
        return [guild]
      case 'guild.member.list':
        return [botUser, ...[...users.values()].map((u) => ({ ...u }))]
      case 'channel.get': {
        const id = String(body.channel_id || 'sandbox-1')
        return channels.get(id) || { id, name: id, type: 0 }
      }
      case 'channel.list':
        return [...channels.values()]
      case 'message.get': {
        const hit = messages.find((m) => m.id === String(body.message_id || '') && m.channelId === String(body.channel_id || ''))
        return hit ? { id: hit.id, content: hit.content, channel: { id: hit.channelId } } : {}
      }
      case 'message.list':
        return messages
          .filter((m) => m.channelId === String(body.channel_id || ''))
          .map((m) => ({ id: m.id, content: m.content, channel: { id: m.channelId } }))
      case 'message.delete':
      case 'message.update':
      case 'reaction.create':
      case 'reaction.delete':
        return {}
      default:
        return null
    }
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(String(req.url || '/'), `http://${host}:${port}`)
    const path = url.pathname

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(SANDBOX_PAGE)
      return
    }
    if (req.method === 'GET' && path === '/_sandbox/state') {
      json(res, 200, {
        ok: true,
        url: `http://${host}:${actualPort}`,
        channels: [...channels.values()],
        messages,
        self: botUser,
        clients: [...sockets].filter((conn) => conn.authed).length,
        user: { id: defaultUserId, name: defaultUserName },
      })
      return
    }
    if (req.method === 'GET' && path === '/_sandbox/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (req.method === 'POST' && path === '/_sandbox/send') {
      const body = await readBody(req)
      const text = String(body.text ?? '').trim()
      if (!text) return json(res, 400, { ok: false, message: '消息不能为空' })
      const kind = body.kind === 'private' ? 'private' : 'group'
      const user = userOf(String(body.userId || defaultUserId), String(body.userName || defaultUserName))
      const channelId = kind === 'private' ? `dm-${user.id}` : String(body.channelId || 'sandbox-1')
      if (!channels.has(channelId)) {
        channels.set(channelId, { id: channelId, name: kind === 'private' ? `与 ${user.name} 的私聊` : channelId, type: kind === 'private' ? 1 : 0 })
      }
      const quoted = body.quoteId && messages.find(m => m.id === body.quoteId && m.channelId === channelId)
      if (body.quoteId && !quoted) return json(res, 400, { ok: false, message: '引用消息不在当前会话中' })
      const message: SandboxMessage = {
        id: `in-${++sequence}`,
        at: Date.now(),
        channelId,
        channelName: channels.get(channelId)!.name,
        userId: user.id,
        userName: user.name,
        content: text,
        direction: 'in',
      }
      remember(message)
      push({
        type: 'message-created',
        message: { id: message.id, content: (quoted ? '<quote id="' + quoted.id + '"/>' : '') + '<text>' + escapeXml(text) + '</text>' },
        channel: { id: channelId, type: kind === 'private' ? 1 : 0, name: message.channelName },
        guild: kind === 'private' ? undefined : guild,
        user: { id: user.id, name: user.name },
      })
      return json(res, 200, { ok: true, id: message.id })
    }
    if (req.method === 'POST' && path.startsWith('/v1/')) {
      if (token) {
        const auth = String(req.headers.authorization || '')
        if (auth !== `Bearer ${token}`) return json(res, 401, { error: { code: 401, message: 'invalid token' } })
      }
      const method = path.slice('/v1/'.length)
      const body = await readBody(req)
      const data = apiResult(method, body)
      if (data === null) return json(res, 404, { error: { code: 404, message: `unknown api ${method}` } })
      return json(res, 200, { data })
    }
    json(res, 404, { ok: false, message: 'not found' })
  }

  return {
    get url() {
      return `http://${host}:${actualPort}`
    },
    get running() {
      return Boolean(server)
    },
    async start() {
      if (server) return { url: this.url, port }
      server = http.createServer((req, res) => {
        handler(req, res).catch((error) => {
          log(`沙盒请求出错：${error?.message || error}`)
          if (!res.headersSent) json(res, 500, { ok: false, message: 'internal error' })
          else res.end()
        })
      })
      server.on('upgrade', (req, socket: any) => {
        const key = String(req.headers['sec-websocket-key'] || '')
        if (!key) {
          socket.destroy()
          return
        }
        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n'
          + 'Upgrade: websocket\r\n'
          + 'Connection: Upgrade\r\n'
          + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        )
        const conn: SocketConn = { socket, pending: Buffer.alloc(0), authed: !token }
        sockets.add(conn)
        socket.on('data', (chunk: Buffer) => {
          conn.pending = Buffer.concat([conn.pending, chunk])
          const { frames, rest } = decodeFrames(conn.pending)
          conn.pending = rest
          for (const item of frames) {
            if (item.opcode === 0x8) {
              sockets.delete(conn)
              socket.end()
              continue
            }
            let packet: any = null
            try {
              packet = JSON.parse(item.text)
            } catch {
              continue
            }
            if (packet.op === 3) {
              const given = String(packet.body?.token ?? '')
              if (token && given !== token) {
                socket.write(frame(JSON.stringify({ op: 4, body: { logins: [] } })))
                sockets.delete(conn)
                socket.end()
                continue
              }
              conn.authed = true
              socket.write(frame(JSON.stringify({
                op: 4,
                body: { logins: [{ user: { id: selfId, name: selfName, is_bot: true }, platform, status: 1 }] },
              })))
            } else if (packet.op === 1) {
              socket.write(frame(JSON.stringify({ op: 2 })))
            }
          }
        })
        socket.on('error', () => sockets.delete(conn))
        socket.on('close', () => sockets.delete(conn))
      })
      await new Promise<void>((resolve, reject) => {
        server!.once('error', (error: Error) => reject(error))
        server!.listen(port, host, () => resolve())
      }).catch((error) => {
        server = null
        closing = true
        throw error
      })
      if (closing) {
        await this.close()
        return { url: this.url, port }
      }
      const address = server!.address()
      if (address && typeof address === 'object') actualPort = address.port
      log(`聊天沙盒已启动：${this.url}`)
      return { url: this.url, port: actualPort }
    },
    async close() {
      if (!server) return
      closing = true
      for (const conn of sockets) {
        try {
          conn.socket.destroy()
        } catch {}
      }
      sockets.clear()
      for (const stream of streams) {
        try {
          stream.end()
        } catch {}
      }
      streams.clear()
      const current = server
      server = null
      current.closeAllConnections?.()
      await new Promise<void>((resolve) => current.close(() => resolve()))
    },
  }
}
