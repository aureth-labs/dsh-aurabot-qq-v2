import { Schema } from '../../../src/core/config/shape/schema.ts'
import { h } from '../../../src/core/message/element/element.ts'
import { dataDir } from '../../../src/core/store/index.ts'
import type { Element } from '../../../src/types/core/element.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { readAudio } from './audio.ts'
import { asrConfigured, transcribeAudio } from './cloud.ts'
import { createRecognizer, type VoiceInput } from './recognize.ts'

export const name = '语音识别'
export const config = Schema.object({ enabled: Schema.boolean().default(true).description('转写收到的语音消息') })

interface Draft {
  platform: string
  botId: string
  type: string
  userId: string
  channelId: string
  messageId?: string
  elements: Element[]
}

export function apply(ctx: PluginContext) {
  const controller = new AbortController()
  ctx.effect(() => controller.abort())
  const media = dataDir('media')
  const service = createRecognizer(ctx, media, controller.signal)
  const resolve = (platform: string, botId: string, el: Element, messageId?: string) => {
    const source = ctx.get<{ open(el: Element, id?: string): VoiceInput }>('voice-source/' + JSON.stringify([platform, botId]))
    return source?.open(el, messageId) ?? { read: () => readAudio(String(el.attrs.url || el.attrs.src || ''), media) }
  }
  const asr = { ...service, resolve, configured: asrConfigured,
    cloud: (wav: Buffer, voice) => transcribeAudio(wav, voice, ctx.logger, { signal: controller.signal }) }
  ctx.provide('asr', asr)
  ctx.on('before-parse', async (draft: Draft) => {
    if (!service.active() || (!ctx.root.config.enabled && draft.platform !== 'sandbox') || ctx.root.config.debug) return
    const bot = ctx.bots.get(draft.botId, draft.platform)
    if (!bot || bot.selfId === draft.userId || ctx.host.canReadMedia?.(bot, draft) === false) return
    const self = bot.selfId
    const current = () => service.active() && ctx.bots.get(draft.botId, draft.platform) === bot &&
      bot.selfId === self && (ctx.root.config.enabled || draft.platform === 'sandbox') && !ctx.root.config.debug &&
      ctx.host.canReadMedia?.(bot, draft) !== false
    for (const el of draft.elements) {
      if (el.type !== 'voice' || !current()) continue
      const input = resolve(draft.platform, draft.botId, el, draft.messageId)
      const result = await service.recognize(input, false, current)
      if (!current()) return
      if (result.url) el.attrs.url = result.url
      el.children = [h('translateVoice', {}, [h.text(result.text || '[语音未能识别，内容可能有误]')])]
    }
  })
  return asr
}
