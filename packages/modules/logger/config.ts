import { Schema } from '../../../src/core/config/shape/schema.ts'

export const Config = Schema.object({
  retainDays: Schema.natural().min(1).max(365).default(14).description('日志文件保留天数'),
  pageSize: Schema.number().min(50).max(500).integer().default(300).description('日志页一次显示多少条'),
})
