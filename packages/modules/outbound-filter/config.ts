import { Schema } from '../../sdk/index.ts'

export const name = '出站关键词过滤'
export const description = '阻止发送含指定关键词的消息'
export const config = Schema.object({
  keywords: Schema.array(Schema.string()).default([]).description('需要拦截的关键词，每项填写一个'),
})
