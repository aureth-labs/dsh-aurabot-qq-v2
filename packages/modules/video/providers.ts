import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { dataDir } from '../../../src/core/store/index.ts'
import { setTimeout as delay } from 'node:timers/promises'
import { fetchImage } from '../../../src/core/net/index.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type RequestJsonOptions = Partial<Record<'label' | 'method' | 'headers' | 'body' | 'timeoutMs' | 'retry' | 'signal', any>>

/** 脚本的返回值统一成文件路径：字符串或 { file }。 */
export const videoFile = (r) => String(typeof r === 'string' ? r : r?.file || '').trim()

export const MINIMAX_MODELS = ['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max']
export const RESOLUTIONS = ['480P', '768P', '2K']
export const RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', 'adaptive']


/** 模板里的 {xxx} 换成 URL 编码后的值；不认识的占位符原样保留。 */
export function fillUrl(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : encodeURIComponent(String(vars[k]))))
}

/** 模板里的 {xxx} 换成 JSON 转义后的值（不带引号），prompt 里有引号/换行也不会把 JSON 打散。 */
export function fillJson(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => {
    if (vars[k] === undefined || vars[k] === null) return m
    const s = JSON.stringify(String(vars[k]))
    return s.slice(1, -1)
  })
}

/** 按 "task.content.url" 这种路径取值。 */
export function dotted(obj, path) {
  let cur = obj
  for (const k of String(path || '').split('.').map((s) => s.trim()).filter(Boolean)) {
    if (cur === null || cur === undefined) return null
    cur = cur[k]
  }
  return cur ?? null
}

/** 请求头文本 → 对象：一行一个「Key: Value」。 */
export function parseHeaders(text) {
  const out: Record<string, any> = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf(':')
    if (i > 0) out[s.slice(0, i).trim()] = s.slice(i + 1).trim()
  }
  return out
}

/** 分辨率要跟模型匹配：只有 H3 支持 2K。 */
export function clampResolution(model, resolution) {
  const m = MINIMAX_MODELS.includes(model) ? model : 'MiniMax-H3'
  const r = RESOLUTIONS.includes(resolution) ? resolution : '768P'
  if (m !== 'MiniMax-H3' && r === '2K') return '768P'
  return r
}

/** MiniMax 请求体（纯函数，方便单测）。 */
export function minimaxBody({ prompt, seconds, image, cfg }) {
  const m = cfg.video?.minimax || {}
  const model = MINIMAX_MODELS.includes(m.model) ? m.model : 'MiniMax-H3'
  const minDur = model === 'MiniMax-H3-Max' ? 5 : 4
  const duration = Math.max(minDur, Math.min(15, Math.round(Number(seconds) || Number(m.duration) || 5)))
  const ratio = image ? 'adaptive' : (RATIOS.includes(m.ratio) && m.ratio !== 'adaptive' ? m.ratio : '16:9')
  const content: any[] = [{ type: 'text', text: String(prompt || '') }]
  if (image) content.push({ type: 'image_url', image_url: { url: image }, role: 'first_frame' })
  return { model, content, resolution: clampResolution(model, m.resolution), duration, ratio }
}

/** 自定义接口的请求拼装（纯函数，方便单测）。 */
export function customRequestParts({ prompt, seconds, image, cfg, taskId = '' }) {
  const c = cfg.video?.custom || {}
  const vars = { prompt: String(prompt || ''), seconds: seconds ?? '', image: image || '', reqid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), taskId }
  const method = String(c.createMethod || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  return {
    method,
    createUrl: fillUrl(c.createUrl, vars),
    queryUrl: fillUrl(c.queryUrl, { ...vars, taskId }),
    headers: parseHeaders(c.headers),
    body: method === 'POST' ? fillJson(c.body || '{"prompt":"{prompt}"}', vars) : '',
  }
}

/** 这个接口现在能不能用（没配好就不挂工具）。 */
export function videoReady(cfg, local) {
  const v = cfg.video || {}
  if ((v.provider || 'local') === 'local') return Boolean(local?.active?.('video'))
  if (v.provider === 'minimax') return Boolean(String(v.minimax?.apiKey || '').trim())
  if (v.provider === 'custom') return Boolean(String(v.custom?.createUrl || '').trim() && String(v.custom?.queryUrl || '').trim())
  return false
}

/** 参考图：URL / data URI / 本机绝对路径 → 可直接放进请求的值。 */
function resolveImage(image) {
  const s = String(image || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s) || /^data:/i.test(s)) return s
  if (isAbsolute(s) && existsSync(s)) {
    const ext = extname(s).toLowerCase().replace('.', '')
    const mime = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : ext === 'gif' ? 'gif' : 'jpeg'
    return `data:image/${mime};base64,${readFileSync(s).toString('base64')}`
  }
  throw new Error('参考图要是公网地址、data URI，或本机的绝对路径')
}

/** 落盘：文件名只留安全字符（避免远端 taskId 里带 ../ 或 :）。 */
function saveVideo(buf, name) {
  const dir = dataDir('video-out')
  mkdirSync(dir, { recursive: true })
  const safe = String(name || 'video').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'video'
  const file = join(dir, `${safe}.mp4`)
  writeFileSync(file, buf)
  return file
}

const looksLikeMp4 = (buf) => buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp'

async function download(url: string, cfg, signal: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) throw Error('视频结果需要 HTTP 地址')
  const buf = await fetchImage(url, { maxBytes: (Number(cfg.files?.maxMB) || 50) * 1048576, timeoutMs: 180000, allowLocal: false, signal })
  if (buf.length < 10_000) throw new Error('下载到的视频太小：' + buf.length)
  if (!looksLikeMp4(buf)) throw new Error('下载到的文件不像 mp4（可能被网关拦了）')
  return buf
}

/** 普通 JSON 请求（创建/轮询用；不经过 SSRF 闸，兼容自建局域网接口）。 */
async function requestJson(url, { label = '请求', method = 'GET', headers = {}, body, timeoutMs = 60_000, retry = false, signal } : RequestJsonOptions = {}) {
  const attempts = retry ? 3 : 1
  let lastError = null
  for (let i = 1; i <= attempts; i++) {
    const r = await fetch(url, { method, headers, body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
    const raw = await r.text().catch(() => '')
    let json = null
    try { json = JSON.parse(raw) } catch (error) {}
    // 轮询期间偶发 429/5xx 不要判死整个任务，退避后重试
    if (retry && (r.status === 429 || r.status >= 500) && i < attempts) {
      lastError = new Error(`${label}失败 HTTP ${r.status}：${raw.slice(0, 120)}`)
      await delay(1500 * i, undefined, { signal })
      continue
    }
    if (!r.ok) throw new Error(`${label}失败 HTTP ${r.status}：${(json && JSON.stringify(json).slice(0, 160)) || raw.slice(0, 160)}`)
    if (!json) throw new Error(`${label}返回不是 JSON：${raw.slice(0, 160)}`)
    return json
  }
  throw lastError || new Error(`${label}失败`)
}

/** MiniMax H3：/v2/video_generation 创建，/v2/query/video_generation/{id} 轮询。 */
export async function minimaxGenerate({ prompt, seconds, image, cfg, log, timeoutMs, signal }) {
  const m = cfg.video?.minimax || {}
  const key = String(m.apiKey || '').trim()
  if (!key) throw new Error('没填 MiniMax API Key')
  const base = String(m.baseUrl || 'https://ctx.minimax.cn').replace(/\/+$/, '')
  const ref = image ? resolveImage(image) : ''
  const body = minimaxBody({ prompt, seconds, image: ref, cfg })

  log?.info?.(`MiniMax ${body.model} ${body.resolution} ${body.duration}s ${body.ratio}${ref ? ' +首帧' : ''}，提交任务…`)
  const created = await requestJson(base + '/v2/video_generation', {
    signal, label: '创建任务',
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const taskId = created?.task_id
  if (!taskId) throw new Error('没拿到 task_id：' + JSON.stringify(created).slice(0, 200))

  const started = Date.now()
  const pollMs = Math.max(1000, Math.min(60_000, Number(m.pollMs) || 5000))
  for (;;) {
    await delay(pollMs, undefined, { signal })
    const q = await requestJson(`${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
      signal, label: '查询任务',
      retry: true,
      headers: { authorization: 'Bearer ' + key },
      timeoutMs: 30_000,
    })
    const task = q?.task || q
    if (task?.status === 'succeeded') {
      const url = task?.content?.url
      if (!url) throw new Error('任务成功但没有视频地址')
      return saveVideo(await download(url, cfg, signal), 'minimax-' + taskId)
    }
    if (task?.status === 'failed' || task?.status === 'cancelled') {
      throw new Error(`生成失败（${task.status}）：${task?.error?.message || task?.error?.code || '未知原因'}`)
    }
    if (Date.now() - started > timeoutMs) throw new Error(`等太久还没好，任务 ${taskId} 可以稍后用接口查`)
    log?.info?.(`生成中（${task?.status || '排队'}），已等 ${Math.round((Date.now() - started) / 1000)} 秒`)
  }
}

/** 自定义异步任务接口：创建 → 轮询 → 下载，字段全部可配。 */
export async function customGenerate({ prompt, seconds, image, cfg, log, timeoutMs, signal }) {
  const c = cfg.video?.custom || {}
  if (!String(c.createUrl || '').trim() || !String(c.queryUrl || '').trim()) throw new Error('还没填创建地址 / 轮询地址')
  const ref = image ? resolveImage(image) : ''
  const parts = customRequestParts({ prompt, seconds, image: ref, cfg })

  log?.info?.('提交自定义视频任务…')
  const created = await requestJson(parts.createUrl, {
    signal, label: '创建任务',
    method: parts.method,
    headers: { 'content-type': 'application/json', ...parts.headers },
    body: parts.method === 'POST' ? parts.body : undefined,
  })
  const taskId = dotted(created, c.taskIdPath || 'task_id')
  if (!taskId) throw new Error('没取到任务 ID（检查「任务 ID 路径」）：' + JSON.stringify(created).slice(0, 200))

  const started = Date.now()
  const pollMs = Math.max(1000, Math.min(60_000, Number(c.pollMs) || 5000))
  const okValue = String(c.successValue || 'succeeded')
  const failValues = String(c.failValue || 'failed,cancelled').split(',').map((s) => s.trim()).filter(Boolean)

  for (;;) {
    await delay(pollMs, undefined, { signal })
    const qUrl = fillUrl(c.queryUrl, { taskId, reqid: '' })
    const json = await requestJson(qUrl, { signal, label: '查询任务', headers: parts.headers, timeoutMs: 30_000, retry: true })
    const status = String(dotted(json, c.statusPath || 'status') || '')
    if (status === okValue) {
      const outUrl = dotted(json, c.urlPath || 'content.url')
      if (!outUrl) throw new Error('任务成功但没有取到视频地址（检查「结果地址路径」）')
      return saveVideo(await download(outUrl, cfg, signal), 'custom-' + String(taskId))
    }
    if (failValues.includes(status)) throw new Error(`生成失败（${status}）：${JSON.stringify(json).slice(0, 200)}`)
    if (Date.now() - started > timeoutMs) throw new Error(`等太久还没好（任务 ${taskId}）`)
    log?.info?.(`生成中（${status || '未知状态'}），已等 ${Math.round((Date.now() - started) / 1000)} 秒`)
  }
}
