import { readJson, writeJson } from '../../../src/core/store/index.ts'
import { assertTarget } from '../../../src/core/pipeline/target.ts'
import type { Target } from '../../../src/types/core/target.ts'
import type { ChatModelConfig, ChatModelChoice } from '../../../src/types/plugin/ctx.ts'

function key(target: Target, selfId: string) {
  assertTarget(target)
  if (!selfId?.trim()) throw new Error('选择会话模型需要已登录的机器人身份')
  return JSON.stringify([target.platform, target.botId, selfId, target.type, target.id])
}

export function modelPreferences(file: string, list: ChatModelConfig['list'], active = () => true): ChatModelConfig {
  let choices: Record<string, ChatModelChoice> = readJson(file, {})
  let available: Set<string> | undefined
  const modelKey = (choice: ChatModelChoice) => JSON.stringify([choice.provider, choice.model])
  return {
    async list() {
      const rows = await list()
      if (rows.length) available = new Set(rows.map(modelKey))
      return rows
    },
    get(target, selfId) {
      const choice = choices[key(target, selfId)]
      return choice && (!available || available.has(modelKey(choice))) ? { ...choice } : null
    },
    set(target, selfId, choice) {
      if (!active()) throw new Error('模型服务已卸载')
      const id = key(target, selfId)
      const next = { ...choices }
      if (choice) {
        if (!choice.provider.trim() || !choice.model.trim()) throw new Error('需要指定供应商和模型')
        next[id] = { provider: choice.provider, model: choice.model }
      } else delete next[id]
      writeJson(file, next)
      choices = next
    },
  }
}
