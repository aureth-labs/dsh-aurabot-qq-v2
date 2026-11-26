// 跨平台对话：非 OneBot 平台的消息走到管线末端后，由这里问一次模型并回发。
import { Schema } from '../../src/core/config/shape/schema.ts'

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用跨平台对话'),
  mentionOnly: Schema.boolean().default(true).description('只回被 @ 的消息（沙盒不受限）'),
  history: Schema.number().default(12).description('每个会话保留多少条上下文'),
  systemPrompt: Schema.string().default('').description('附加系统提示（留空用默认）'),
})
