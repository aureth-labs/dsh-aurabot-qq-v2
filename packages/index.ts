// 内置插件清单（按启动顺序）。id 取文件夹名，入口只有具名导出。

import { fileURLToPath } from 'node:url'
import { readManifest } from '../src/core/module/manifest.ts'
import { namedModuleDef, type ModuleDef } from '../src/core/module/loader.ts'
import * as llm from './modules/llm/index.ts'
import * as logger from './modules/logger/index.ts'
import * as persona from './modules/persona/index.ts'
import * as chatBridge from './modules/chat-bridge/index.ts'
import * as stickers from './modules/stickers/index.ts'
import * as voice from './modules/voice/index.ts'
import * as mood from './modules/mood/index.ts'
import * as memory from './modules/memory/index.ts'
import * as qqTools from './modules/qq-tools/index.ts'
import * as qqApi from './modules/qq-api/index.ts'
import * as imagegen from './modules/imagegen/index.ts'
import * as purpose from './modules/purpose/index.ts'
import * as autotelic from './modules/autotelic/index.ts'
import * as song from './modules/song/index.ts'
import * as profile from './modules/profile/index.ts'
import * as contacts from './modules/contacts/index.ts'
import * as video from './modules/video/index.ts'
import * as imageRecovery from './modules/image-recovery/index.ts'
import * as commands from './modules/commands/index.ts'
import * as sandbox from './modules/sandbox/index.ts'

const entries: Array<[string, Record<string, any>]> = [
  ['logger', logger],
  ['llm', llm],
  ['persona', persona],
  ['chat-bridge', chatBridge],
  ['stickers', stickers],
  ['voice', voice],
  ['mood', mood],
  ['memory', memory],
  ['qq-tools', qqTools],
  ['qq-api', qqApi],
  ['imagegen', imagegen],
  ['purpose', purpose],
  ['autotelic', autotelic],
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
  const packageDir = fileURLToPath(new URL('./modules/' + id + '/', import.meta.url))
  const { manifest, error } = readManifest(packageDir)
  if (!manifest || error || manifest.id !== id) throw new Error('内置包清单无效 ' + id + ' ' + error)
  return { ...def, id, packageDir, inject: def.inject ?? manifest.inject, version: manifest.version, platforms: manifest.platforms, capabilities: manifest.capabilities }
})
