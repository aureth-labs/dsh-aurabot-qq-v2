/**
 * AuraBot 插件接口 v2（类型部分）。
 *
 * 与宿主 `src/types/**` 保持同一口径；这里只暴露插件作者需要的一面，
 * 宿主内部实现不在此包内。
 */

export declare const API_VERSION: 2

export type SchemaType = 'boolean' | 'string' | 'number' | 'array' | 'union' | 'object'

export interface SchemaMeta {
  type: SchemaType
  default?: unknown
  description?: string
  required?: boolean
  min?: number
  max?: number
  items?: Schema
  options?: readonly unknown[]
  dict?: Record<string, Schema>
  flags: string[]
}

export class Schema {
  readonly meta: SchemaMeta
  constructor(meta: SchemaMeta)
  default(value: unknown): this
  description(text: string): this
  min(value: number): this
  max(value: number): this
  required(): this
  experimental(): this
  hidden(): this
  deprecated(): this
  role(name: string): this
  static string(): Schema
  static number(): Schema
  static natural(): Schema
  static boolean(): Schema
  static array(items: Schema): Schema
  static union(options: readonly unknown[]): Schema
  static object(dict: Record<string, Schema>): Schema
}
// ── 消息元素 ───────────────────────────────────────────────────────

export interface Element {
  type: string
  attrs: Record<string, any>
  children?: Element[]
}

export type ElementSource = string | Element | Element[] | null | undefined

/** 宿主注入的全局 `h`：构造元素、解析 XML、挑元素。 */
export interface ElementFactory {
  (type: string, attrs?: Record<string, any>, children?: Element[]): Element
  text(content: string): Element
  at(id: string | number, name?: string): Element
  image(url: string, extra?: Record<string, any>): Element
  voice(url: string, extra?: Record<string, any>): Element
  video(url: string, extra?: Record<string, any>): Element
  file(url: string, name?: string): Element
  face(id: string | number): Element
  quote(id: string | number): Element
  parse(source: string): Element[]
  stringify(source: ElementSource): string
  select(source: ElementSource, selector: string | ((element: Element) => boolean)): Element[]
  normalize(source: ElementSource): Element[]
  isElement(value: unknown): value is Element
}

// ── Bot / 目标 ─────────────────────────────────────────────────────

export type BotStatus = 'registered' | 'connecting' | 'online' | 'offline' | 'error'

export type Capability =
  | 'text'
  | 'at'
  | 'face'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'forward'
  | 'markdown'
  | 'html'
  | 'satori'
  | 'quote'
  | 'reaction'

export interface SendOptions {
  replyTo?: string
  timeoutMs?: number
}

export interface BotLike {
  readonly id: string
  readonly platform: string
  readonly selfId: string
  readonly status: BotStatus
  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>
  supports(capability: Capability): boolean
}

export type BotsAccessor = BotLike[] & {
  (id: string): BotLike | undefined
  get(id: string): BotLike | undefined
  list(): BotLike[]
}

export type TargetType = 'group' | 'private' | 'channel'

export interface Target {
  platform: string
  botId: string
  type: TargetType
  id: string
}

// ── 适配器契约 ─────────────────────────────────────────────────────

/** 适配器收到一条平台消息后投给宿主的东西。 */
export interface InboundMessage {
  type: TargetType
  channelId: string
  userId: string
  userName?: string
  content?: string
  elements?: Element[]
  messageId?: string
  guildId?: string
  timestamp?: number
  raw?: unknown
}

export interface AdapterRuntime {
  platform: string
  log(message: string): void
  /** 收到消息就投进来：宿主建 Session、跑 command → middleware → llm。 */
  emitMessage(message: InboundMessage): void
  emitEvent?(event: string, payload: unknown): void
  speak?(text: string): Promise<string>
  supports?(capability: Capability): boolean
}

export interface AdapterSpec {
  platform: string
  resolvePlatform?(config: unknown): string | undefined
  name?: string
  capabilities?: Capability[]
  connect(config: any, runtime: AdapterRuntime): Promise<BotLike>
  disconnect?(bot: BotLike, config: any): Promise<void>
}

export interface AdapterHandle {
  bot: BotLike
  dispose(): Promise<void>
}

// ── Session / 管线 ─────────────────────────────────────────────────

export interface Session {
  readonly bot: BotLike
  readonly type: TargetType
  readonly channelId: string
  readonly userId: string
  readonly userName?: string
  readonly content: string
  readonly platform: string
  readonly isPrivate: boolean
  readonly elements: Element[]
  send(...content: unknown[]): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>
  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  /** 以当前会话身份再跑一遍这条消息（会真的发出去）。 */
  execute(text: string): Promise<{ handled: boolean; by: string | null; value?: unknown; error?: string }>
}

export type Next = () => Promise<{ handled: boolean; by: string | null; value?: unknown }>
export type Middleware = (session: Session, next: Next) => unknown

export interface MiddlewareOptions {
  name?: string
  before?: string
  after?: string
  timeoutMs?: number
  onError?: 'skip' | 'throw'
}

export interface Command {
  description(text: string): Command
  usage(text: string): Command
  alias(...names: string[]): Command
  action(handler: (args: { session: Session; command: string; args: string }, ...params: any[]) => unknown): () => void
}

export type ServerHandler = (request: unknown) => unknown

/** 和 Koishi 的 `ctx.server` 一样：一个 HTTP 路由实例，按动词注册。 */
export interface Server {
  get(path: string, handler: ServerHandler, options?: { access?: 'panel' | null }): () => void
  post(path: string, handler: ServerHandler, options?: { access?: 'panel' | null }): () => void
  put(path: string, handler: ServerHandler, options?: { access?: 'panel' | null }): () => void
  patch(path: string, handler: ServerHandler, options?: { access?: 'panel' | null }): () => void
  delete(path: string, handler: ServerHandler, options?: { access?: 'panel' | null }): () => void
}

/** 宿主给模块的 core（只列示例会用到的部分）。 */
export interface CoreLike {
  http: {
    body(request: unknown): Promise<Record<string, any>>
  }
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>): unknown
}

/** 按平台 / 会话类型收窄的上下文，写法和 Koishi 一致。 */
export interface Scope {
  platform(name: string): this
  guild(id?: string): this
  private(): this
}

export interface BroadcastResult {
  target: Target
  ok: boolean
  error?: string
}

export interface Ctx extends Scope {
  logger: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
    debug(message: string): void
  }
  command(name: string): Command
  /** 老写法：整段参数原样交给回调。 */
  command(name: string, handler: (...args: any[]) => unknown): () => void
  middleware(fn: Middleware, options?: MiddlewareOptions): () => void
  tool(spec: ToolSpec | ((...args: any[]) => any)): () => void
  server: Server
  /** 注册一个适配器实例：连接 → 上线 → 可用；模块卸载时自动断开。 */
  adapter(spec: AdapterSpec, config?: unknown): Promise<AdapterHandle>
  /** 已上线的机器人：`ctx.bots[0]` / `ctx.bots('号')` / `ctx.bots.list()`。 */
  bots?: BotsAccessor
  /** 按 id 取机器人；不传就是默认那个。 */
  bot?: (id?: string) => BotLike | undefined
  broadcast(targets: Target[], content: unknown, options?: { timeoutMs?: number }): Promise<BroadcastResult[]>
  /** 往模块总线发自定义事件。 */
  emit(event: string, ...args: any[]): void
  on(event: string, listener: (...args: any[]) => unknown): () => void
  effect(fn: unknown): () => void
  setInterval(ms: number, fn: () => unknown, label?: string): () => void
  setTimeout(ms: number, fn: () => unknown): () => void
  h: ElementFactory
  root: { config: Record<string, any> }
  /** 宿主内部的 scoped core（自带能力的插件才会用到）。 */
  core?: CoreLike
  /** 全局配置快照（只读）。 */
  config?(): Record<string, any>
  /** 默认值 + 面板保存过的值，每次调用都是最新的。 */
  settings?(): Record<string, any>
  saveSettings?(patch: Record<string, unknown>): Record<string, any>
}
