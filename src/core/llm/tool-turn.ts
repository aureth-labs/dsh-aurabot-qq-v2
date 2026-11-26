import { randomUUID } from 'node:crypto'
import type { LlmParams } from './index.ts'

export interface TurnTool {
  name: string
  description: string
  parameters: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  execute(args: Record<string, unknown>): unknown
}
export interface ToolTurn {
  available(): TurnTool[]
  active(): boolean
  beforeTool?(): boolean
}
interface Block {
  type: string
  [key: string]: unknown
}
interface Call extends Block {
  type: 'tool-call'
  id: string
  name: string
  arguments: string
}
interface Chunk {
  type: string
  block?: Block
  index?: number
  text?: string
  usage?: unknown
  reason?: { kind: string; failure?: { message?: string } }
  replayState?: unknown
}
interface Stream {
  stream(request: LlmParams & { tools: Omit<TurnTool, 'execute'>[] }): AsyncIterable<Chunk>
}
const isCall = (block: Block): block is Call =>
  block.type === 'tool-call' &&
  typeof block.id === 'string' &&
  typeof block.name === 'string' &&
  typeof block.arguments === 'string'

async function execute(call: Call, tool?: TurnTool) {
  try {
    if (!tool) throw Error('这个工具在当前会话不可用')
    const args: unknown = JSON.parse(call.arguments || '{}')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数应为对象')
    for (const key of tool.parameters.required || [])
      if (!Object.hasOwn(args, key)) throw Error('缺少参数 ' + key)
    const result = await tool.execute(args as Record<string, unknown>)
    const value = typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true })
    return {
      text: value.slice(0, 24000),
      error: !!(result && typeof result === 'object' && 'ok' in result && result.ok === false),
    }
  } catch (e) {
    return { text: e instanceof Error ? e.message : '工具执行失败', error: true }
  }
}

export async function runToolTurn(
  llm: Stream,
  base: LlmParams,
  turn: ToolTurn,
  onUsage: (usage: unknown) => void,
) {
  const messages = [...base.messages]
  const completed = new Map<string, { key: string; result: Awaited<ReturnType<typeof execute>> }>()
  for (let round = 0; round <= 4; round++) {
    if (!turn.active()) throw Error('会话已结束')
    const offered = round < 4 ? turn.available() : []
    const tools = offered.map(({ name, description, parameters }) => ({ name, description, parameters }))
    const blocks = new Map<number, Block>()
    let text = '',
      replayState: unknown,
      usage: unknown,
      finished = ''
    try {
      for await (const chunk of llm.stream({ ...base, messages, tools })) {
        if (!turn.active()) throw Error('会话已结束')
        if (chunk.type === 'text-delta') text += chunk.text || ''
        if (chunk.type === 'block-end' && chunk.block) blocks.set(chunk.index ?? blocks.size, chunk.block)
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') {
          finished = chunk.reason?.kind || ''
          if (finished === 'error' || finished === 'aborted')
            throw Error(chunk.reason?.failure?.message || '模型回合中止')
          replayState = chunk.replayState
        }
      }
    } finally {
      if (usage) onUsage(usage)
    }
    const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, v]) => v)
    const calls = content.filter(isCall)
    if (!calls.length)
      return (
        text ||
        content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
      ).trim()
    if (finished !== 'tool-calls' && finished !== 'stop') throw Error('模型工具请求不完整')
    if (round === 4 || calls.length > 8) throw Error('超过单轮工具调用上限')
    messages.push({
      role: 'assistant',
      id: randomUUID(),
      source: { kind: 'model', provider: base.provider, model: base.model, replayState },
      content,
    })
    for (const call of calls) {
      if (!turn.active()) throw Error('会话已结束')
      const key = JSON.stringify([call.name, call.arguments]),
        previous = completed.get(call.id)
      if (previous && previous.key !== key) throw Error('模型重复使用了不同请求的工具调用编号')
      const tool = tools.some((t) => t.name === call.name)
        ? turn.available().find((t) => t.name === call.name)
        : undefined
      if (tool && !previous && turn.beforeTool && !turn.beforeTool()) throw Error('消息已由另一回合处理')
      const result = previous?.result ?? (await execute(call, tool))
      completed.set(call.id, { key, result })
      messages.push({
        role: 'tool',
        id: randomUUID(),
        toolCallId: call.id,
        isError: result.error,
        source: { kind: 'tool', callId: call.id },
        content: [{ type: 'text', text: result.text }],
      })
    }
  }
  return ''
}
