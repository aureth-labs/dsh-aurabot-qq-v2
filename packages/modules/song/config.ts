import { Schema } from '../../sdk/index.ts'

export const config = Schema.object({
  enabled: Schema.boolean().default(false).description('开放点歌'),
  ownerOnly: Schema.boolean().default(true).description('仅主人和已授权用户可以点歌'),
  root: Schema.string().default('').description('制作环境目录'),
  voice: Schema.string().default('').description('默认音色'),
  pitch: Schema.number().min(-24).max(24).default(0).description('默认变调半音数'),
  autoPitch: Schema.boolean().default(true).description('根据原唱声线自动变调'),
  selfVoice: Schema.union(['female', 'male']).default('female').description('音色声线'),
  neteaseCookie: Schema.string().role('secret').default('').description('网易云 MUSIC_U'),
  separatorModel: Schema.string().default('model_bs_roformer_ep_317_sdr_12.9755.ckpt').description('人声分离模型'),
  maxVoiceSec: Schema.natural().min(1).default(120).description('最长时长（秒）'),
  clipStart: Schema.union(['auto', 'head']).default('auto').description('自动选择副歌或从头截取'),
  vocalVolume: Schema.number().min(0).max(10).default(1).description('人声音量'),
  instVolume: Schema.number().min(0).max(10).default(0.8).description('伴奏音量'),
  keepWork: Schema.boolean().default(false).description('保留制作中间文件'),
  pypiMirror: Schema.union(['auto', 'cn', 'off']).default('auto').description('依赖下载源'),
})
