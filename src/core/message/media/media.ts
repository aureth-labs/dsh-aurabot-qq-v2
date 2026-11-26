// 面向模块的媒体读取：返回字节，不暴露全局数据目录或素材文件路径。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../../store/index.ts'
import { findFfmpeg } from './img.ts'
import { mimeOf } from './inspect.ts'
import { parseWav, toMono16k } from './wav.ts'
import { stickerPath } from '../../../features/stickers/index.ts'

export function createMediaAccess({ root, use, config }) {
  function picture(path) {
    if (!existsSync(path)) return null
    const bytes = readFileSync(path), type = mimeOf(bytes)
    return type.startsWith('image/') ? { bytes, type } : null
  }
  return {
    mimeOf, parseWav, toMono16k,
    ffmpegPath: () => findFfmpeg(config().local?.ffmpegPath || ''),
    avatar: () => picture(existsSync(dataDir('avatar.img')) ? dataDir('avatar.img') : join(root, 'assets', 'dafeiyu.jpg')),
    sticker(md5) {
      const item = use('stickers')?.library?.().items.find((i) => i.md5 === md5)
      return item ? picture(stickerPath(item)) : null
    },
  }
}
