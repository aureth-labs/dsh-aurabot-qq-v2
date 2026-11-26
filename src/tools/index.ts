// 工具的写法。具体的工具都在各个模块里（packages/*），按会话注册（agent.ctx.tools.register），只出现在 Aurabot 的会话里。
// 工具定义一旦确定尽量别改：改一次，DeepSeek 的前缀缓存就失效一次。

/** JSON Schema 的一个属性（类型 + 说明，可带 items / enum 等）。 */
export interface JsonSchemaProp {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  items?: JsonSchemaProp
  enum?: string[]
  [key: string]: unknown
}

/** 模型传进来的参数：结构由 properties 声明的 JSON Schema 决定，只有运行时才知道真值。 */
export type ToolArgs = Record<string, unknown>

/** 工具执行时宿主给的环境（工具会话、日志之类），插件不定义它的形状，透传即可。 */
export type ToolExec = unknown

/** 结果里的内容块（文本 / 图片），和 DSH 的 output.render 同形。 */
export interface ToolContentBlock { type: string; text?: string; [key: string]: unknown }

/** 工具执行结果（会被 JSON 序列化后交给模型）。 */
export type ToolResult = unknown

/** 内容的块的最小形状：render 的默认实现只读这两个字段。 */
interface RenderedValue { ok?: boolean; message?: string }

/** defineTool 的入参。 */
export interface DefineToolOptions {
  name: string
  description: string
  properties?: Record<string, JsonSchemaProp>
  required?: string[]
  execute: (args: ToolArgs, exec?: ToolExec) => ToolResult | Promise<ToolResult>
  render?: (args: ToolArgs, value: ToolResult) => ToolContentBlock[]
  /** 慢工具：卡住超过 1.5 秒先往 QQ 发这条提示。 */
  slow?: string
}

/** defineTool 的产物。 */
export interface ToolDefinition {
  name: string
  description: string
  slow?: string
  parameters: { type: 'object'; properties: Record<string, JsonSchemaProp>; required: string[]; additionalProperties: false }
  output: { schema: Record<string, unknown>; render: (args: ToolArgs, value: ToolResult) => ToolContentBlock[] }
  execute: (args?: ToolArgs, exec?: ToolExec) => Promise<ToolResult>
}

/**
 * 和 @deepseek-ai/dsh-tools 的 defineTool 产物同形：parameters / output.schema 是 JSON Schema。
 * render 可选：默认只回一行文字；工具要把图片之类的内容块放进结果时自己传（见 imagegen 的 qq_draw_image）。
 */
export function defineTool ({ name, description, properties = {}, required = [], execute, render, slow }: DefineToolOptions): ToolDefinition {
  const parameters = { type: 'object' as const, properties, required, additionalProperties: false as const }
  return {
    name,
    description,
    // 慢工具（生图、翻唱……）：卡住超过 1.5 秒就先往 QQ 发一条「正在做」的提示（issue #74），
    // 不让主人干等一整轮；具体提示语就写在这里。快工具不用标。
    ...(slow ? { slow } : {}),
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: render || ((_args, value) => {
        const v = (value ?? {}) as RenderedValue
        return [{ type: 'text', text: v.ok === false ? '✗ ' + (v.message || '没成功') : v.message || '✓' }]
      }),
    },
    async execute (args, exec) {
      try {
        const r = await execute(args || {}, exec)
        return JSON.parse(JSON.stringify(r ?? { ok: true })) as ToolResult
      } catch (error) {
        return { ok: false, message: String(error instanceof Error ? error.message : error) }
      }
    },
  }
}

export const str = (description: string): JsonSchemaProp => ({ type: 'string', description })
export const int = (description: string): JsonSchemaProp => ({ type: 'integer', description })
export const bool = (description: string): JsonSchemaProp => ({ type: 'boolean', description })
