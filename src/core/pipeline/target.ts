// 发送目标：所有出站消息最终都指向一个 Target。
// 结构声明在 src/types/core/target.ts；这里是构造与比对的小工具。

import type { Target } from '../../types/core/target.ts'

export type { Target, TargetType } from '../../types/core/target.ts'

export function targetKey(target: Target): string {
  return `${target.platform}:${target.botId}:${target.type}:${target.id}`
}

export function groupTarget(platform: string, botId: string, groupId: string | number): Target {
  return { platform, botId, type: 'group', id: String(groupId) }
}

export function privateTarget(platform: string, botId: string, userId: string | number): Target {
  return { platform, botId, type: 'private', id: String(userId) }
}
