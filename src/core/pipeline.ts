// 入站消息管线：command → middleware → llm。
//
// 语义（定稿）：
// - 指令先匹配；没被消费才往下走
// - 中间件 `return` 不调 next() = 这条我处理完了，不再往下传
// - 中间件 `return next()` = 交给下一段
// - 同一段可以多次 session.send()，不限制条数
// - 每段有超时与失败隔离：一个中间件抛错/超时不影响其它
//
// 顺序按名字定位，不用数字：before / after 指向已注册的中间件名，或三个段名本身。
// 类型声明在 src/types/pipeline.ts，这里只留实现。

import type {
  CommandHandler,
  LlmHandler,
  Middleware,
  MiddlewareOptions,
  Next,
  PipelineConfig,
  PipelineErrorInfo,
  PipelineResult,
  PipelineSession,
} from '../types/pipeline.ts'

export type {
  CommandHandler,
  LlmHandler,
  Middleware,
  MiddlewareOptions,
  Next,
  PipelineConfig,
  PipelineErrorInfo,
  PipelineResult,
  PipelineSession,
  StageName,
} from '../types/pipeline.ts'

export interface PipelineOptions extends Partial<PipelineConfig> {
  /** 某段出错时的回调（中间件失败会被跳过，这里负责让它可见）。 */
  onError?: (info: PipelineErrorInfo) => void
}

export const DEFAULT_CONFIG: PipelineConfig = {
  commandPrefixes: [null, '/'],
  middlewareAfterCommand: false,
}

interface Entry {
  name: string
  kind: 'middleware'
  fn: Middleware
  options: MiddlewareOptions
}

const NOT_CONSUMED: PipelineResult = { handled: false, by: null }

export class Pipeline {
  private readonly entries: Entry[] = []
  private readonly commands = new Map<string, CommandHandler>()
  private llmHandler: LlmHandler | null = null
  private readonly onError?: (info: PipelineErrorInfo) => void
  private seq = 0
  private depth = 0
  config: PipelineConfig = { ...DEFAULT_CONFIG }

  constructor(options: PipelineOptions = {}) {
    const { onError, ...config } = options
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onError = onError
  }

  /** 注册中间件，返回卸载函数。 */
  use(fn: Middleware, options: MiddlewareOptions = {}): () => void {
    const name = options.name || `mw-${++this.seq}`
    if (this.entries.some((e) => e.name === name)) throw new Error(`中间件名「${name}」重复了`)
    const entry: Entry = { name, kind: 'middleware', fn, options }
    const at = this.positionOf(options.before, options.after)
    if (at < 0) throw new Error(`before / after 指向的「${options.before || options.after}」不存在`)
    this.entries.splice(at, 0, entry)
    return () => {
      const i = this.entries.indexOf(entry)
      if (i >= 0) this.entries.splice(i, 1)
    }
  }

  /** 指令路由：name 就是去掉前缀后的第一个词。 */
  command(name: string, handler: CommandHandler): () => void {
    this.commands.set(name, handler)
    return () => {
      if (this.commands.get(name) === handler) this.commands.delete(name)
    }
  }

  /** 管线末端：交给模型。没注册时视为未消费。 */
  onLlm(handler: LlmHandler): () => void {
    this.llmHandler = handler
    return () => {
      if (this.llmHandler === handler) this.llmHandler = null
    }
  }

  /** 当前顺序（调试 / 面板展示用）。 */
  order(): string[] {
    return ['command', ...this.entries.map((e) => e.name), 'llm']
  }

  /** 拆前缀：返回 { prefix, command, args }，没有前缀时 prefix 为 null。 */
  parseCommand(content: string): { prefix: string | null; command: string; args: string } {
    const text = String(content ?? '')
    for (const prefix of this.config.commandPrefixes) {
      if (prefix === null) continue
      if (prefix && text.startsWith(prefix)) {
        const rest = text.slice(prefix.length).trimStart()
        const { command, args } = splitWord(rest)
        return { prefix, command, args }
      }
    }
    // 无前缀：第一个词能对上指令才算
    const { command, args } = splitWord(text.trimStart())
    if (command && this.commands.has(command)) return { prefix: null, command, args }
    return { prefix: null, command: '', args: '' }
  }

  async dispatch(session: PipelineSession): Promise<PipelineResult> {
    // ① 指令段
    const parsed = this.findCommand(session.content)
    if (parsed) {
      const handler = this.commands.get(parsed.command)!
      try {
        const value = await handler(session, parsed.args, parsed.command)
        if (!this.config.middlewareAfterCommand) return { handled: true, by: 'command', value }
      } catch (error) {
        this.report('command', error)
        return { handled: true, by: 'command', error: messageOf(error) }
      }
    }

    // ② 中间件段
    const result = await this.run(0, session)
    if (result.handled) return result

    // ③ 模型段
    if (!this.llmHandler) return NOT_CONSUMED
    try {
      return { handled: true, by: 'llm', value: await this.llmHandler(session) }
    } catch (error) {
      this.report('llm', error)
      return { handled: true, by: 'llm', error: messageOf(error) }
    }
  }

  /**
   * session.execute(text)：以当前会话身份本地跑一遍管线（会真的发出去）。
   * 递归深度限 1 —— execute 里再 execute 直接拒绝。
   */
  async execute(session: PipelineSession, text: string): Promise<PipelineResult> {
    if (this.depth >= 1) return { handled: false, by: null, error: 'execute 不允许递归调用' }
    this.depth++
    try {
      // 保留原型：session 是 class 实例，展开会丢掉 send / sendMessage 这些方法
      const child = Object.create(Object.getPrototypeOf(session)) as PipelineSession
      Object.assign(child, session, { content: String(text ?? '') })
      return await this.dispatch(child)
    } finally {
      this.depth--
    }
  }

  private findCommand(content: string): { command: string; args: string } | null {
    const text = String(content ?? '')
    // 带前缀
    for (const prefix of this.config.commandPrefixes) {
      if (!prefix || !text.startsWith(prefix)) continue
      const rest = text.slice(prefix.length).trimStart()
      const { command, args } = splitWord(rest)
      if (command && this.commands.has(command)) return { command, args }
    }
    // 无前缀（含「命令消费后要不要继续」的默认口径：只有对得上指令才算）
    if (this.config.commandPrefixes.includes(null)) {
      const trimmed = text.trimStart()
      const { command, args } = splitWord(trimmed)
      if (command && this.commands.has(command)) return { command, args }
    }
    return null
  }

  private async run(index: number, session: PipelineSession): Promise<PipelineResult> {
    if (index >= this.entries.length) return NOT_CONSUMED
    const entry = this.entries[index]
    let advanced = false
    const next: Next = async () => {
      advanced = true
      return this.run(index + 1, session)
    }

    try {
      const value = await withTimeout(entry.fn(session, next), entry.options.timeoutMs)
      // 没调 next() = 这条我处理完了
      if (!advanced) return { handled: true, by: 'middleware', value }
      // 调了 next()：下一段的结果就是这一段的结果
      return value as PipelineResult
    } catch (error) {
      // 失败隔离：默认跳过这一段，继续往后走
      this.report(entry.name, error)
      if (entry.options.onError === 'throw') throw error
      return this.run(index + 1, session)
    }
  }

  private report(stage: string, error: unknown): void {
    try {
      this.onError?.({ stage, error })
    } catch {
      // 报错回调自己炸了不能影响管线
    }
  }

  private positionOf(before?: string, after?: string): number {
    if (before) {
      if (before === 'middleware') return 0
      if (before === 'llm') return this.entries.length
      const i = this.entries.findIndex((e) => e.name === before)
      return i
    }
    if (after) {
      if (after === 'command') return 0
      if (after === 'middleware') return this.entries.length
      const i = this.entries.findIndex((e) => e.name === after)
      return i < 0 ? -1 : i + 1
    }
    return this.entries.length
  }
}

function messageOf(error: unknown): string {
  return String((error as { message?: string })?.message ?? error).slice(0, 300)
}

/** 拆出第一个词当指令名，剩下的原样当参数（内部空格保留，两端去掉）。 */
function splitWord(source: string): { command: string; args: string } {
  const match = source.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return { command: '', args: '' }
  return { command: match[1], args: (match[2] ?? '').trim() }
}

function withTimeout<T>(value: T | Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(value)
  return Promise.race([
    Promise.resolve(value),
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`中间件超时（${timeoutMs}ms）`)), timeoutMs)
      timer.unref?.()
    }),
  ])
}
