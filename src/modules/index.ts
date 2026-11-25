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
// P4（speakup → purpose 迁移，docs/SPEAKUP-INTO-PURPOSE-PLAN.md §4）：主动搭话模块已退场，
// 能力并入 purpose（P1 默认开+播种保证老用户无感切换；P2b 小闹钟、P3 策略源均已收拢）。
import purpose from './purpose/index.ts'
import autotelic from './autotelic/index.ts'
import bili from './bili/index.ts'
import song from './song/index.ts'
import profile from './profile/index.ts'
import contacts from './contacts/index.ts'
import video from './video/index.ts'
import imageRecovery from './image-recovery/index.ts'

export const BUILTINS = [stickers, voice, mood, memory, qqTools, qqApi, imagegen, diary, qzoneSocial, purpose, autotelic, bili, song, profile, contacts, video, imageRecovery]
