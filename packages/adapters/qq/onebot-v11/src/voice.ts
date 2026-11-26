import { fetchImage } from '../../../../../src/core/net/index.ts'
import type { Element } from '../../../../../src/types/core/element.ts'
import type { OneBotBot } from './bot.ts'

export function voiceSource(bot: OneBotBot) {
  return (element: Element, messageId?: string) => ({
    async read() {
      const file = String(element.attrs.file || element.attrs.url || '')
      const info = await bot.internal('get_record', { file, out_format: 'wav' }, { timeoutMs: 30000 })
      const url = info?.base64 ? 'base64://' + info.base64 : info?.file || info?.url
      return fetchImage(url, { maxBytes: 30 * 1048576, timeoutMs: 20000 })
    },
    platformText: messageId && (async () => {
      const result = await bot.internal('fetch_ptt_text', { message_id: messageId }, { timeoutMs: 20000 })
      return String(result?.text || '')
    }),
  })
}
