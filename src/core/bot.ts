// Bot：一个已上线的机器人实例。
// 契约本身在 src/types/bot.ts；这里只留运行时行为（状态校验、目标构造）。

import type { BotLike } from '../types/bot.ts'
import type { Target } from '../types/target.ts'

// 老代码一直从 core/bot.ts 取这些类型，这里原样转发，别让调用方跟着改 import 路径。
export type { BotLike, BotEvents, BotStatus, Capability, SendOptions } from '../types/bot.ts'

export class BotStateError extends Error {
  constructor(bot: BotLike, action: string) {
    super(`bot ${bot.id}（${bot.platform}）当前状态 ${bot.status}，不能执行 ${action}`)
    this.name = 'BotStateError'
  }
}

export function assertOnline(bot: BotLike, action: string): void {
  if (bot.status !== 'online') throw new BotStateError(bot, action)
}

export function targetOfBot(bot: BotLike, type: Target['type'], id: string): Target {
  return { platform: bot.platform, botId: bot.id, type, id }
}
