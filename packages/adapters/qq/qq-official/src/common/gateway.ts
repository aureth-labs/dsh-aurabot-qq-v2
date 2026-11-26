/**
 * QQ 开放平台网关（WebSocket）。
 *
 * QQ 频道机器人与 QQ 官方机器人共用同一套 op 协议，区别只有 intents 和事件名。
 * 这里只做「连接 + 心跳 + 鉴权 + 分发」，事件翻译在各适配器自己的 index.ts 里。
 */

export const QQ_OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

/** 只用到 WebSocket 的这一小撮能力，方便测试里换成假实现。 */
export interface GatewaySocket {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: (event: any) => void): void
}

export type GatewaySocketFactory = (url: string) => GatewaySocket

export interface QQGatewayOptions {
  /** 默认 `wss://api.sgroup.qq.com/websocket`。 */
  url?: string
  /** 每次 IDENTIFY / RESUME 现取，token 会过期。 */
  token: () => Promise<string>
  intents: number
  log?: (message: string) => void
  /** 收到 DISPATCH 时调用；`READY` 也会走这里，方便拿 selfId。 */
  onDown?: (reason: string) => void
  onDispatch: (type: string, data: Record<string, any>, sn?: number) => void
  socketFactory?: GatewaySocketFactory
  /** 断线自动重连次数，默认 3；0 表示不重连。 */
  maxRetries?: number
  /** 等 READY 的超时，默认 20 秒。 */
  readyTimeoutMs?: number
}

interface GatewayPayload {
  op: number
  s?: number
  t?: string
  d?: any
}

const DEFAULT_URL = 'wss://api.sgroup.qq.com/websocket'

/**
 * 一个网关连接。`connect()` 在收到 READY 后 resolve，失败或超时则 reject。
 *
 * 不要自己写重连循环：断线重连、RESUME、心跳都在这里，适配器只管收事件。
 */
export class QQGateway {
  private readonly options: QQGatewayOptions
  private socket: GatewaySocket | null = null
  private seq: number | null = null
  private sessionId = ''
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private retries = 0
  private closed = false
  private handshakeTimer?: ReturnType<typeof setTimeout>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null

  constructor(options: QQGatewayOptions) {
    this.options = options
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      const timeoutMs = this.options.readyTimeoutMs ?? 20_000
      this.handshakeTimer = setTimeout(() => {
        this.rejectReady(new Error(`QQ 网关 ${timeoutMs}ms 内没有收到 READY`))
      }, timeoutMs)
      this.handshakeTimer.unref?.()
      this.open()
    })
  }

  close(): void {
    this.closed = true
    clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    try {
      this.socket?.close()
    } catch {
      // 已经断了，忽略
    }
    this.socket = null
    this.rejectReady(new Error('QQ 网关已关闭'))
  }

  private open(): void {
    const factory: GatewaySocketFactory =
      this.options.socketFactory ?? ((url) => new WebSocket(url) as unknown as GatewaySocket)
    let socket: GatewaySocket
    try {
      socket = factory(this.options.url ?? DEFAULT_URL)
    } catch (error) {
      this.rejectReady(asError(error))
      return
    }
    this.socket = socket

    socket.addEventListener('message', event => {
      if (this.socket === socket && !this.closed) this.onMessage(event)
    })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.scheduleReconnect('连接断开')
    })
    socket.addEventListener('error', (event) => {
      this.options.log?.(`QQ 网关出错：${describeError(event)}`)
    })
  }

  private onMessage(event: any): void {
    let payload: GatewayPayload
    try {
      payload = JSON.parse(String(event?.data ?? '')) as GatewayPayload
    } catch {
      this.options.log?.('QQ 网关收到非 JSON 数据，已忽略')
      return
    }
    if (typeof payload?.op !== 'number') return
    if (typeof payload.s === 'number') this.seq = payload.s

    switch (payload.op) {
      case QQ_OP.HELLO:
        this.startHeartbeat(Number(payload.d?.heartbeat_interval) || 30_000)
        void this.identify()
        return
      case QQ_OP.HEARTBEAT_ACK:
        return
      case QQ_OP.HEARTBEAT:
        this.sendHeartbeat()
        return
      case QQ_OP.RECONNECT:
        this.scheduleReconnect('服务端要求重连')
        return
      case QQ_OP.INVALID_SESSION:
        this.sessionId = ''
        this.seq = null
        this.scheduleReconnect('会话失效，重新鉴权')
        return
      case QQ_OP.DISPATCH:
        this.dispatch(payload)
        return
      default:
        return
    }
  }

  private dispatch(payload: GatewayPayload): void {
    const type = String(payload.t ?? '')
    const data = (payload.d ?? {}) as Record<string, any>
    if (type === 'READY') {
      this.sessionId = String(data.session_id ?? '')
    }
    if (type === 'READY' || type === 'RESUMED') {
      clearTimeout(this.handshakeTimer)
      this.retries = 0
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
    }
    this.options.onDispatch(type, data, payload.s ?? undefined)
  }

  private async identify(): Promise<void> {
    const socket = this.socket
    if (!socket) return
    let token: string
    try {
      token = await this.options.token()
    } catch (error) {
      this.rejectReady(asError(error))
      return
    }
    if (socket !== this.socket || this.closed) return
    if (this.sessionId && this.seq !== null) {
      socket.send(
        JSON.stringify({
          op: QQ_OP.RESUME,
          d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.seq },
        }),
      )
      return
    }
    socket.send(
      JSON.stringify({
        op: QQ_OP.IDENTIFY,
        d: {
          token: `QQBot ${token}`,
          intents: this.options.intents,
          shard: [0, 1],
          properties: { $os: process.platform, $browser: 'aurabot', $device: 'aurabot' },
        },
      }),
    )
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    const interval = Math.max(5_000, intervalMs)
    // lifecycle-safe: close / dispose 调 stopHeartbeat() 清掉，socket 生命周期内的心跳
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval)
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private sendHeartbeat(): void {
    try {
      this.socket?.send(JSON.stringify({ op: QQ_OP.HEARTBEAT, d: this.seq }))
    } catch {
      // 发不出去说明已经断了，close 事件会接管重连
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.closed) return
    this.options.onDown?.(reason)
    const max = this.options.maxRetries ?? 3
    const socket = this.socket
    this.socket = null
    this.stopHeartbeat()
    try {
      socket?.close()
    } catch {
      // 连接已经关闭。
    }
    if (this.retries >= max) {
      this.rejectReady(new Error(`QQ 网关重连 ${max} 次仍失败：${reason}`))
      return
    }
    this.retries += 1
    const delay = Math.min(30_000, 1_000 * 2 ** (this.retries - 1))
    this.options.log?.(`QQ 网关${reason}，${delay}ms 后第 ${this.retries} 次重连`)
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.open()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private rejectReady(error: Error): void {
    clearTimeout(this.handshakeTimer)
    this.readyReject?.(error)
    this.readyReject = null
    this.readyResolve = null
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function describeError(event: unknown): string {
  const message = (event as { message?: unknown } | undefined)?.message
  return message ? String(message) : '未知错误'
}
