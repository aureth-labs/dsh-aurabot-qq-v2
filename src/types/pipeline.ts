/**
 * 入站管线契约：command → middleware → llm。
 *
 * 语义：
 * - 指令先匹配；没被消费才往下走
 * - 中间件 `return` 不调 `next()` = 这条我处理完了，不再往下传
 * - 中间件 `return next()` = 交给下一段
 * - 同一段可以多次 `session.send()`，不限制条数
 * - 每段有超时与失败隔离：一个中间件抛错/超时不影响其它
 *
 * 顺序按名字定位，不用数字：`before` / `after` 指向已注册的中间件名，或三个段名本身。
 */

export type StageName = 'command' | 'middleware' | 'llm'

export interface PipelineConfig {
  /** 指令前缀，`null` 表示无前缀。默认 `[null, '/']`。 */
  commandPrefixes: Array<string | null>
  /** 指令消费后要不要继续走中间件。默认 false（开发中开关）。 */
  middlewareAfterCommand: boolean
}

export interface MiddlewareOptions {
  /** 中间件名，供 `before` / `after` 定位；不写就自动编号。 */
  name?: string
  before?: string
  after?: string
  timeoutMs?: number
  onError?: 'skip' | 'throw'
}

export type Next = () => Promise<PipelineResult>

/** 管线只需要这几个字段，避免把整个 Session 类拖进契约。 */
export interface PipelineSession {
  content: string
  bot?: { platform?: string }
  type?: string
  guildId?: string
  /** 这条会话往外发过几次；中间件抛错时用它判断「是不是已经认领了这条消息」。 */
  sentCount?: number
  /** 过渡期：OneBot 原始事件的挂载位（S8 适配器收口后由适配器自己消化）。 */
  __ev?: unknown
  /**
   * 复制一份「同一身份、换内容」的会话，给 `session.execute()` 用。
   *
   * 会话实现方（`Session`）自己 new 一个实例返回，别让管线靠
   * `Object.create(prototype) + Object.assign` 拼——那套写法一遇到私有字段、
   * getter、不可枚举状态就会静默丢东西，中间件拿到残缺会话后报错被跳过，
   * 消息就无声地掉进模型段。
   */
  withContent?(content: string): PipelineSession
}

export interface PipelineResult {
  /** 有没有被消费（消费后不再进模型）。 */
  handled: boolean
  /** 哪一段消费的 */
  by: StageName | null
  value?: unknown
  error?: string
}

export type Middleware = (session: PipelineSession, next: Next) => unknown
export type CommandHandler = (session: PipelineSession, args: string, command: string) => unknown
export type LlmHandler = (session: PipelineSession) => unknown

/** 某一段出错时抛给宿主的信息（插件写错了要有地方看见，不能静默吞掉）。 */
export interface PipelineErrorInfo {
  stage: string
  error: unknown
}

/**
 * Session 需要的那一小块管线能力。
 *
 * 声明成结构类型而不是直接引用 `Pipeline` 类，是为了避免「类 ↔ 会话」互相 import 成环。
 */
export interface PipelineRunner {
  dispatch(session: PipelineSession): Promise<PipelineResult>
  execute(session: PipelineSession, text: string): Promise<PipelineResult>
}
