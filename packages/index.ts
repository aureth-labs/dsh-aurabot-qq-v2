// 内置模块清单（按启动顺序）。每个模块的说明见各自文件开头；写法和接口见 API.md。

import stickers from './stickers/index.ts'
import voice from './voice/index.ts'
import mood from './mood/index.ts'
import memory from './memory/index.ts'
import qqTools from './qq-tools/index.ts'
import qqApi from './qq-api/index.ts'
import imagegen from './imagegen/index.ts'
import diary from './diary/index.ts'
import qzoneSocial from './qzone-social/index.ts'
import purpose from './purpose/index.ts'
import autotelic from './autotelic/index.ts'
import bili from './bili/index.ts'
import song from './song/index.ts'
import profile from './profile/index.ts'
import contacts from './contacts/index.ts'
import video from './video/index.ts'
import imageRecovery from './image-recovery/index.ts'
import sandbox from './sandbox/index.ts'
import commands from './commands/index.ts'

export const BUILTINS = [stickers, voice, mood, memory, qqTools, qqApi, imagegen, diary, qzoneSocial, purpose, autotelic, bili, song, profile, contacts, video, imageRecovery, commands, sandbox]
