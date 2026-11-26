// 内置插件清单（按启动顺序）。id 取文件夹名，入口只有具名导出。

import { namedModuleDef, type ModuleDef } from '../src/core/module/loader.ts'
import * as logger from './logger/index.ts'
import * as persona from './modules/persona/index.ts'
import * as chatBridge from './chat-bridge/index.ts'
import * as stickers from './stickers/index.ts'
import * as voice from './voice/index.ts'
import * as mood from './mood/index.ts'
import * as memory from './memory/index.ts'
import * as qqTools from './qq-tools/index.ts'
import * as qqApi from './qq-api/index.ts'
import * as imagegen from './imagegen/index.ts'
import * as diary from './diary/index.ts'
import * as qzoneSocial from './qzone-social/index.ts'
import * as purpose from './purpose/index.ts'
import * as autotelic from './autotelic/index.ts'
import * as bili from './bili/index.ts'
import * as song from './song/index.ts'
import * as profile from './profile/index.ts'
import * as contacts from './contacts/index.ts'
import * as video from './video/index.ts'
import * as imageRecovery from './image-recovery/index.ts'
import * as commands from './commands/index.ts'
import * as sandbox from './sandbox/index.ts'

const entries: Array<[string, Record<string, any>]> = [
  ['logger', logger],
  ['persona', persona],
  ['chat-bridge', chatBridge],
  ['stickers', stickers],
  ['voice', voice],
  ['mood', mood],
  ['memory', memory],
  ['qq-tools', qqTools],
  ['qq-api', qqApi],
  ['imagegen', imagegen],
  ['diary', diary],
  ['qzone-social', qzoneSocial],
  ['purpose', purpose],
  ['autotelic', autotelic],
  ['bili', bili],
  ['song', song],
  ['profile', profile],
  ['contacts', contacts],
  ['video', video],
  ['image-recovery', imageRecovery],
  ['commands', commands],
  ['sandbox', sandbox],
]

export const BUILTINS: ModuleDef[] = entries.map(([id, mod]) => {
  const def = namedModuleDef(mod)
  if (!def) throw new Error(`内置插件 ${id} 没有 apply`)
  return { ...def, id }
})
