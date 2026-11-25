

const API = '/aurabot/api'

// ---------------- 小工具 ----------------
const get = (p) => fetch(API + p, { cache: 'no-store' }).then((r) => r.json()).catch((e) => ({ ok: false, message: '连不上插件：' + e.message }))

// 面板 tab 缓存：GET 结果 30 秒内复用，切 tab 不重复拉；任何 POST 成功或上传后清空。
const getCache = new Map()

const CACHE_TTL = 30000

const bustCache = () => getCache.clear()

const getCached = (p, force = false) => {
  const hit = getCache.get(p)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data)
  return get(p).then((data) => {
    if (!data || data.ok !== false) getCache.set(p, { at: Date.now(), data })
    return data
  })
}

const post = (p, body?) =>
  fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => r.json())
    .then((data) => { if (!data || data.ok !== false) bustCache(); return data })
    .catch((e) => ({ ok: false, message: '连不上插件：' + e.message }))

const clone = (o) => JSON.parse(JSON.stringify(o))

// 把 publicConfig 的 *Set 标志对应的 secret 字段清空（保留「已设置」状态）。
// 保存回执的基线只能带脱敏后的 secret 值，否则会把明文长期留在草稿里，
// 下次改同段其它字段时又整段回传，覆盖别的客户端刚轮换的新密钥（#520 复审）。
const maskSecretFields = (value, source = null) => {
  const walk = (node, src) => {
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, src && typeof src === 'object' ? src[k] : null)
      if (k.endsWith('Set') && typeof v === 'boolean') {
        const base = k.slice(0, -3)
        // 只清「本来就是这次提交的旧值」；用户在保存期间新敲的 secret 不动。
        if (base && Object.hasOwn(node, base) && (!source || !src || node[base] === src[base])) node[base] = ''
      }
    }
  }
  walk(value, source)
  return value
}

// 把服务端 publicConfig 的 *Set / *Hint 标志同步到本地草稿（保留「已设置」提示）。
const copySecretFlags = (target, source) => {
  const walk = (node, src) => {
    if (!node || typeof node !== 'object' || !src || typeof src !== 'object') return
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object') walk(node[k], v)
      else if ((k.endsWith('Set') || k.endsWith('Hint')) && Object.hasOwn(node, k)) node[k] = v
    }
  }
  walk(target, source)
  return target
}

// ---------------- 面板轻量读取层（首屏提速，2026-11-16） ----------------
// 同 URL 在途合并：相同地址只放行一个在途请求，周期轮询重叠时复用同一个 Promise，防止连环打。
const inflight = new Map()

const sharedGet = (p) => {
  if (inflight.has(p)) return inflight.get(p)
  const pr = get(p).finally(() => inflight.delete(p))
  inflight.set(p, pr)
  return pr
}

// 轻量 GET（/panel/bootstrap、/panel/pulse、/panel/config）：3 秒截止（AbortController），
// 失败按可识别原因归类（超时/启动中/连不上/权限受限），退避节奏由调用方（根组件）控制。
// 旧 /state 与各诊断接口不经过这里，保持原有行为。
const PANEL_READ_TIMEOUT = 3000

const panelGet = (p, opts) => {
  const timeout = (opts && opts.timeout) || PANEL_READ_TIMEOUT
  const registry = opts && opts.registry
  const ctl = new AbortController()
  if (registry) registry.add(ctl)
  const done = (v) => { clearTimeout(timer); if (registry) registry.delete(ctl); return v }
  const timer = setTimeout(() => ctl.abort(), timeout)
  return fetch(API + p, { cache: 'no-store', signal: ctl.signal })
    .then(async (r) => {
      const data = await r.json().catch(() => null)
      if (!data) return done({ ok: false, code: 'CONNECT', message: '暂时连不上插件：响应不是合法 JSON' })
      if (r.status === 503 && data.code === 'BOOTSTRAPPING') return done({ ok: false, code: 'BOOTSTRAPPING', bootId: data.bootId, message: '插件正在启动' })
      if (r.status === 401 || r.status === 403) return done({ ok: false, code: 'AUTH', message: '权限受限：当前身份没有打开面板的权限' })
      if (!r.ok) return done({ ok: false, code: 'CONNECT', message: '暂时连不上插件（HTTP ' + r.status + '）' })
      return done(data)
    })
    .catch((e) => {
      if (e && e.name === 'AbortError') return done({ ok: false, code: 'TIMEOUT', message: '读取超时（' + Math.round(timeout / 1000) + ' 秒），插件还没有应答' })
      return done({ ok: false, code: 'CONNECT', message: '暂时连不上插件：' + (e && e.message ? e.message : e) })
    })
}

// 轻量 GET 也走在途合并（同一地址同时只有一个在途请求）
const sharedPanelGet = (p, opts) => {
  const key = 'panel:' + p
  if (inflight.has(key)) return inflight.get(key)
  const pr = panelGet(p, opts).finally(() => inflight.delete(key))
  inflight.set(key, pr)
  return pr
}

const bustPanelGet = (p) => { inflight.delete('panel:' + p) }

export { API, get, getCache, CACHE_TTL, bustCache, getCached, post, clone, maskSecretFields, copySecretFlags, inflight, sharedGet, PANEL_READ_TIMEOUT, panelGet, sharedPanelGet, bustPanelGet }
