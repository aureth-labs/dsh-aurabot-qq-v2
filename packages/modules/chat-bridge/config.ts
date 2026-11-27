import { Schema } from '../../../src/core/config/shape/schema.ts'

export const Config = Schema.object({
  timeContext: Schema.boolean().default(true).description('每轮对话提供当前本机时间'),
})
