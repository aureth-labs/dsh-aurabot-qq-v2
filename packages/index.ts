// 内置模块清单（按启动顺序）。每个模块的说明见各自文件开头；写法和接口见 API.md。
//
// 两种入口都收：老写法 `export default { id, name, apply }`，以及 v2 的具名导出
// （`export const name` / `Config` / `export function apply`）。具名导出的 id 取文件夹名。

import { namedModuleDef } from '../src/core/module/loader.ts'
import * as stickers from './stickers/index.ts'
import * as voice from './voice/index.ts'
import * as mood from './mood/index.ts'
import * as memory from './memory/index.ts'
import * as qqTools from './qq-tools/index.ts'
import * as qqApi from './qq-api/index.ts'
import * as imagegen from './imagegen/index.ts'
import * as diary from './diary/index.ts'
import * as qzoneSocial from './qzone-social/index.ts'
import * as profile from './profile/index.ts'
import * as purpose from './purpose/index.ts'
import * as autotelic from './autotelic/index.ts'
import * as bili from './bili/index.ts'
import * as song from './song/index.ts'
import * as contacts from './contacts/index.ts'
import * as video from './video/index.ts'
import * as imageRecovery from './image-recovery/index.ts'
import * as sandbox from './sandbox/index.ts'
import * as logger from './logger/index.ts'
import * as chatBridge from './chat-bridge/index.ts'
import * as commands from './commands/index.ts'

type Entry = Record<string, any>

const asBuiltin = (id: string, mod: Entry): Entry => mod.default ?? { ...namedModuleDef(mod), id }

export const BUILTINS = [
  asBuiltin('logger', logger),
  asBuiltin('chat-bridge', chatBridge),
  asBuiltin('stickers', stickers),
  asBuiltin('voice', voice),
  asBuiltin('mood', mood),
  asBuiltin('memory', memory),
  asBuiltin('qq-tools', qqTools),
  asBuiltin('qq-api', qqApi),
  asBuiltin('imagegen', imagegen),
  asBuiltin('diary', diary),
  asBuiltin('qzone-social', qzoneSocial),
  asBuiltin('purpose', purpose),
  asBuiltin('autotelic', autotelic),
  asBuiltin('bili', bili),
  asBuiltin('song', song),
  asBuiltin('profile', profile),
  asBuiltin('contacts', contacts),
  asBuiltin('video', video),
  asBuiltin('image-recovery', imageRecovery),
  asBuiltin('commands', commands),
  asBuiltin('sandbox', sandbox),
]
