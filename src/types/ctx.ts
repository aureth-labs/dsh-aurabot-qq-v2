/**
 * 插件上下文（`ctx`）契约：AuraBot 插件能碰到的全部能力都写在这里。
 *
 * 口径与 Koishi / Cordis 一致：插件只写 `apply(ctx, config)`，
 * 能力从 ctx 上取，注册的东西随模块卸载自动回收。
 */

import type { BotsAccessor, BotLike } from './bot.ts'
import type { AdapterHandle, AdapterSpec } from './adapter.ts'
import type { ElementFactory } from './element.ts'
import type { Middleware, MiddlewareOptions } from './pipeline.ts'

/** 文本改写类调用的通用参数。 */
export interface LlmTextOptions {
  /** 追加的语气 / 风格要求，例如「保持原意，更口语一点」。 */
  instruction?: string
  /** 输出上限，默认由实现决定。 */
  maxTokens?: number
  temperature?: number
  /** 指定模型；不写就跟随面板设置。 */
  model?: { provider: string; model: string }
}

export interface LlmSummaryOptions extends LlmTextOptions {
  /** 摘要长度上限（字），默认 200。 */
  maxLength?: number
}

/** 指令签名里解析出来的一个参数。 */
export interface CommandArg {
  name: string
  /** 参数类型：string / number / text（text = 后面整段话）。 */
  type: string
  required: boolean
}

/** 指令回调拿到的上下文。 */
export interface CommandActionContext {
  session: any
  /** 命中的指令名（第一个词）。 */
  command: string
  /** 指令后面那一整段原文。 */
  args: string
  options: Record<string, any>
}

/**
 * `ctx.command('名字 <参数>')` 返回的构造器。
 *
 * 和 Koishi 一个写法：先描述，最后 `.action()` 真正注册；
 * `.action()` 的返回值是卸载函数（模块卸载时宿主也会自动撤）。
 */
export interface CommandBuilder {
  description(text: string): this
  usage(text: string): this
  alias(...names: string[]): this
  action(fn: (context: CommandActionContext, ...values: any[]) => unknown): () => void
  /** 手动撤销（一般不用，模块卸载会自动撤）。 */
  dispose(): void
}

/** `ctx.server.get/post` 的处理函数，和 v1 的 api.route 同一套 req/res。 */
export type RouteHandler = (req: any, res: any) => unknown

/**
 * `ctx.server`：给面板加接口。
 *
 * 默认带 `access: 'panel'`（复用宿主的回环 / 可信代理 / Host / CSRF 闸），
 * 确实要对外开放时传 `{ access: null }`，自己在处理函数里验签。
 */
export interface ServerFacade {
  get(path: string, handler: RouteHandler, options?: { access?: 'panel' | null }): () => void
  post(path: string, handler: RouteHandler, options?: { access?: 'panel' | null }): () => void
  put(path: string, handler: RouteHandler, options?: { access?: 'panel' | null }): () => void
  patch(path: string, handler: RouteHandler, options?: { access?: 'panel' | null }): () => void
  delete(path: string, handler: RouteHandler, options?: { access?: 'panel' | null }): () => void
}

/**
 * `ctx.llm`：宿主提供的模型能力。
 *
 * 现在只有文本三件套；图片 / 视频生成后续挂在这里，不另开入口。
 * 这些调用不进聊天会话、不计入人格上下文，适合后台小任务。
 */
export interface LlmFacade {
  /** 润色：保留原意，只修病句、补标点、顺语序。 */
  polish(text: string, options?: LlmTextOptions): Promise<string>
  /** 改写：按 `instruction` 换一种说法（正式 / 口语 / 简短……）。 */
  rewrite(text: string, options?: LlmTextOptions): Promise<string>
  /** 摘要：压到 `maxLength` 字以内，只留事实。 */
  summarize(text: string, options?: LlmSummaryOptions): Promise<string>
}

/** `ctx.tts`：文字转语音，返回可直接发送的音频地址或 data URL。 */
export interface TtsFacade {
  speak(text: string): Promise<string>
}

/** 管线本体（`ctx.middleware` 要挂到它上面）。 */
export interface PipelineLike {
  use(fn: Middleware, options?: MiddlewareOptions): () => void
  command(name: string, handler: (...args: any[]) => unknown): () => void
}

/** v1 的 api 对象：老插件靠它，这里只声明本框架用到的部分。 */
export interface ApiLike {
  every?: (ms: number, fn: () => unknown, label?: string) => () => void
  later?: (ms: number, fn: () => unknown) => () => void
  onDispose?: (fn: () => unknown) => () => void
  /** 任意自定义事件名都收：插件之间可以自己约定事件。 */
  on?: (event: string, fn: (...args: any[]) => unknown) => () => void
  settings?: () => Record<string, any>
  [key: string]: any
}

export interface PluginContextExtras {
  bots?: BotsAccessor
  bot?: BotLike
  Schema?: unknown
  h?: ElementFactory
  pipeline?: PipelineLike
  llm?: LlmFacade
  tts?: TtsFacade
  startAdapter?: (spec: AdapterSpec, config: unknown) => Promise<AdapterHandle>
}

export interface PluginContext extends ApiLike {
  /** 随模块卸载自动清掉的定时器（Cordis 的 effect 语义），别用裸 setInterval。 */
  setInterval: (ms: number, fn: () => unknown, label?: string) => () => void
  setTimeout: (ms: number, fn: () => unknown) => () => void
  effect: (fn: unknown) => () => void
  /** 入站中间件，默认挂在 `middleware` 段。 */
  middleware: (fn: Middleware, options?: MiddlewareOptions) => () => void
  /**
   * 注册本地指令：**不经过 AI**，用户发「/名字 参数」就直接命中。
   *
   * 两种写法都认：
   * ```ts
   * ctx.command('ping', (session) => session.send('pong'))
   * ctx.command('hello <text:string>').description('打招呼').action(({ session }, text) => session.send(text))
   * ```
   */
  command: {
    (signature: string): CommandBuilder
    (signature: string, handler: (...args: any[]) => unknown): () => void
    /** v1 兼容：api.command({ name, run }) 注册的是「给 AI 调用的命令」。 */
    (builder: any): () => void
  }
  /** 注册给 AI 调用的工具：用户不能直接触发，得模型自己决定调用并传参。 */
  tool: (builder: unknown) => () => void
  /** 给面板加 HTTP 接口（`/aurabot/api/ext/<id>/…`）。 */
  server: ServerFacade
  /** 和 `ctx.log` 同一个东西，写惯了 Koishi 的可以直接用。 */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug: (...args: any[]) => void }
  /** 注册一个适配器实例：连接 → 上线 → 可用；模块卸载时自动断开。 */
  adapter: (spec: AdapterSpec, config?: unknown) => Promise<AdapterHandle>
  /** 已上线的机器人：`ctx.bots[0]` / `ctx.bots('号')` / `ctx.bots.list()`。 */
  bots?: BotsAccessor
  /** 当前默认机器人（QQ 场景=那个 OneBot 号）。 */
  bot?: BotLike
  Schema?: unknown
  h?: ElementFactory
  llm?: LlmFacade
  tts?: TtsFacade
}
