// 面板/模块接口的 HTTP 底座：响应编码、请求体读取、访问闸（本机 / Host / CSRF）与路由登记。

import { encodeResponse } from '../../core/net/http-compress.ts'
import { redact } from '../../core/support/log/redact.ts'

export interface HttpOptions {
  ctx: any
  getConfig: () => any
  log: any
  prefix: string
  getMods: () => { routeAccess: (path: string) => string; handle: (path: string, req: any, res: any) => unknown } | null
}

export type RouteOptions = Partial<Record<"skipHostCheck", any>>

export function createHttp ({ ctx, getConfig, log, prefix, getMods } : HttpOptions) {

  // ---------- 面板接口的小工具 ----------
  const send = (res, code, body, type = 'application/json; charset=utf-8', req = null) => {
    try {
      const { payload, encoding } = encodeResponse(body, type, req?.headers?.['accept-encoding'] || '')
      res.statusCode = code
      res.setHeader?.('content-type', type)
      res.setHeader?.('cache-control', 'no-store')
      if (encoding) {
        res.setHeader?.('content-encoding', encoding)
        res.setHeader?.('vary', 'accept-encoding')
      }
      res.end?.(payload)
    } catch (error) {}
  }
  const readBody = async (req): Promise<Record<string, any>> => {
    let s = ''
    try { for await (const c of req) s += c } catch (error) {}
    try { return JSON.parse(s || '{}') } catch (error) { return {} }
  }
  /** 原样读请求体（上传大文件用），超过 max 字节就报错。 */
  const readRaw = async (req, max) => {
    const parts = []
    let n = 0
    for await (const c of req) {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c)
      n += b.length
      if (n > max) throw new Error(`文件太大了（最多 ${Math.round(max / 1024 / 1024)}MB）`)
      parts.push(b)
    }
    return Buffer.concat(parts)
  }
  const query = (req) => {
    try { return Object.fromEntries(new URL(req.url, 'http://x').searchParams) } catch (error) { return {} }
  }
  // 核心自己的接口登记成精确路径；模块的接口都走一个前缀路由，请求进来再查表
  // （模块随时开关、重新加载；关着的模块的接口回「模块没开」，面板不会白屏）
  const answer = async (req, res, fn) => {
    try {
      const r = await fn()
      if (r !== undefined) send(res, 200, r, 'application/json; charset=utf-8', req)
    } catch (error) {
      send(res, 200, { ok: false, message: redact(String(error && error.message ? error.message : error)) }, 'application/json; charset=utf-8', req)
    }
  }
  // ---------- 面板级访问闸（安全基线，2026-11-02） ----------
  // 背景：DSH 的 webServer 对插件路由**没有服务器级鉴权**，而面板接口是给本机面板用的管理接口
  //（能改配置、能装模块、能取联动密钥、能下客户端包）。同机部署时它只绑回环，本来打不到；
  // 但一旦用户把插件端口经反代发布到公网，整组管理接口就裸奔了。
  // 因此：**所有管理面默认只允许回环访问**。要做远端管理必须显式开 panelRemoteAccess（并在
  // 反代层再加一道认证——README 写明这是硬要求）。
  // 【首审 P1-1】闸的覆盖范围不能只有 /panel/*：/state（能读到全部配置与密钥）、/save（能改配置）、
  // /logs、/modules*（能装代码）、/bridge/token（直接返回联动密钥）
  // 这些**都是管理面**，必须一起纳入。只有客户端直连用的 /ext/<模块>/* 与 /asset/* 不受此闸限制
  //（它们各自有 token 校验）。
  const isLoopbackAddr = (ip) => {
    const s = String(ip || '')
    return s === '::1' || s === '127.0.0.1' || s === '::ffff:127.0.0.1' || /^127\./.test(s) || s.startsWith('::ffff:127.')
  }
  const normAddr = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '')
  /** 可信反代地址列表（security.trustedProxy，逗号分隔；留空 = 从不相信任何转发头）。 */
  const trustedProxies = () => String(getConfig().security?.trustedProxy || '').split(',').map(normAddr).filter(Boolean)
  /** 请求是否来自本机回环。
   *  【首审 P1-2 修法】**socket 地址才是唯一可信来源**，X-Forwarded-For 是客户端自己能写的头。
   *  旧实现「有 XFF 就只认最后一跳、不看 socket」→ 直连暴露时客户端自带
   *  `X-Forwarded-For: 127.0.0.1` 就能 200 绕过（含 client-package 令牌下载）。
   *  新口径：
   *    ① socket 非回环 → 一律按 socket 判，转发头完全不看；
   *    ② socket 是回环且来源命中 trustedProxy → 才采信 XFF 的**最后一跳**（反代追加的真实来源）；
   *    ③ 其余（本机直连 / 进程内直调）→ 算本机。 */
  const requestIsLocal = (req) => {
    const sock = normAddr(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '')
    // 没有 socket 信息 = 进程内直调（测试 / 内部转发），按本机处理。
    // 真实 HTTP 请求一定有 remoteAddress，所以这里不会削弱对外拦截。
    if (!sock) return true
    if (!isLoopbackAddr(sock)) return false // ① 直连：只信 socket
    const list = trustedProxies()
    if (list.length && list.includes(sock)) { // ② 可信反代：看最后一跳
      const hops = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((x) => normAddr(x)).filter(Boolean)
      if (hops.length) return isLoopbackAddr(hops[hops.length - 1])
      // 【复审 2·P1-1】反代场景却没带 XFF：反代没配好（没追加转发头）。按回环放行等于
      // 「反代后的所有用户都被当成本机」——这是 fail-open。兜成 fail-closed：拒绝。
      return false
    }
    return isLoopbackAddr(sock) // ③ 本机直连
  }
  const panelNeedsLocal = () => getConfig().security?.panelRemoteAccess !== true
  /** 管理面白名单：这些前缀之外的一律不算管理接口（客户端直连用的模块接口与素材不拦）。 */
  const ADMIN_EXEMPT_PREFIXES = [prefix + '/ext/', prefix + '/asset/', prefix + '/open/']
  /** 面板闸：命中管理面且不允许远端时拒绝。
   *  【首审 P1-1】从「只拦 /panel/*」扩到「拦整个 prefix 下除客户端接口外的所有路由」——
   *  默认拒绝比逐条列举安全：将来新增管理路由忘了登记也不会裸奔。
   *  【复审 P1-2】/open/* 是给外部程序（curl / 脚本）用的开放接口，有自己的
   *  `Authorization: Bearer 密钥` 鉴权（bridge.authorized），跨机带正确密钥必须放行——
   *  它不是浏览器面板的一部分，不该被本机闸拦。 */
  const panelBlocked = (req, res, force = false) => {
    let path = ''
    try { path = new URL(req.url, 'http://x').pathname } catch { return false }
    if (!path.startsWith(prefix + '/') && path !== prefix) return false
    if (!force && ADMIN_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return false
    if (!panelNeedsLocal()) return false
    if (requestIsLocal(req)) return false
    log.warn(`管理接口拒绝远端访问：${path}（来源不是回环；如需远端管理请开 security.panelRemoteAccess 并在反代加认证）`)
    send(res, 403, { ok: false, message: '管理接口只允许本机访问。远端管理需在配置里显式开启 security.panelRemoteAccess，并务必在反向代理层再加一道认证' })
    return true
  }
  /** 主机名归一化：去首尾空白、转小写、去 IPv6 方括号、去结尾点（Host 与 Origin 共用同一口径）。 */
  const normalizeHost = (raw) => String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  /** 剥端口：必须在归一化之前剥——IPv6 Host 是 `[::1]:5099`，先去方括号的话结尾是数字、`]` 剥不掉，剩个 `::1]` 就再也匹配不上。 */
  const stripHostPort = (raw) => String(raw || '').replace(/:\d+$/, '')
  /**
   * 面板对外主机名列表（security.publicHostname，反代部署时填面板对外域名；空 = 只有回环算同源）。
   * 可填多个，用逗号分隔；中文逗号、分号、空白也当分隔符（手写配置时不至于因为多按了个空格就失配）——
   * 反代部署常见「对外域名 + 内网直连地址」两个入口同时开面板，只认一个值的话另一个入口一保存配置就被 403。
   * 列表项与请求 Host 走同一口径（先剥端口再归一化）：内网直连地址平时都带端口，照直填进来也不会永不匹配。
   */
  const panelPublicHosts = () => String(getConfig().security?.publicHostname || '')
    .split(/[\s,，;；]+/)
    .map((item) => normalizeHost(stripHostPort(item)))
    .filter(Boolean)
  /** Origin 主机名是否算「同源」：回环 / localhost / 任一已配置的面板对外域名。 */
  const originAllowed = (hostname) => {
    const h = normalizeHost(hostname)
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost') || isLoopbackAddr(h)) return true
    return panelPublicHosts().includes(h)
  }
  /**
   * 【复审 2·P1-1】管理面 Host 允许名单（防 DNS rebinding）。
   * 攻击：恶意页面把 evil.example 的 DNS rebind 到 127.0.0.1，然后 `fetch('http://evil.example:port/state')`
   * ——socket 是本机回环（本机闸放行）、方法是 GET（不过 CSRF）→ 管理面被「同源可读」：
   * /state、/logs、/bridge/token（返回 bearer）、client-package（含令牌）全部外泄。
   * 修法：管理面请求的 Host 头必须在白名单内（回环 / localhost / publicHostname 列表任一项）。
   * Host 头虽是请求方可控的，但浏览器同源策略保证「页面 JS 发出的请求 Host = 页面所在的源」——
   * rebinding 页面发出的 Host 就是 evil.example 本身，进不了白名单；同源面板请求 Host 必然是
   * 127.0.0.1 / localhost / publicHostname 列表里任一项。非浏览器客户端（curl/脚本）不受浏览器防护，
   * 但它们也不是 rebinding 载体，且有各自的鉴权层。
   */
  const hostAllowedForAdmin = (hostRaw) => {
    // 复审 3·小建议：先剥端口再剥方括号。IPv6 回环 Host 是 `[::1]:5099`——
    // 若先剥 `[` 再剥 `]`，结尾已是数字，`]` 剥不掉，端口剥完剩 `::1]`，会被 403。
    const h = normalizeHost(stripHostPort(hostRaw))
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost')) return true
    if (isLoopbackAddr(h)) return true
    return panelPublicHosts().includes(h)
  }
  /** Host 校验 + 失败响应。只用于管理面（模块路由的 Host 另有 Host 闸策略）。 */
  const adminHostBlocked = (req, res) => {
    const hostHeader = String(req.headers?.host || '')
    if (hostAllowedForAdmin(hostHeader)) return false
    log.warn(`管理接口拒绝异常 Host：${hostHeader}（疑似 DNS rebinding；白名单：回环/localhost/security.publicHostname 任一项）`)
    send(res, 403, { ok: false, message: '管理接口拒绝该 Host（只接受本机回环、localhost 或已配置的面板对外域名）' })
    return true
  }
  /** 【复审 P1-1】CSRF 闸：所有改状态的方法都要过同源校验。
   *  背景（复审实测）：恶意网页可以从攻击者页面 `fetch('http://127.0.0.1:<port>/save', {method:'POST'})`——
   *  请求 socket 是本机回环（面板闸放行）、方法 POST、跨站。没有 CSRF 校验的话
   *  `/save`、`/panel/pet/public-base`、rotate、client-package 全都能被恶意页面打穿，无需暴露端口。
   *  口径：
   *    ① 只管写方法（GET/HEAD/OPTIONS 不管——它们不该有副作用）；
   *    ② 浏览器一定带 `Sec-Fetch-Site`：值不在 {same-origin, same-site, none} → 跨站，拒；
   *    ③ 浏览器跨站 fetch 也一定带 `Origin`：主机名不在同源白名单 → 拒；
   *    ④ 两者都没有 = 非浏览器客户端（curl / 脚本）——不是 CSRF 载体，放行，
   *       它们的防线是各自的鉴权（管理面 = 本机闸，/open/* = Bearer 密钥）。 */
  const csrfBlocked = (req, res) => {
    const method = String(req.method || 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
    const site = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase()
    if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
      log.warn(`CSRF 拒绝（Sec-Fetch-Site=${site}）：${req.method} ${req.url}`)
      send(res, 403, { ok: false, message: '跨站请求被拒绝（Sec-Fetch-Site 不符）' })
      return true
    }
    const origin = String(req.headers?.origin || '').trim()
    if (origin) {
      let host = ''
      try { host = new URL(origin).hostname } catch {}
      if (!originAllowed(host)) {
        log.warn(`CSRF 拒绝（Origin=${origin}）：${req.method} ${req.url}`)
        send(res, 403, { ok: false, message: '跨站请求被拒绝（Origin 不在同源白名单）' })
        return true
      }
    }
    return false
  }
  /** 面板闸：面板写/读接口统一过它（见上方 panelBlocked 说明）。
   *  opts.skipHostCheck：给 /open/* 这类「非浏览器、自带密钥鉴权」的接口用——
   *  它们没有浏览器同源概念，跨机调用是正常用法，Host 允许名单不该拦。 */
  const route = (path, handler, opts : RouteOptions = {}) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: prefix + path,
    handler: (req, res) => answer(req, res, () => {
      if (panelBlocked(req, res)) return undefined
      if (!opts.skipHostCheck && adminHostBlocked(req, res)) return undefined // DNS rebinding 防护（含 GET）
      if (csrfBlocked(req, res)) return undefined
      return handler(req, res)
    }),
  }), `aurabot: 路由 ${path}`)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: prefix, // DSH 按「路径 = 前缀 或 以 前缀/ 开头」匹配，前缀本身不带结尾的 /
    handler: (req, res) => answer(req, res, () => {
      let path = ''
      try { path = new URL(req.url, 'http://x').pathname } catch (error) {}
      // 【复审 2·P1-2】模块 prefix 路由也过 CSRF：实测本机 socket + 恶意 Origin 能跨站打
      // POST /aurabot/api/heybox/run、/ext/phone/run 等无 token 的模块路由（真实触发逛/ADB）。
      // 模块路由有自己的 Host 闸与鉴权，但同样缺跨站防护；桌宠 native 客户端不带 Origin，
      // 不受影响；桌面面板的 fetch 是同源，也不受影响。
      if (csrfBlocked(req, res)) return undefined
      if (getMods().routeAccess(path) === 'panel' && (panelBlocked(req, res, true) || adminHostBlocked(req, res))) return undefined
      return getMods().handle(path, req, res)
    }),
  }), 'aurabot: 模块接口')

  return { send, readBody, readRaw, query, answer, route, panelBlocked, adminHostBlocked, csrfBlocked, isLoopbackAddr, panelNeedsLocal }
}
