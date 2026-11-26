// 语音转文字：本地识别接口优先、云端兜底、QQ 自带识别收尾；QQ 语音是 silk，先转 wav 再重采样。

import { fetchImage } from '../../../core/net/index.ts'
import { toMono16k } from '../../../voice/audio/wav.ts'
import { asrConfigured, transcribeAudio } from '../../../voice/asr/index.ts'

export interface CreateTranscriberOptions {
  dsh: Record<string, any>
  onebot: Record<string, any>
  getConfig: () => Record<string, any>
  log: { debug(message: string, error?: unknown): void }
  localApi?: Record<string, any> | null
}

export function createTranscriber({ dsh, onebot, getConfig, log, localApi }: CreateTranscriberOptions) {  /** QQ 语音是 silk：让网关转成 wav，再统一成 16kHz 单声道 PCM16。 */
  async function recordWav(rec, suppliedWav) {
    if (suppliedWav) return toMono16k(suppliedWav)
    const info = await onebot.call('get_record', { file: rec.data?.file, out_format: 'wav' }, { timeoutMs: 30000 })
    const raw = info?.base64 ? Buffer.from(info.base64, 'base64') : await fetchImage(info?.file || info?.url, { maxBytes: 30 * 1024 * 1024 })
    return toMono16k(raw)
  }

  async function transcribe(msg, suppliedWav?) {
    for (const rec of msg.records) {
      // 本地接口接管：用用户自己的识别服务（最先试）
      if (localApi?.active('asr')) {
        try {
          const wav = await recordWav(rec, suppliedWav)
          const { writeFileSync, mkdirSync } = await import('node:fs')
          const { join } = await import('node:path')
          const dir = localApi.dir() + '/out'
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `asr-${Date.now()}.wav`)
          writeFileSync(file, wav)
          const r = await localApi.call('asr', { file })
          const text = String(typeof r === 'string' ? r : r?.text || '').trim()
          if (text) return `[语音] ${text}`
        } catch (error) {
          log.debug('本地接口语音识别失败：', error.message)
        }
      }
      const voiceCfg = getConfig().voice
      const viaCloud = async () => {
        if (!asrConfigured(voiceCfg)) return ''
        try { return await transcribeAudio(await recordWav(rec, suppliedWav), voiceCfg, log) } catch (error) {
          log.debug('云端语音识别失败：', error.message)
          return ''
        }
      }
      const viaQq = async () => {
        if (suppliedWav) return '' // 外部输入没有 QQ 消息编号，复用本地/云端/DSH 识别。
        try {
          const r = await onebot.call('fetch_ptt_text', { message_id: Number(msg.messageId) || msg.messageId }, { timeoutMs: 20000 })
          return String(r?.text || '').trim()
        } catch (error) {
          log.debug('QQ 语音转文字失败：', error.message)
          return ''
        }
      }
      // 默认 QQ 优先（快、免费），云端做兜底；实测硅基 SenseVoice 一次约 14 秒，
      // 所以只有用户显式把 prefer 设成 cloud 才提前。
      if (voiceCfg.asrApi?.prefer === 'cloud') {
        const text = await viaCloud()
        if (text) return `[语音] ${text}`
      }
      {
        const text = await viaQq()
        if (text) return `[语音] ${text}`
      }
      if (voiceCfg.asrApi?.prefer !== 'cloud') {
        const text = await viaCloud()
        if (text) return `[语音] ${text}`
      }
      try {
        const text = await localTranscribe(rec, suppliedWav)
        if (text) return `[语音] ${text}`
      } catch (error) {
        log.debug('本地语音识别失败：', error.message)
      }
      return '[发来一条语音，没听清]'
    }
    return ''
  }

  /**
   * DSH 自带识别（SenseVoice）：resolve({audio}) → transcribe(spec, signal)，音频必须是 16kHz 单声道 PCM16 WAV。
   * QQ 语音是 silk：先让网关 get_record 转成 wav，再重采样。
   */
  async function localTranscribe(rec, suppliedWav) {
    const stt = dsh.get('speechToText')
    if (!stt || typeof stt.resolve !== 'function' || typeof stt.transcribe !== 'function') throw new Error('DSH 没开启语音输入')
    // 模型还没下载好：顺手开始准备（下载一次，之后常驻），这一条先算没听清
    const snap = typeof stt.snapshot === 'function' ? stt.snapshot() : null
    const pid = snap?.selection?.providerId
    const prov = snap?.providers?.find((p) => p.id === pid)
    if (prov && prov.preparation && !['ready', 'standby'].includes(prov.preparation.phase)) {
      try { stt.prepare(pid) } catch (error) {}
      throw new Error(`识别模型还在准备（${prov.preparation.phase}）`)
    }
    const spec = stt.resolve({ audio: new Uint8Array(await recordWav(rec, suppliedWav)) })
    const r = await stt.transcribe(spec, AbortSignal.timeout(60000))
    const text = typeof r === 'string' ? r : r?.text || r?.transcript
    return text ? String(text).trim() : ''
  }

  return { transcribe, recordWav, localTranscribe }
}
