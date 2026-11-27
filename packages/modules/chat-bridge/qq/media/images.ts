import { elementBytes, type MediaResolver } from '../../../../../src/core/net/index.ts'
import { findFfmpeg, findSharp, shrinkImage, shrinkWithSharp } from '../../../../../src/core/message/media/img.ts'
import { gifFrames } from '../../../../../src/core/message/media/inspect.ts'
import { mimeOf } from '../../../../../src/core/message/media/inspect.ts'
import { mediaLimits } from '../../../../../src/core/message/media/limits.ts'
import { MODEL_IMAGE_BYTES } from '../context/context.ts'

const sameMedia = (a, b) => a === b || Boolean(a && b && a.type === b.type && JSON.stringify(a.attrs) === JSON.stringify(b.attrs))

export interface CreateImageReaderOptions {
  bot: () => MediaResolver | undefined
  getConfig: () => Record<string, any>
  log: { debug(message: string, error?: unknown): void }
  currentMedia: () => object | undefined
  recentMediaOf: (chatId: string, userId?: string) => Array<Record<string, any>>
}

export function createImageReader({ bot, getConfig, log, recentMediaOf, currentMedia }: CreateImageReaderOptions) {
  const animatedNote = (imgs) => {
    const n = imgs.filter((img) => img.frames > 1).length
    return n ? `（其中 ${n} 张是动图，你看到的可能只是其中一帧，别说它是静态的，也别编没看到的动作）` : ''
  }

  async function fitForModel(buf) {
    if (buf.length <= MODEL_IMAGE_BYTES) return buf
    const ffmpeg = findFfmpeg(getConfig().local?.ffmpegPath || '')
    const small = (ffmpeg ? await shrinkImage(buf, 2048, ffmpeg) : null) || await shrinkWithSharp(await findSharp(), buf, 2048)
    if (!small || small.length > MODEL_IMAGE_BYTES) throw new Error(`图片 ${Math.round(buf.length / 1048576)}MB 缩不下来`)
    return small
  }

  async function imagesOf(msg) {
    const account = currentMedia()
    const out = []
    const limits = mediaLimits(getConfig().media)
    if (!limits.receiveImages) return out
    for (const el of [...msg.stickers, ...msg.images].slice(0, limits.maxImages)) {
      if (!account || currentMedia() !== account) return []
      try {
        const raw = await elementBytes(el, bot(), { maxBytes: limits.maxImageMB * 1048576 })
        const frames = gifFrames(raw)
        const buf = await fitForModel(raw)
        const mime = mimeOf(buf)
        if (!mime.startsWith('image/')) continue
        const source = msg.chatId && recentMediaOf(msg.chatId).find((x) => sameMedia(x.element, el) && /^-?[1-9]\d*$/.test(x.messageId || ''))
        out.push({ data: buf.toString('base64'), mediaType: mime, frames, ...(source ? { name: `qqref-${source.messageId}-${source.imageIndex}` } : {}) })
      } catch (error) {
        log.debug('图片下载失败：', error.message)
      }
    }
    return currentMedia() === account ? out : []
  }

  return { imagesOf, fitForModel, animatedNote }
}
