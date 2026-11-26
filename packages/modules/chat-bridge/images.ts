import type { Element } from '../../../src/types/core/element.ts'
import { h } from '../../../src/core/message/element/element.ts'
import { fetchImage } from '../../../src/core/net/index.ts'
import { mimeOf } from '../../../src/core/message/media/inspect.ts'
import { mediaLimits } from '../../../src/core/message/media/limits.ts'

export async function modelImages(elements: Element[], settings: Parameters<typeof mediaLimits>[0], report: (reason: string) => void) {
  const limits = mediaLimits(settings)
  const images: Array<{ data: string; mediaType: string }> = []
  if (!limits.receiveImages) return images
  const maxBytes = limits.maxImageMB * 1048576
  for (const element of h.select(elements, 'image').slice(0, limits.maxImages)) {
    const url = String(element.attrs.url ?? element.attrs.src ?? '')
    try {
      const source = url.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, 'base64://')
      const bytes = await fetchImage(source, { maxBytes, allowLocal: false, timeoutMs: 5000 })
      const mediaType = mimeOf(bytes)
      if (!mediaType.startsWith('image/')) throw Error('图片格式无法识别')
      images.push({ data: bytes.toString('base64'), mediaType })
    } catch (error) {
      report(error instanceof Error && error.message.startsWith('图片太大') ? error.message : '未能读取图片')
    }
  }
  return images
}
