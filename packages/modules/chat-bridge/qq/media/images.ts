// 收图：动图如实标注、超大图先缩小再交模型、按会话记住刚发过的图（引用回复能指名）。

import { segmentBytes } from '../../../../../src/core/net/index.ts'
import type { OneBotGateway } from '../../../../../src/core/net/index.ts'
import { findFfmpeg, findSharp, shrinkImage, shrinkWithSharp } from '../../../../../src/core/message/media/img.ts'
import { gifFrames } from '../../../../../src/core/message/media/inspect.ts'
import { mimeOf } from '../../../../../src/core/message/media/inspect.ts'
import { MAX_IMAGE_BYTES, MAX_MESSAGE_IMAGES, MODEL_IMAGE_BYTES } from '../context/context.ts'

export interface CreateImageReaderOptions {
  onebot: OneBotGateway
  getConfig: () => Record<string, any>
  log: { debug(message: string, error?: unknown): void }
  recentMediaOf: (chatId: string, userId?: string) => Array<Record<string, any>>
}

export function createImageReader({ onebot, getConfig, log, recentMediaOf }: CreateImageReaderOptions) {  // 动图交给模型时通常只看到一帧，这里如实告诉她，免得她把动图说成静态图。
  const animatedNote = (imgs) => {
    const n = imgs.filter((img) => img.frames > 1).length
    return n ? `（其中 ${n} 张是动图，你看到的可能只是其中一帧，别说它是静态的，也别编没看到的动作）` : ''
  }

  /** 超大的图交给模型可能让整轮请求失败：先缩小，缩不了就跳过这张，别的照常。 */
  async function fitForModel(buf) {
    if (buf.length <= MODEL_IMAGE_BYTES) return buf
    const ffmpeg = findFfmpeg(getConfig().local?.ffmpegPath || '')
    const small = (ffmpeg ? await shrinkImage(buf, 2048, ffmpeg) : null) || await shrinkWithSharp(await findSharp(), buf, 2048)
    if (!small || small.length > MODEL_IMAGE_BYTES) throw new Error(`图片 ${Math.round(buf.length / 1048576)}MB 缩不下来`)
    return small
  }

  async function imagesOf(msg) {
    const out = []
    for (const seg of [...msg.stickers, ...msg.images].slice(0, MAX_MESSAGE_IMAGES)) {
      try {
        const raw = await segmentBytes(seg, onebot, { maxBytes: MAX_IMAGE_BYTES })
        const frames = gifFrames(raw)
        const buf = await fitForModel(raw)
        const mime = mimeOf(buf)
        if (!mime.startsWith('image/')) continue
        const source = msg.chatId && recentMediaOf(msg.chatId).find((x) => x.seg === seg && /^-?[1-9]\d*$/.test(x.messageId || ''))
        out.push({ data: buf.toString('base64'), mediaType: mime, frames, ...(source ? { name: `qqref-${source.messageId}-${source.imageIndex}` } : {}) })
      } catch (error) {
        log.debug('图片下载失败：', error.message)
      }
    }
    return out
  }

  return { imagesOf, fitForModel, animatedNote }
}
