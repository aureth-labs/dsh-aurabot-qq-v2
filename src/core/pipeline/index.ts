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
// 类型声明在 src/types/plugin/pipeline.ts，这里只留实现。

import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  CommandHandler,
  CommandOptions,
  LlmHandler,
  Middleware,
  MiddlewareOptions,
  Next,
  PipelineConfig,
  PipelineErrorInfo,
  PipelineResult,
  PipelineSession,
} from '../../types/plugin/pipeline.ts'

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
} from '../../types/plugin/pipeline.ts'

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
  private readonly commands = new Map<string, CommandOptions & { handler: CommandHandler }>()
  private llmHandler: LlmHandler | null = null
  private readonly onError?: (info: PipelineErrorInfo) => void
  private seq = 0
  private readonly executing = new AsyncLocalStorage<boolean>()
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

  /**
   * 指令路由：name 就是去掉前缀后的第一个词。
   *
   * `options.filter` 是作用域过滤器（`ctx.platform('qq')` 这类）：
   * 不满足的会话直接当作「没有这条指令」，继续走中间件与模型，不会被指令吞掉。
   */
  command(name: string, handler: CommandHandler, options: CommandOptions = {}): () => void {
    const entry = { ...options, handler }
    this.commands.set(name, entry)
    return () => { if (this.commands.get(name) === entry) this.commands.delete(name) }
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
    const parsed = this.findCommand(session)
    if (parsed) {
      const { handler, authority = 1 } = this.commands.get(parsed.command)!
      if ((session.authority ?? 1) < authority) return { handled: true, by: 'command' }
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
    if (this.executing.getStore()) return { handled: false, by: null, error: 'execute 不允许递归调用' }
    return this.executing.run(true, () => this.dispatch(forkSession(session, String(text ?? ''))))
  }

  private findCommand(session: PipelineSession): { command: string; args: string } | null {
    const text = String(session.content ?? '')
    // 带前缀
    for (const prefix of this.config.commandPrefixes) {
      if (!prefix || !text.startsWith(prefix)) continue
      const rest = text.slice(prefix.length).trimStart()
      const { command, args } = splitWord(rest)
      if (this.matches(command, session)) return { command, args }
    }
    // 无前缀（含「命令消费后要不要继续」的默认口径：只有对得上指令才算）
    if (this.config.commandPrefixes.includes(null)) {
      const trimmed = text.trimStart()
      const { command, args } = splitWord(trimmed)
      if (this.matches(command, session)) return { command, args }
    }
    return null
  }

  /** 这条指令存在，且当前会话满足它的作用域过滤器。 */
  private matches(command: string, session: PipelineSession): boolean {
    if (!command || !this.commands.has(command)) return false
    const filter = this.commands.get(command)?.filter
    if (!filter) return true
    try {
      return Boolean(filter(session))
    } catch {
      // 过滤器自己炸了：按「不匹配」处理，别把消息吞掉
      return false
    }
  }

  private async run(index: number, session: PipelineSession): Promise<PipelineResult> {
    if (index >= this.entries.length) return NOT_CONSUMED
    const entry = this.entries[index]
    let downstream: Promise<PipelineResult> | undefined
    let active = true
    const next: Next = () => downstream ??= active
      ? this.run(index + 1, session)
      : Promise.resolve(NOT_CONSUMED)

    try {
      const value = await withTimeout(entry.fn(session, next), entry.options.timeoutMs)
      // 没调 next() = 这条我处理完了
      if (!downstream) return { handled: true, by: 'middleware', value }
      return downstream
    } catch (error) {
      // 失败隔离：默认跳过这一段，继续往后走
      this.report(entry.name, error)
      if (entry.options.onError === 'throw') throw error
      // 炸之前已经往会话里发过东西，说明这条它已经认领了。
      // 这时候再交给模型，用户就会收到两条——所以按「处理完了」收口。
      if (hasSent(session)) return { handled: true, by: 'middleware', error: messageOf(error) }
      return downstream ?? this.run(index + 1, session)
    } finally {
      active = false
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

/** 这条消息有没有被发出去过（Session 会累加，测试桩没有就当没发）。 */
function hasSent(session: PipelineSession): boolean {
  return Number((session as { sentCount?: number }).sentCount) > 0
}

/**
 * 造一条「同身份、换内容」的会话。
 *
 * 优先让会话自己复制（`withContent`）：那是真构造实例，方法、getter、私有字段都在。
 * 没实现的轻量会话（测试里的普通对象）退回浅拷贝——它们本来就没有原型状态可丢。
 */
function forkSession(session: PipelineSession, content: string): PipelineSession {
  if (typeof session.withContent === 'function') return session.withContent(content)
  return Object.assign(Object.create(Object.getPrototypeOf(session)) as PipelineSession, session, { content })
}

/** 拆出第一个词当指令名，剩下的原样当参数（内部空格保留，两端去掉）。 */
function splitWord(source: string): { command: string; args: string } {
  const match = source.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return { command: '', args: '' }
  return { command: match[1], args: (match[2] ?? '').trim() }
}

function withTimeout<T>(value: T | Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(value)
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`中间件超时（${timeoutMs}ms）`)), timeoutMs)
    Promise.resolve(value).then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
