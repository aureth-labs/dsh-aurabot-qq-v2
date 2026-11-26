/**
 * QQ 开放平台 HTTP 调用。
 *
 * 两种机器人共用同一个域名，区别只在路径：
 *   频道：/channels/{channel_id}/messages、/users/@me/dms
 *   官方：/v2/groups/{group_openid}/messages、/v2/users/{openid}/messages
 */

export interface QQOpenApiOptions {
  token: () => Promise<string>
  baseUrl?: string
  fetchImpl?: typeof fetch
  log?: (message: string) => void
}

const DEFAULT_BASE = 'https://api.sgroup.qq.com'

export class QQOpenApi {
  private readonly options: QQOpenApiOptions

  constructor(options: QQOpenApiOptions) {
    this.options = options
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const token = await this.options.token()
    const url = (this.options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '') + path
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 204) return {} as T
    const text = await response.text()
    let parsed: unknown = {}
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 500) }
      }
    }
    if (!response.ok) {
      const detail = JSON.stringify(parsed).slice(0, 300)
      this.options.log?.(`QQ API ${method} ${path} 失败：HTTP ${response.status} ${detail}`)
      throw new Error(`QQ API ${method} ${path} 失败：HTTP ${response.status} ${detail}`)
    }
    return parsed as T
  }
}
