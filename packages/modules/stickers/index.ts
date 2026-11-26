import { primaryLibrary } from './primary.ts'
import { primaryTools } from './primary-tools.ts'
import { stickerPanel } from './panel.ts'
import { installStickerRooms } from './rooms.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'

export const name = '表情包'
export const version = '2.0.0'
export const description = '收集、标注和发送当前账号的表情'
export const tab = 'stickers'

export function apply(ctx: PluginContext) {
  const primary = primaryLibrary(ctx)
  const { select } = primary
  installStickerRooms(ctx)
  primaryTools(ctx, primary)
  stickerPanel(ctx, select)
  return {
    match: query => select().match(query),
    elementFor: item => select().elementFor(item),
    picture: md5 => select().picture(md5),
    markUsed: md5 => select().markUsed(md5),
    pickForReply: text => select().pickForReply(text),
    collect: (el, room, current) => select().collect(el, room, current),
    library: () => select().library(),
    addFromBuffer: (bytes, options) => select().addFromBuffer(bytes, options),
  }
}
