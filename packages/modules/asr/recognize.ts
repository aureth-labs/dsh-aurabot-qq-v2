import { fileURLToPath } from 'node:url'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { archiveAudio, pcmAudio } from './audio.ts'
import { asrSettings, transcribeAudio } from './cloud.ts'

export interface VoiceInput {
  read(): Promise<Buffer>
  platformText?(): Promise<string>
}

export interface Recognition {
  text: string
  url?: string
}

export function createRecognizer(ctx: PluginContext, media: string, signal: AbortSignal) {
  const speech = () => ctx.harness.get('speechToText')
  const active = () => !signal.aborted && ctx.config.enabled !== false && ctx.root.config.voice.asr !== false
  async function recognize(input: VoiceInput, localOnly = false, current = active): Promise<Recognition> {
    if (!current()) throw Error('语音识别已关闭')
    const voice = ctx.root.config.voice
    let url: string | undefined, bytes: Buffer | undefined
    try {
      bytes = await input.read()
      if (!current()) return { text: '' }
      signal.throwIfAborted()
      url = await archiveAudio(bytes, media)
    } catch (error) { ctx.logger.debug('未取得语音文件', error.message) }
    let converted: Promise<Buffer> | undefined
    const wav = () => converted ??= bytes && url ? pcmAudio(bytes, ctx.root.config.local.ffmpegPath, signal) : Promise.reject(Error('没有音频'))
    const local = ctx.host.local
    const cloud = asrSettings(voice) && (() => wav().then(audio => transcribeAudio(audio, voice, ctx.logger, { signal })))
    const platform = input.platformText
    const providers = [
      local?.active('asr') && (async () => {
        const file = fileURLToPath(await archiveAudio(await wav(), media))
        const r = await local.call('asr', { file })
        return typeof r === 'string' ? r : r?.text
      }),
      ...(voice.asrApi?.prefer === 'cloud' ? [cloud, platform] : [platform, cloud]),
      async () => {
        const stt = speech()
        if (!stt?.resolve || !stt.transcribe) return ''
        const snap = stt.snapshot?.()
        const provider = snap?.providers?.find(p => p.id === snap.selection?.providerId)
        if (provider?.preparation && !['ready', 'standby'].includes(provider.preparation.phase)) {
          Promise.resolve(stt.prepare?.(provider.id)).catch(error => ctx.logger.debug('准备语音模型失败', error.message))
          return ''
        }
        const audio = new Uint8Array(await wav())
        const value = await stt.transcribe(stt.resolve({ audio }), AbortSignal.any([signal, AbortSignal.timeout(60000)]))
        return typeof value === 'string' ? value : value?.text || value?.transcript
      },
    ]
    for (const run of localOnly ? providers.slice(-1) : providers) {
      if (!current()) break
      if (!run) continue
      try {
        const text = String(await run() || '').trim()
        if (text && current()) return { url, text }
      } catch (error) { ctx.logger.debug('本次语音识别未成功', error.message) }
    }
    return { url, text: '' }
  }
  return { recognize, active }
}
