/**
 * 插件上下文（`ctx`）契约：AuraBot 插件能碰到的全部能力都写在这里。
 *
 * 口径与 Koishi / Cordis 一致：插件只写 `apply(ctx, config)`，
 * 能力从 ctx 上取，注册的东西随模块卸载自动回收。
 */

import type { BotsAccessor, BotLike } from '../adapter/bot.ts'
import type { AdapterHandle, AdapterSpec } from '../adapter/adapter.ts'
import type { ElementFactory } from '../core/element.ts'
import type { CommandOptions, Middleware, MiddlewareOptions, SessionFilter } from './pipeline.ts'
import type { Target } from '../core/target.ts'

/**
 * `ctx.bot`：按 id 取机器人，不传 id 就取默认那个。
 *
 * ```ts
 * ctx.bot()                  // 默认机器人（第一个上线的）
 * ctx.bot('1787850032')      // 指定实例
 * ctx.bot.list()             // 全部
 * ```
 */
export interface BotAccessor {
  (id?: string): BotLike | undefined
  list(): BotLike[]
}

/** 一条广播的结果：谁发成了、谁没发成、为什么。 */
export interface BroadcastResult {
  target: Target
  ok: boolean
  error?: string
}

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

/** `ctx.server.get/post` 的处理函数，参数就是 Node 的 req/res。 */
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

/** `ctx.think`：以她的人格跑一轮后台会话（不发到任何聊天），返回模型输出的正文。 */
export interface ThinkOptions {
  title?: string
  /** 同一插件里区分多个后台会话。 */
  key?: string
  timeoutMs?: number
  noTools?: boolean
  level?: string
}

export interface ChatLogRow {
  t: number
  chatId: string
  who: string
  text: string
  uid?: string
  forgottenAt?: number
}

/** `ctx.chatLog`：她的聊天流水（只读当天 + 追加一条旁白）。 */
export interface ChatLogFacade {
  read(day: string): ChatLogRow[]
  append(chatId: string, who: string, text: string, uid?: string): unknown
}

/** `ctx.http`：面板路由里读请求、回响应的小工具。 */
export interface HttpHelpers {
  body(req: any): Promise<Record<string, any>>
  query(req: any): Record<string, string>
  send(res: any, status: number, body: unknown, type?: string): void
}

/** 管线本体（`ctx.middleware` 要挂到它上面）。 */
export interface PipelineLike {
  use(fn: Middleware, options?: MiddlewareOptions): () => void
  command(name: string, handler: (...args: any[]) => unknown, options?: CommandOptions): () => void
}

/**
 * 按平台 / 会话类型收窄的上下文。
 *
 * 写法和 Koishi 一致：`ctx.platform('qq').middleware(...)`、`ctx.guild().on(...)`。
 * 返回的是**同一份 ctx 的视图**，注册的东西仍然挂在当前模块上，模块卸载时一起撤。
 */
export interface ScopeFactory {
  /** 只处理这个平台的消息。 */
  platform(name: string): this
  /** 只处理频道 / 群消息；给了 id 就再收窄到这一个。 */
  guild(id?: string): this
  /** 只处理私聊。 */
  private(): this
}

export interface PluginContextExtras {
  bots?: BotsAccessor
  bot?: BotLike
  /** 读当前全局配置（每次读都拿最新的，不是加载时的快照）。 */
  rootConfig?: () => Record<string, any>
  Schema?: unknown
  h?: ElementFactory
  pipeline?: PipelineLike
  llm?: LlmFacade
  tts?: TtsFacade
  startAdapter?: (spec: AdapterSpec, config: unknown) => Promise<AdapterHandle>
  /** 注册面板页面（内核把页面表交给前端侧栏）。 */
  registerPage?: (page: PluginPage) => () => void
  /** 记忆模块的本地预览入口（内核注入，只有 memory 用）。 */
  nativePreview?: (read: any) => () => void
  /** 内核服务表（voice / sing / database / ffmpeg…）。 */
  services?: { provide(name: string, impl: any, provider: string): () => void; get<T = any>(name: string): T | null; has(name: string): boolean; require<T = any>(name: string): T; names(): string[] }
}

export interface PluginPage {
  /** 面板路由路径，例如 /sandbox 或 /adapters/qq。 */
  path: string
  /** 侧栏显示的名字。 */
  name: string
  /** 图标（emoji 或内置图标名）。 */
  icon?: string
  /** 排序权重，小的在前。 */
  order?: number
  /** 页面地址。给绝对地址（http://…）时直接用它，否则按插件路由前缀拼。 */
  url?: string
}

/**
 * 插件上下文：只有 `apply(ctx, config)` 这一种写法。
 *
 * `ctx.config` 是本插件自己的配置（面板按 config.ts 的 Schema 渲染）；
 * `ctx.root.config` 是全局配置。两者都是活对象，改配置后读到的就是最新值。
 */
export interface PluginContext extends ScopeFactory {
  readonly id: string
  readonly version: string
  readonly apiVersion: number
  /** 插件自己的源码目录（只读；要写数据用 dataDir）。 */
  readonly baseDir: string
  /** 本插件的配置对象（活值）。 */
  readonly config: Record<string, any>
  /** 全局配置。 */
  readonly root: { readonly config: Record<string, any>; read(): Record<string, any>; update(patch: any): unknown }
  /** 保存本插件的配置。 */
  updateConfig(patch: Record<string, any> | ((current: Record<string, any>) => Record<string, any>)): Record<string, any>
  /** 定时器随模块卸载自动回收（Cordis 的 effect 语义），不要用裸 setInterval。 */
  setInterval: (ms: number, fn: () => unknown, label?: string) => () => void
  setTimeout: (ms: number, fn: () => unknown) => () => void
  effect: (fn: unknown) => () => void
  /** 入站中间件，默认挂在 `middleware` 段。 */
  middleware: (fn: Middleware, options?: MiddlewareOptions) => () => void
  /** 注册本地指令：不经过 AI，用户发「/名字 参数」直接命中。 */
  command: {
    (signature: string): CommandBuilder
    (signature: string, handler: (...args: any[]) => unknown): () => void
  }
  /** 注册给 AI 调用的工具：用户不能直接触发，得模型自己决定调用并传参。 */
  tool: (builder: unknown) => () => void
  /** 构建工具定义（纯构造，不注册）；多个工具用 ctx.tool(工厂函数) 一起挂。 */
  defineTool: (spec: any) => any
  /** 给面板加 HTTP 接口（`/aurabot/api/ext/<id>/…`）。 */
  server: ServerFacade
  /** 在面板侧栏注册一个页面。 */
  page: (page: PluginPage) => () => void
  /** 日志：info / warn / debug / error；debug 只在调试模式输出。 */
  logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug: (...args: any[]) => void }
  /** 宿主核心（hub / onebot / local / http 等）；不要直接改它。 */
  host: Record<string, any>
  /** DeepSeek Harness 的 ctx。 */
  harness: Record<string, any>
  /** 取另一个模块的导出对象；没在跑返回 null。 */
  get: <T = unknown>(id: string) => T | null
  /** 注册一项能力（服务），模块卸载自动摘掉；别的插件用 ctx.get(name) 取。 */
  provide: (name: string, impl: any) => () => void
  /** 取服务，没有就抛错（比 get 更适合必须可用的场合）。 */
  require: <T = unknown>(name: string) => T
  /** 服务表。 */
  services: { get<T = any>(name: string): T | null; has(name: string): boolean; require<T = any>(name: string): T; names(): string[] }
  /** 取另一个模块导出对象的懒代理（对方晚加载也能用）。 */
  lazy: <T = unknown>(id: string) => T
  /** 另一个模块是否在跑。 */
  has: (id: string) => boolean
  /** 这个 ID 是不是主人（支持多个主人 ID）。 */
  isOwner: (userId: string | number) => boolean
  /** 每轮回复前追加一段上下文。 */
  prompt: (fn: (args: any) => unknown) => () => void
  /** 追加到系统提示的规则行。 */
  rule: (fn: any) => () => void
  /** 主动发一条消息：chatId 形如 private:<id> / group:<id>；按当前可用机器人发。 */
  sendTo: (chatId: string, content: unknown, options?: any) => Promise<any>
  /** 按 chatId 的前缀发图。 */
  sendImage: (chatId: string, src: unknown) => Promise<any>
  /** 按 chatId 的前缀发文件。 */
  sendFile: (chatId: string, file: unknown, name?: string) => Promise<any>
  /** 按 chatId 的前缀发语音文件。 */
  sendVoiceFile: (chatId: string, file: unknown, note?: string) => Promise<any>
  /** 回复某条消息。 */
  reply: (msg: any, content: unknown) => Promise<any>
  /** 出站治理面。 */
  proactive: { available: boolean; submit(input?: any): any; statusOf(id: any): any }
  /** 直接问一次模型（不进会话）。 */
  ask: (options: any) => Promise<any>
  /** 以人格跑一轮后台会话，返回正文；失败抛错。 */
  think: (prompt: string, options?: ThinkOptions) => Promise<string>
  /** 后台会话还在退避期就返回重试时间，否则 null。 */
  thinkCooldown: (key?: string) => { retryAt: number; message?: string } | null
  chatLog: ChatLogFacade
  http: HttpHelpers
  /** 适配器实例：连接 → 上线 → 可用；模块卸载时自动断开。 */
  adapter: (spec: AdapterSpec, config?: unknown) => Promise<AdapterHandle>
  /** 已上线的机器人：`ctx.bots[0]` / `ctx.bots('号')` / `ctx.bots.list()`。 */
  bots?: BotsAccessor
  /** 按 id 取机器人：`ctx.bot()` 默认、`ctx.bot('号')` 指定。 */
  bot?: BotAccessor
  broadcast: (targets: Target[], content: unknown, options?: { timeoutMs?: number }) => Promise<BroadcastResult[]>
  /** 往模块总线发一个自定义事件（别的模块 `ctx.on(名字)` 能收到）。 */
  emit: (event: string, ...args: any[]) => void
  /** 事件：`dispose` 走卸载队列，其它自定义事件照常。 */
  on: (event: string, fn: (...args: any[]) => unknown) => () => void
  /** 这个模块专属的数据目录（自动建好）：`modules-data/<id>/`，多实例时按实例分开。 */
  dataDir: (...parts: string[]) => string
  Schema?: unknown
  h?: ElementFactory
  llm?: LlmFacade
  tts?: TtsFacade
  [key: string]: any
}
