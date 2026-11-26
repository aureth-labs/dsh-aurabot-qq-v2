// 内置模块：语音。把她的话念出来发语音条（edge-tts / Windows 语音 / CosyVoice / GPT-SoVITS / 豆包 / MiniMax / Breeze / 本地接口），
// 面板里的试听、语音识别自检也在这里。
// 导出 speak(text) → { file, engine }：聊天中枢发语音时找它。替换这个模块就能换成任何你想要的念法。

import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { textToSpeech, edgeInstalled, installEdge, voiceConverters, volcanoResourceFor, volcanoSynth, systemVoiceEngine } from './tts/index.ts'
import { fishBalances, fishPrimary } from './tts/fish.ts'
import { runCloud } from './tts/index.ts'
import { VOLCANO_VOICES } from './tts/volcano-voices.ts'
import { breezeBalance, breezeClaim, breezeSession, autoClaimOnce, breezeVoices } from './asr/breeze.ts'
import { createSongVoice } from './audio/rvc.ts'
import { toMono16k } from '../../src/core/message/media/wav.ts'
import { fileOf } from '../../src/local/index.ts'

/** 识别链路只吃 PCM16 WAV：自检拿到 mp3 时先用 ffmpeg 转一道（#255）。 */
export function asPcmWav (file, buf, ffmpegPath = '', { platform = process.platform, findFfmpegFn = findFfmpeg, runFn = spawnSync } : AsPcmWavOptions = {}) {
  if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.readUInt16LE(20) === 1 && buf.readUInt16LE(34) === 16) return buf
  const ff = findFfmpegFn(ffmpegPath)
  if (!ff) {
    const hint = platform === 'linux'
      ? '这台机器没有系统语音兜底，装好 ffmpeg 再试，或在「语音」页改用本地 TTS 服务'
      : '装好 ffmpeg 再试，或在「语音」页改用系统语音 / 本地 TTS 服务'
    throw new Error('自检拿到的音频不是 PCM16 WAV，这台机器也没找到 ffmpeg，转不了：' + hint)
  }
  const out = file.replace(/\.[a-z0-9]+$/i, '') + '.16k.wav'
  const r = runFn(ff, ['-y', '-i', file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], { timeout: 60000, windowsHide: true })
  let converted = null
  try {
    if (!r.error && r.status === 0 && existsSync(out)) converted = readFileSync(out)
  } finally {
    try { if (existsSync(out)) unlinkSync(out) } catch {}
  }
  if (!converted) throw new Error('音频转 WAV 失败：' + String(r.error?.message || r.stderr || '').slice(-200))
  return converted
}

import { asrConfigured, transcribeAudio } from './asr/index.ts'
import { mergeFromPanel, normalize } from '../../src/core/config/index.ts'
import { findFfmpeg } from '../../src/core/message/media/img.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type AsPcmWavOptions = Partial<Record<'platform' | 'findFfmpegFn' | 'runFn', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type SpeakOptions = Partial<Record<'useLocal', any>>

export const name = '语音'

export const version = '1.0.0'

export const description = '发语音条：把她的话念出来（关掉后想发语音时改发文字）'

export const tab = 'voice'

export function apply(ctx, config) {
  const { hub, onebot, local, http } = ctx.host

  async function speak(text, voice = ctx.root.config.voice, { useLocal = true } : SpeakOptions = {}) {
    if (useLocal && local.active('tts')) {
      try {
        const file = fileOf(await local.call('tts', { text }))
        if (file && existsSync(file)) return { file, engine: 'local' }
      } catch (error) {}
    }
    if (voice.engine === 'fish-free' && !voice.fishApiKey) {
      const fishApiKey = await fishPrimary(voice, () => ctx.harness?.get?.('credentials'))
      return textToSpeech(text, { ...voice, fishApiKey }, ctx.logger)
    }
    return textToSpeech(text, voice, ctx.logger)
  }

  /** 试听用：把面板上「还没保存」的语音草稿合并进当前配置；空着的 Key 沿用已保存的。 */
  function voiceFromBody(body) {
    const saved = ctx.root.config
    if (!body || !body.voice || typeof body.voice !== 'object') return saved.voice
    try { return normalize(mergeFromPanel(saved, { voice: body.voice })).voice } catch (error) { return saved.voice }
  }

  const songVoice = createSongVoice({ getConfig: ctx.root.read, getSong: () => ctx.get('song'), dataDir: ctx.dataDir, log: ctx.logger })
  voiceConverters.push(songVoice)
  ctx.effect(() => {
    const i = voiceConverters.indexOf(songVoice)
    if (i >= 0) voiceConverters.splice(i, 1)
  })

  ctx.server.get('/voice/song-voices', async () => {
    const song = ctx.get('song')
    if (!song || typeof song.status !== 'function') return { ok: true, available: false, voices: [], message: '翻唱模块没在跑' }
    try {
      const st = song.status()
      return { ok: true, available: Boolean(st.ready), ready: Boolean(st.ready), voices: st.voices || [], selected: ctx.root.config.voice.songVoice || '', message: st.message || '' }
    } catch (error) {
      return { ok: false, available: false, voices: [], message: String(error.message || error) }
    }
  })

  ctx.server.get('/voice/fish-balances', () => fishBalances(ctx.root.config.voice, () => ctx.harness?.get?.('credentials')))

  ctx.server.get('/voice/test', async (req) => {
    const b = await http.body(req)
    const voice = voiceFromBody(b)
    const { file, engine } = await speak(String(b.text || '你好呀，我是大肥鱼'), voice, { useLocal: false })
    const buf = readFileSync(file)
    return { ok: true, engine, mime: file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', data: buf.toString('base64') }
  })
  ctx.server.get('/voice/install', async () => installEdge(ctx.logger))
  ctx.server.get('/voice/asr-provider-test', async (req) => {
    const b = await http.body(req)
    const voice = voiceFromBody(b)
    if (!asrConfigured(voice)) return { ok: false, message: '没配置云端识别（面板「语音 → 听语音」里选一个）' }
    const text = String(b.text || '今天想吃白米饭')
    let file
    try {
      const r = await textToSpeech(text, { engine: process.platform === 'win32' ? 'windows' : 'edge' }, ctx.logger)
      file = r.file
    } catch (error) {
      return { ok: false, message: '生成测试语音失败：' + error.message }
    }
    try {
      const t = Date.now()
      const heard = await transcribeAudio(readFileSync(file), voice, ctx.logger)
      return { ok: Boolean(heard), said: text, heard, provider: voice.asrApi?.provider || '', ms: Date.now() - t }
    } catch (error) {
      return { ok: false, message: '识别失败：' + error.message }
    }
  })

  ctx.server.get('/voice/volcano-preview', async (req) => {
    const b = await http.body(req)
    const saved = ctx.root.config.voice.volcano || {}
    const c = {
      apiKey: String(b.apiKey || '').trim() || String(saved.apiKey || ''),
      voiceType: String(b.voiceType || saved.voiceType || '').trim(),
      resourceId: String(b.resourceId || saved.resourceId || '').trim(),
      speedRatio: Number(b.speedRatio) || Number(saved.speedRatio) || 1,
    }
    const pool = b.keyPool ? mergeFromPanel(ctx.root.config, { voice: { keyPools: { volcano: b.keyPool } } }).voice.keyPools.volcano : ctx.root.config.voice.keyPools?.volcano
    if (!c.apiKey && !pool?.accounts?.some(a => a.apiKey)) return { ok: false, message: '先在上面把 API Key 填上，再试听' }
    try {
      const file = await runCloud('volcano', c.apiKey, pool, key => volcanoSynth(String(b.text || '你好呀，我是大肥鱼。这个声音你听着怎么样？'), { ...c, apiKey: key }))
      const buf = readFileSync(file)
      return { ok: true, engine: 'volcano', mime: 'audio/mpeg', data: buf.toString('base64') }
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) }
    }
  })

  ctx.server.get('/voice/volcano-voices', async () => ({
    ok: true,
    voices: VOLCANO_VOICES.map((v) => ({ id: v.id, name: v.name, group: v.group, ver: v.ver, scene: v.scene || '', resourceId: volcanoResourceFor(v.id) })),
  }))

  const stt = () => ctx.harness.get('speechToText')
  ctx.server.get('/voice/asr-status', async () => {
    const s0 = stt()
    if (!s0 || typeof s0.snapshot !== 'function') return { ok: false, enabled: false, message: 'DSH 里没有开启「语音输入」插件' }
    const s = s0.snapshot()
    const p = s.providers.find((x) => x.id === s.selection.providerId) || s.providers[0]
    return { ok: true, enabled: true, provider: p?.id, phase: p?.preparation?.phase || 'ready', detail: p?.preparation }
  })
  ctx.server.get('/voice/asr-prepare', async () => {
    const s0 = stt()
    if (!s0 || typeof s0.snapshot !== 'function') return { ok: false, message: 'DSH 里没有开启「语音输入」插件' }
    s0.prepare(s0.snapshot().selection.providerId)
    return { ok: true, message: '开始下载识别模型（约 200MB，下好后常驻本机）' }
  })
  ctx.server.get('/voice/asr-last', async (req) => {
    const b = await http.body(req)
    const uid = Number(b.userId || ctx.root.config.ownerQQ)
    const h = await onebot.call('get_friend_msg_history', { user_id: uid, count: 30 })
    const recs = (h?.messages || []).filter((m) => String(m.user_id) === String(uid)).flatMap((m) => (m.message || []).filter((s) => s.type === 'record').map((s) => ({ seg: s, time: m.time })))
    const last = recs.at(-1)
    if (!last) return { ok: false, message: '最近的聊天里没有对方发的语音' }
    const t = Date.now()
    const text = await hub.localTranscribe(last.seg)
    return { ok: Boolean(text), heard: text, at: new Date(last.time * 1000).toLocaleString(), ms: Date.now() - t }
  })
  ctx.server.get('/voice/asr-test', async (req) => {
    const b = await http.body(req)
    const s0 = stt()
    if (!s0 || typeof s0.resolve !== 'function') return { ok: false, message: 'DSH 里没有开启语音识别（设置 → 插件 → 语音输入）' }
    const text = String(b.text || '今天想吃白米饭')
    const system = systemVoiceEngine()
    const { file } = await textToSpeech(text, system ? { engine: system } : {})
    const t = Date.now()
    const spec = s0.resolve({ audio: new Uint8Array(toMono16k(asPcmWav(file, readFileSync(file), ctx.root.config.bili?.ffmpegPath || ''))) })
    const r = await s0.transcribe(spec, AbortSignal.timeout(120000))
    const heard = typeof r === 'string' ? r : r?.text || r?.transcript || JSON.stringify(r)
    return { ok: Boolean(heard), said: text, heard, ms: Date.now() - t }
  })

ctx.server.get('/voice/breeze-status', async () => {
  const b = ctx.root.config.voice?.breeze || {}
  const local = b.mode === 'local'
  const bal = local ? { ok: true, hasKey: false, balance: null, note: '本地自建不用额度' } : await breezeBalance(b)
  const s = breezeSession()
  return {
    ok: true,
    mode: local ? 'local' : 'cloud',
    hasKey: Boolean(String(b.key || '').trim()),
    online: bal.ok,
    balance: bal.balance,
    note: bal.note,
    emailSet: Boolean(String(b.email || '').trim()),
    passwordSet: Boolean(b.password),
    autoClaim: Boolean(b.autoClaim),
    lastClaimAt: Number(s?.lastClaimAt) || 0,
    lastTier: s?.lastTier || '',
  }
})
ctx.server.get('/voice/breeze-voices', async () => {
  const b = ctx.root.config.voice?.breeze || {}
  if (b.mode === 'local') return { ok: false, message: '本地自建模式不用选云端音色' }
  return breezeVoices(b)
})
ctx.server.get('/voice/breeze-claim', async () => {
  const b = ctx.root.config.voice?.breeze || {}
  const r = await breezeClaim(b, { log: ctx.logger })
  const bal = await breezeBalance(b)
  return { ok: true, message: r.message, reward: r.reward, tier: r.tier, balance: bal.balance }
})
ctx.setInterval(3600_000, () => autoClaimOnce(ctx.root.config, { log: ctx.logger }), '领 Breeze 额度')

ctx.provide('voice', { speak, edgeInstalled })
ctx.provide('tts', { speak: async (text: string) => String((await speak(text))?.file ?? '') })
// 语音识别也是服务：内核不再 import 本插件，谁提供都能用。
ctx.provide('asr', {
  configured: (voice) => asrConfigured(voice),
  transcribe: (buffer, voice, log) => transcribeAudio(buffer, voice, log),
})
return { speak, edgeInstalled }
}
