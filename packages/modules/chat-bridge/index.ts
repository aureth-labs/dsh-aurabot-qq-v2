import type { Target } from '../../../src/types/core/target.ts'
import type { ConversationLine } from '../../../src/core/store/conversations.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'

export { Config } from './config.ts'

export const name = '对话引擎'
export const version = '2.0.0'
export const description = '所有已接入平台共用的 AI 对话引擎设置'

export interface RoomTimeline {
  enabled(): boolean
  read(target: Target, selfId: string, persona: string): { room: string; busy: boolean; revision: number; messages: ConversationLine[] }
  record(target: Target, selfId: string, persona: string, line: ConversationLine): void
}

export function apply(ctx: PluginContext) {
  void ctx
}
