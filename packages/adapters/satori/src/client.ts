// Satori Client：连 Satori 协议实现（koishi 的 satori 适配器、satori 服务端……）。
//
// 传输分两块（见 satori 协议文档）：
//   - 事件：WebSocket `/v1/events`，先发 IDENTIFY(op=3) 带 token，收到 READY(op=4) 才算连上；
//   - 调用：HTTP `POST /v1/{resource}.{method}`，鉴权走 `Authorization: Bearer`。
//
// 断线自动重连，带指数退避；会话恢复用上次收到的 sn（协议原生支持，不会丢断开期间的事件）。
// 这里只管协议，不管业务：事件原样回调出去，由适配器翻成 InboundMessage。

export interface SatoriLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface SatoriUser {
  id: string
  name?: string
  nick?: string
  avatar?: string
  is_bot?: boolean
}

export interface SatoriChannel {
  id: string
  /** 0 文本 / 1 私聊 / 2 分类 / 3 语音 */
  type?: number
  name?: string
}

export interface SatoriGuild {
  id: string
  name?: string
}

export interface SatoriMessage {
  id: string
  content?: string
}

export interface SatoriEvent {
  sn?: number
  type: string
  timestamp?: number
  login?: { user?: SatoriUser; platform?: string; status?: number }
  channel?: SatoriChannel
  guild?: SatoriGuild
  user?: SatoriUser
  message?: SatoriMessage
  /** 其它资源（member / operator / friend ……）原样保留。 */
  [key: string]: unknown
}

export interface SatoriLogin {
  user?: SatoriUser
  platform?: string
  status?: number
  features?: string[]
}

export interface SatoriClientOptions {
  /** `http://host:5140`、`ws://host:5140`、`http://host:5140/v1` 都认。 */
  endpoint: string
  token?: string
  /** HTTP 头 `Satori-Platform`；不在配置里写就等 READY 后从 login 拿。 */
  platform?: string
  /** HTTP 头 `Satori-User-ID`。 */
  selfId?: string
  log: SatoriLogger
  /** 心跳间隔，协议要求 10 秒。 */
  heartbeatMs?: number
  /** 重连最大退避。 */
  maxBackoffMs?: number
  /** 测试用：替换全局 WebSocket 实现。 */
  webSocketImpl?: typeof WebSocket
  onEvent?: (event: SatoriEvent) => void
  onReady?: (logins: SatoriLogin[]) => void
  /** 连接彻底断开（不再重连）或每次掉线时回调。 */
  onDown?: (reason: string) => void
}

const OP_EVENT = 0
const OP_PING = 1
const OP_PONG = 2
const OP_IDENTIFY = 3
const OP_READY = 4

interface Endpoints {
  http: string
  ws: string
}

/** 把用户填的地址拆成 HTTP 根与 WS 事件地址，末尾的 `/v1` 可有可无。 */
export function satoriEndpoints(endpoint: string): Endpoints {
  const url = new URL(String(endpoint || '').trim())
  const secure = url.protocol === 'wss:' || url.protocol === 'https:'
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  return {
    http: `${secure ? 'https' : 'http'}://${url.host}${path}`,
    ws: `${secure ? 'wss' : 'ws'}://${url.host}${path}/v1/events`,
  }
}

export class SatoriClient {
  private readonly options: SatoriClientOptions
  private readonly endpoints: Endpoints
  private socket: WebSocket | null = null
  private closed = false
  private attempt = 0
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastSn: number | undefined
  private lastPongAt = 0
  private logins: SatoriLogin[] = []
  private login?: SatoriLogin
  private cancelHandshake?: () => void
  private readonly WebSocketImpl: typeof WebSocket

  constructor(options: SatoriClientOptions) {
    this.options = options
    this.endpoints = satoriEndpoints(options.endpoint)
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket
  }

  get connected(): boolean {
    return Boolean(this.socket) && this.socket?.readyState === this.WebSocketImpl.OPEN && this.logins.length > 0
  }

  /** 连上并等到 READY；失败会继续在后台重连，但这一次调用直接抛错。 */
  async connect(): Promise<SatoriLogin[]> {
    if (this.socket) throw new Error('Satori 客户端已经在连接中，先 close() 再重连')
    this.closed = false
    return this.open()
  }

  /** 主动断开，不再重连。 */
  close(): void {
    this.cancelHandshake?.()
    this.closed = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    this.logins = []
    if (socket) {
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      try {
        socket.close(1000, 'client closed')
      } catch {
        // 已经断了就什么都不用做
      }
    }
  }

  bindLogin(login: SatoriLogin): void {
    this.login = login
  }

  /** 调一个 Satori API。返回值是协议里的 `data`，出错抛错。 */
  async call<T = unknown>(route: string, params: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`
    const login = this.login ?? (this.logins.length === 1 ? this.logins[0] : undefined)
    const platform = login?.platform || this.options.platform
    const selfId = login?.user?.id || this.options.selfId
    if (platform) headers['satori-platform'] = platform
    if (selfId) headers['satori-user-id'] = selfId

    const response = await fetch(`${this.endpoints.http}/v1/${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params ?? {}),
    })
    const text = await response.text()
    let body: Record<string, any> = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`Satori ${route} 返回的不是 JSON：${text.slice(0, 200)}`)
    }
    if (!response.ok) throw new Error(`Satori ${route} 失败：HTTP ${response.status} ${text.slice(0, 200)}`)
    if (body?.error) throw new Error(`Satori ${route} 报错：${body.error.code ?? ''} ${body.error.message ?? ''}`.trim())
    return (body?.data ?? body) as T
  }

  private open(): Promise<SatoriLogin[]> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: Error | null, logins?: SatoriLogin[]) => {
        if (settled) return
        settled = true
        this.cancelHandshake = undefined
        error ? reject(error) : resolve(logins ?? [])
      }

      const socket = new this.WebSocketImpl(this.endpoints.ws)
      this.socket = socket
      this.cancelHandshake = () => finish(new Error('Satori 连接已关闭'))

      socket.onopen = () => {
        this.options.log.debug(`Satori 已连上 ${this.endpoints.ws}，发送 IDENTIFY`)
        const identify: Record<string, unknown> = { op: OP_IDENTIFY, body: { token: this.options.token } }
        // 会话恢复：带上一次收到的 sn，SDK 会把断开期间的事件补过来
        if (this.lastSn !== undefined) (identify.body as Record<string, unknown>).sn = this.lastSn
        socket.send(JSON.stringify(identify))
      }

      socket.onmessage = (event) => {
        let packet: { op?: number; body?: any }
        try {
          packet = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (packet.op === OP_READY) {
          this.logins = Array.isArray(packet.body?.logins) ? packet.body.logins : []
          this.attempt = 0
          this.startHeartbeat()
          this.options.log.info(`Satori READY：${this.logins.map((login) => login.user?.id ?? '?').join(', ') || '无登录'}`)
          this.options.onReady?.(this.logins)
          finish(null, this.logins)
          return
        }
        if (packet.op === OP_PONG) {
          this.lastPongAt = Date.now()
          return
        }
        if (packet.op !== OP_EVENT) return
        const payload = packet.body as SatoriEvent
        if (payload && typeof payload.sn === 'number') this.lastSn = payload.sn
        try {
          this.options.onEvent?.(payload)
        } catch (error) {
          this.options.log.warn('Satori 事件处理出错：', String((error as Error)?.message ?? error))
        }
      }

      socket.onerror = () => {
        // 具体原因浏览器侧拿不到，close 里统一处理
        finish(new Error('Satori WebSocket 出错（详情见 close 事件）'))
      }

      socket.onclose = (event) => {
        this.clearTimers()
        this.socket = null
        this.logins = []
        const reason = `code=${event.code} ${event.reason || ''}`.trim()
        finish(new Error(`Satori 连接关闭：${reason || '未知原因'}`))
        if (this.closed) return
        this.options.onDown?.(reason)
        this.scheduleReconnect()
      }
    })
  }

  private startHeartbeat(): void {
    this.clearTimers()
    const interval = Math.max(3000, Number(this.options.heartbeatMs) || 10_000)
    this.lastPongAt = Date.now()
    this.pingTimer = setInterval(() => {
      const socket = this.socket
      if (!socket || socket.readyState !== this.WebSocketImpl.OPEN) return
      // 两个心跳周期都没有 PONG 就认为这条链路死了，主动断掉让重连接管
      if (Date.now() - this.lastPongAt > interval * 2.5) {
        this.options.log.warn('Satori 心跳超时，主动断开重连')
        try {
          socket.close(4001, 'heartbeat timeout')
        } catch {
          // 已经断了
        }
        return
      }
      try {
        socket.send(JSON.stringify({ op: OP_PING }))
      } catch {
        // 发送失败交给 onclose
      }
    }, interval)
    this.pingTimer.unref?.()
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return
    const max = Math.max(1000, Number(this.options.maxBackoffMs) || 30_000)
    const base = Math.min(max, 1000 * 2 ** Math.min(this.attempt, 5))
    // 加点抖动，多个实例同时掉线时别一起冲上去
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.attempt++
    this.options.log.warn(`Satori ${Math.round(delay / 1000)} 秒后重连（第 ${this.attempt} 次）`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.closed) return
      this.socket = null
      this.open().catch(() => {
        // 失败会由 onclose 再次排期；这里不用再动
      })
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.pingTimer = null
    this.reconnectTimer = null
  }
}
