// 跨平台对话：非 OneBot 平台的消息走到管线末端后，由这里问一次模型并回发。
import { Schema } from '../../../src/core/config/shape/schema.ts'

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用跨平台对话'),
  mentionOnly: Schema.boolean().default(true).description('群聊只在被提及、被引用或命中唤醒词时回应（沙盒不受限）'),
  timeContext: Schema.boolean().default(true).description('每轮对话提供当前本机时间'),
  history: Schema.natural().max(100).default(12).description('每个会话保留多少条上下文'),
  systemPrompt: Schema.string().default('').description('附加系统提示（留空用默认）'),
})
