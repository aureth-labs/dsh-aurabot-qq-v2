import { Schema } from '../../../src/core/config/shape/schema.ts'

export const config = Schema.object({
  enabled: Schema.boolean().default(true).title('启用目的引擎')
    .description('材料和时机合适时主动联系主人。'),
  minMaterials: Schema.natural().max(20).default(2).title('最少素材数')
    .description('低于这个数且没有惦记的事/人格卡时，这轮不硬找话'),
  initialDelayMinutes: Schema.natural().min(1).max(720).default(15).title('启动延迟（分钟）')
    .description('插件启动后第一次主动搭话前先等多久'),
  maxCandidates: Schema.natural().min(3).max(10).default(6).title('候选方向数'),
  promptMaxChars: Schema.natural().default(16000).hidden(),
})
