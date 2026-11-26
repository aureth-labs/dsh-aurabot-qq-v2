import { Schema } from '../../../src/core/config/shape/schema.ts'

export const Config = Schema.object({
  host: Schema.string().default('127.0.0.1').description('监听地址（默认只监听本机）'),
  port: Schema.natural().max(65535).default(5140).description('端口'),
  token: Schema.string().role('secret').default('').description('访问令牌（留空则不校验）'),
  selfId: Schema.string().default('sandbox-bot').hidden(),
  selfName: Schema.string().default('沙盒机器人').description('机器人昵称'),
  platform: Schema.string().default('sandbox').description('平台名（进 Target.platform）'),
  defaultUserId: Schema.string().default('').hidden(),
  defaultUserName: Schema.string().default('').description('网页里默认的昵称（留空用沙盒用户）'),
  autoConnect: Schema.boolean().default(true).description('自动用 Satori 适配器连上自己'),
})
