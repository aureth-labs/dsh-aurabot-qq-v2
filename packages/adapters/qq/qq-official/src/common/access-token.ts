/**
 * QQ 开放平台的 AccessToken。
 *
 * 频道机器人与官方机器人现在都走 `POST https://bots.qq.com/app/getAppAccessToken`：
 * 传 AppID + AppSecret，换一个两小时左右的 token。同一份凭据缓存复用，过期前主动刷新。
 */

export interface AccessTokenOptions {
  appId: string
  clientSecret: string
  /** 默认官方地址；测试里换成假地址。 */
  endpoint?: string
  fetchImpl?: typeof fetch
  /** 提前多少毫秒算过期，默认 60 秒。 */
  skewMs?: number
}

interface AccessTokenResponse {
  access_token?: string
  expires_in?: string | number
  code?: number
  message?: string
}

const DEFAULT_ENDPOINT = 'https://bots.qq.com/app/getAppAccessToken'

export class AccessTokenProvider {
  private readonly options: AccessTokenOptions
  private cached: { token: string; expiresAt: number } | null = null
  private inflight: Promise<string> | null = null

  constructor(options: AccessTokenOptions) {
    this.options = options
  }

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  invalidate(): void {
    this.cached = null
  }

  private async fetchToken(): Promise<string> {
    const { appId, clientSecret } = this.options
    if (!appId || !clientSecret) throw new Error('QQ 适配器要填 appId 和 clientSecret')
    const fetchImpl = this.options.fetchImpl ?? fetch
    const response = await fetchImpl(this.options.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret }),
    })
    const text = await response.text()
    let body: AccessTokenResponse
    try {
      body = JSON.parse(text) as AccessTokenResponse
    } catch {
      throw new Error(`换取 AccessToken 失败：HTTP ${response.status}，响应不是 JSON`)
    }
    if (!response.ok || !body.access_token) {
      const detail = body.message || body.code || text.slice(0, 200)
      throw new Error(`换取 AccessToken 失败：HTTP ${response.status} ${String(detail)}`)
    }
    const ttlMs = (Number(body.expires_in) || 7200) * 1000
    const skew = this.options.skewMs ?? 60_000
    this.cached = { token: body.access_token, expiresAt: Date.now() + Math.max(30_000, ttlMs - skew) }
    return body.access_token
  }
}
