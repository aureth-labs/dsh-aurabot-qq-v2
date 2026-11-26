export const ASR_PRESETS = {
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    hint: 'FunAudioLLM/SenseVoiceSmall，中文短语音便宜；实测一次约 14 秒',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    hint: 'whisper-1；网络不通时可以填兼容网关的地址',
  },
}

const str = (v) => String(v ?? '').trim()

/** 面板 / 聊天用的有效配置；没选服务或地址模型不全时返回 null。 */
export function asrSettings(voice) {
  const c = voice?.asrApi
  if (!c || typeof c !== 'object') return null
  const provider = str(c.provider)
  if (!provider) return null
  const preset = ASR_PRESETS[provider] || null
  if (!preset && provider !== 'custom') return null
  // 服务地址只填到 /v1；用户把完整 /audio/transcriptions 贴进来时自动去掉，避免拼成双路径 404
  const baseUrl = str(c.baseUrl || preset?.baseUrl).replace(/\/+$/, '').replace(/\/audio\/(?:speech|transcriptions)\/?$/i, '')
  const model = str(c.model || preset?.model)
  if (!baseUrl || !model) return null
  try {
    const u = new URL(baseUrl)
    if (!['http:', 'https:'].includes(u.protocol)) return null
  } catch (error) {
    return null
  }
  return {
    provider,
    baseUrl,
    model,
    apiKey: str(c.apiKey),
    language: str(c.language),
    prefer: c.prefer === 'cloud' ? 'cloud' : 'qq',
  }
}

/** 现在有没有配置云端识别。 */
export function asrConfigured(voice) {
  return Boolean(asrSettings(voice))
}


export async function transcribeAudio(buffer: Buffer, voice, log, {
  fetchImpl = globalThis.fetch, timeoutMs = 60000, signal,
}: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {}) {
  const c = asrSettings(voice)
  if (!c) throw new Error('没配置云端识别')
  if (!buffer || !buffer.length) throw new Error('没有音频')
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/wav' }), 'voice.wav')
  form.append('model', c.model)
  if (c.language) form.append('language', c.language)
  const headers: Record<string, any> = {}
  if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`
  const timeout = AbortSignal.timeout(timeoutMs)
  const started = Date.now()
  const r = await fetchImpl(`${c.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers,
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
  })
  const raw = await r.text().catch(() => '')
  if (!r.ok) throw new Error(`HTTP ${r.status}${raw ? '：' + raw.slice(0, 160) : ''}`)
  let json = null
  try { json = JSON.parse(raw) } catch (error) {}
  if (!json) throw new Error('识别服务返回的不是 JSON：' + raw.slice(0, 160))
  const text = str(json.text || json.transcript)
  log?.debug?.(`云端识别（${c.provider}）用时 ${Date.now() - started}ms，得到 ${text.length} 字`)
  return text
}
