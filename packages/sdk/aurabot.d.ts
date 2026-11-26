// Aurabot 插件类型（v2）。插件每次启动会把这份文件同步到 modules/ 下，别改它。
//
// 写法只有一种：
//   export const name = '…'; export function apply(ctx, config) { … }
//
// VS Code 里把入口写成 .ts，或在 .mjs 顶上写
//   /** @type {import('./aurabot').AurabotModule} */
// 就能拿到 ctx / session / h 的完整补全。

export interface Element {
  type: string
  attrs: Record<string, any>
  children?: Element[]
}

export type ElementSource = string | Element | Element[] | null | undefined
export type Selector = string | ((element: Element) => boolean)

/** 全局 `h`（宿主注入，不用 import）。 */
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
  forward(idOrChildren: string | number | Element[]): Element
  parse(source: string): Element[]
  stringify(source: ElementSource): string
  select(source: ElementSource, selector: Selector): Element[]
  normalize(source: ElementSource): Element[]
  degrade(source: ElementSource, supports: (capability: Capability) => boolean): Element[]
  isElement(value: unknown): value is Element
}

export type Capability =
  | 'text' | 'at' | 'face' | 'image' | 'voice' | 'video' | 'file'
  | 'forward' | 'markdown' | 'html' | 'satori' | 'quote' | 'reaction'

export type BotStatus = 'registered' | 'connecting' | 'online' | 'offline' | 'error'

export interface SendOptions {
  replyTo?: string
  timeoutMs?: number
}

export interface User {
  id: string
  name?: string
  nick?: string
  avatar?: string
  isBot?: boolean
  raw?: unknown
}

export interface Guild {
  id: string
  name?: string
  avatar?: string
  raw?: unknown
}

export type ChannelType = 'text' | 'voice' | 'category' | 'direct'

export interface Channel {
  id: string
  type: ChannelType
  name?: string
  guildId?: string
  parentId?: string
  raw?: unknown
}

export interface GuildMember {
  user: User
  nick?: string
  roles?: string[]
  joinedAt?: number
  raw?: unknown
}

export interface Message {
  userName?: string
  channelType?: 'private' | 'group' | 'channel'
  id: string
  channelId: string
  userId: string
  content: string
  elements?: Element[]
  createdAt?: number
  raw?: unknown
}

/** 一个已上线的机器人。资源方法对齐 Satori；平台不支持的会抛 UnsupportedApiError。 */
export declare abstract class Bot {
  abstract readonly id: string
  abstract readonly platform: string
  abstract readonly selfId: string
  abstract readonly status: BotStatus
  abstract supports(capability: Capability): boolean

  abstract sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  abstract sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>

  getSelfId(): string
  getSelf(): Promise<User>
  getUser(userId: string): Promise<User>
  getFriendList(): Promise<User[]>
  getGuild(guildId: string): Promise<Guild>
  getGuildList(): Promise<Guild[]>
  getUserList(guildId: string): Promise<GuildMember[]>
  getChannel(channelId: string, type?: Message['channelType']): Promise<Channel>
  getChannelList(guildId: string): Promise<Channel[]>
  getMessage(channelId: string, messageId: string): Promise<Message>
  getMessageList(channelId: string, query?: { channelType?: Message['channelType']; limit?: number; next?: string; order?: 'asc' | 'desc' }): Promise<Message[]>
  deleteMessage(channelId: string, messageId: string): Promise<void>
  updateMessage(channelId: string, messageId: string, content: unknown): Promise<Message>
  /** 平台原生调用：QQ 是 OneBot action，Telegram 是 Bot API 方法名。不支持的平台抛错。 */
  internal<T = any>(action: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>
  createReaction(channelId: string, messageId: string, emoji: string): Promise<void>
  deleteReaction(channelId: string, messageId: string, emoji: string): Promise<void>
}

/** 三种取法：ctx.bots[0] / ctx.bots('号') / ctx.bots.list()。 */
export type BotsAccessor = Bot[] & {
  (id: string, platform?: string): Bot | undefined
  get(id: string, platform?: string): Bot | undefined
  list(): Bot[]
}

export interface Target {
  platform: string
  botId: string
  type: 'private' | 'group' | 'channel'
  id: string
}

/** 一条入站消息。所有发送方法都是异步的，调用方一律 await。 */
export interface MessageQuote {
  id: string
  channelId: string
  userId?: string
  content?: string
  createdAt?: number
  deletedAt?: number
}

export interface Session {
  readonly quote?: MessageQuote
  readonly bot: Bot
  readonly type: Target['type']
  readonly channelId: string
  readonly userId: string
  readonly userName: string
  readonly content: string
  readonly messageId?: string
  readonly guildId?: string
  readonly elements: Element[]
  readonly timestamp: number
  readonly target: Target
  readonly platform: string
  readonly isPrivate: boolean
  /** 发回当前会话；可以多次调用，每次一条独立消息。 */
  send(content: unknown, options?: SendOptions): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown, options?: SendOptions): Promise<unknown>
  sendMessage(channelId: string, content: unknown, options?: SendOptions): Promise<unknown>
  /**
   * 以当前会话身份再发一遍：过指令 / 中间件 / 模型三段，该发出去的真发。
   * 等价于「用户又发了这句话」，不是本地空跑。递归深度限 1。
   */
  execute(text: string): Promise<PipelineResult>
}

export interface PipelineResult {
  handled: boolean
  by: 'command' | 'middleware' | 'llm' | null
  value?: unknown
  error?: string
}

export type Next = () => Promise<PipelineResult>

export type Middleware = (session: Session, next: Next) => unknown | Promise<unknown>

export interface MiddlewareOptions {
  /** 名字：插件内唯一，before / after 用它定位。 */
  name?: string
  /** 插到某个中间件之前；或段名 command / middleware / llm。 */
  before?: string
  /** 插到某个中间件之后。 */
  after?: string
}

export interface CommandActionContext {
  session: Session
  command: string
  args: string
  options: Record<string, any>
}

export interface CommandBuilder {
  description(text: string): this
  usage(text: string): this
  alias(...names: string[]): this
  /** 注册并返回卸载函数。返回值是 action 的返回值。 */
  action(fn: (context: CommandActionContext, ...values: any[]) => unknown): () => void
  dispose(): void
}

export interface ToolContext {
  sessionId: string
  level: string
  target?: Target
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema 的 properties。 */
  properties?: Record<string, any>
  required?: string[]
  parameters?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  execute(args: any, exec?: any): unknown
}

export interface Logger {
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  /** 只在面板打开「调试模式」时输出。 */
  debug(...args: any[]): void
}

export interface PageOptions {
  /** 侧栏路由，例如 /weather。 */
  path: string
  name: string
  icon?: string
  order?: number
  /** 绝对地址（http://…）时直接内嵌它，否则按插件路由前缀拼。 */
  url?: string
}

export interface LlmFacade {
  generate(options: { text: string; system?: string; sessionId?: string; maxTokens?: number; temperature?: number }): Promise<string>
  polish(text: string, options?: { instruction?: string; maxTokens?: number; temperature?: number }): Promise<string>
  rewrite(text: string, options?: { instruction?: string; maxTokens?: number; temperature?: number }): Promise<string>
  summarize(text: string, options?: { maxLength?: number; instruction?: string; maxTokens?: number; temperature?: number }): Promise<string>
}

export interface TtsFacade {
  speak(text: string): Promise<string>
}

export interface ServerFacade {
  get(path: string, handler: (req: any, res: any) => unknown, options?: { access?: 'panel' | null }): () => void
  post(path: string, handler: (req: any, res: any) => unknown, options?: { access?: 'panel' | null }): () => void
  put(path: string, handler: (req: any, res: any) => unknown, options?: { access?: 'panel' | null }): () => void
  patch(path: string, handler: (req: any, res: any) => unknown, options?: { access?: 'panel' | null }): () => void
  delete(path: string, handler: (req: any, res: any) => unknown, options?: { access?: 'panel' | null }): () => void
}

export interface InboundMessage {
  type: Target['type']
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
  readonly signal?: AbortSignal
  platform: string
  log(message: string): void
  emitMessage(message: InboundMessage): void
  statusChanged?(reason?: string): void
  emitEvent?(event: string, payload: unknown): void
  speak?(text: string): Promise<string>
  supports?(capability: Capability): boolean
}

export interface AdapterSpec {
  name?: string
  platform: string
  resolvePlatform?(config: unknown): string | undefined
  capabilities?: Capability[]
  connect(config: any, runtime: AdapterRuntime): Promise<Bot>
  disconnect?(bot: Bot, config: any): Promise<void>
}

export declare class UnsupportedApiError extends Error {
  constructor(bot: Pick<Bot, 'platform' | 'id'>, api: string)
  readonly code: 'UNSUPPORTED_API'
}

export interface Services {
  get<T = any>(name: string): T | null
  has(name: string): boolean
  require<T = any>(name: string): T
  names(): string[]
}

/**
 * 插件上下文。注册的东西随模块卸载自动回收：
 * 定时器、中间件、指令、工具、路由、页面、服务、机器人，一个都不用自己清。
 */
export interface Ctx {
  readonly instanceId: string
  readonly id: string
  readonly version: string
  readonly apiVersion: number
  readonly baseDir: string
  /** 本插件配置（活值；面板保存后立刻读到新值）。 */
  readonly config: Record<string, any>
  /** 全局配置：ctx.root.config 直接读，ctx.root.read() 每次拿最新。 */
  readonly root: { readonly config: Record<string, any>; read(): Record<string, any>; update(patch: any): unknown }
  updateConfig(patch: Record<string, any> | ((current: Record<string, any>) => Record<string, any>)): Record<string, any>

  readonly logger: Logger
  /** 定时器随插件卸载自动清。 */
  setInterval(ms: number, fn: () => unknown, label?: string): () => void
  setTimeout(ms: number, fn: () => unknown): () => void
  effect(fn: () => unknown): () => void

  /** 入站中间件，默认挂在 middleware 段。 */
  middleware(fn: Middleware, options?: MiddlewareOptions): () => void
  /** 注册不经过 AI 的指令。官方插件需在配置里打开 registerCommands。 */
  command(signature: string): CommandBuilder
  command(signature: string, handler: (session: Session, args: string) => unknown): () => void
  /** 注册给 AI 调用的工具：用户不能直接触发，要模型自己决定调用并传参。 */
  tool(builder: ToolSpec | ((where: ToolContext) => ToolSpec | ToolSpec[] | null)): () => void
  defineTool(spec: ToolSpec): any

  server: ServerFacade
  page(options: PageOptions): () => void

  /** 自定义事件；别的插件 ctx.on(名字) 能收到。 */
  emit(event: string, ...args: any[]): void
  on(event: string, fn: (...args: any[]) => unknown): () => void

  get<T = unknown>(id: string): T | null
  provide(name: string, impl: any): () => void
  require<T = unknown>(name: string): T
  readonly services: Services
  readonly voice: any
  readonly sing: any
  readonly database: any
  readonly ffmpeg: any

  /** 宿主注入的消息元素工厂，和 Koishi 一样不用 import。 */
  readonly h: ElementFactory
  readonly llm: LlmFacade
  readonly tts: TtsFacade
  readonly bot: {
    (id?: string, platform?: string): Bot | undefined
    list(): Bot[]
  }
  readonly bots: BotsAccessor
  broadcast(targets: Target[], content: unknown, options?: { timeoutMs?: number }): Promise<Array<{ target: Target; ok: boolean; error?: string }>>
  adapter(spec: AdapterSpec, config?: unknown): Promise<{ bot: Bot; dispose(): Promise<void> }>

  sendTo(chatId: string, content: unknown, options?: any): Promise<any>
  sendImage(chatId: string, src: unknown): Promise<any>
  sendFile(chatId: string, file: unknown, name?: string): Promise<any>
  sendVoiceFile(chatId: string, file: unknown, note?: string): Promise<any>
  reply(msg: any, content: unknown): Promise<any>
  ask(options: any): Promise<any>
  /** 以她的人格跑一轮后台会话（不发到聊天），返回正文。 */
  think(prompt: string, options?: { title?: string; key?: string; timeoutMs?: number; noTools?: boolean; level?: string }): Promise<string>
  /** 后台会话在退避期时返回重试时间，否则 null。 */
  thinkCooldown(key?: string): { retryAt: number; message?: string } | null
  readonly chatLog: {
    read(day: string): Array<{ t: number; chatId: string; who: string; text: string; uid?: string; forgottenAt?: number }>
    append(chatId: string, who: string, text: string, uid?: string): unknown
  }
  /** 工具执行时：这一轮说话的人是不是全是主人（sessionId 来自工具工厂的 where）。 */
  turnFromOwner(sessionId: string): boolean
  readonly text: {
    clean(value: unknown, label?: string): string
    isSilence(value: unknown): boolean
    sent(receipt: unknown): boolean
  }
  readonly http: {
    body(req: any): Promise<Record<string, any>>
    query(req: any): Record<string, string>
    send(res: any, status: number, body: unknown, type?: string): void
  }
  readonly media: { download(url: string, maxBytes: number): Promise<Buffer>; inspect(bytes: Buffer): { width: number; height: number; mime: string } }
  isOwner(session: Session): boolean
  isOwner(userId: string | number, platform: string, botId?: string): boolean
  /** 本插件的数据目录（已建好）。 */
  dataDir(...parts: string[]): string
}

/** 插件入口：和 Koishi 一样只有具名导出。 */
export interface PluginModule<C = any> {
  name?: string
  version?: string
  description?: string
  /** adapter = 适配器插件。 */
  kind?: 'plugin' | 'adapter'
  /** 允许多份配置（适配器默认 true）。 */
  reusable?: boolean
  reloadOnConfig?: boolean
  config?: unknown
  Config?: unknown
  apply(ctx: Ctx, config: C): unknown
}

interface SchemaField<T> {
  default(value: T): this
  description(value: string): this
  min(value: number): this
  max(value: number): this
  role(value: string): this
  required(value?: boolean): this
  hidden(value?: boolean): this
  deprecated(value?: boolean): this
  experimental(value?: boolean): this
  readonly kind: string
  defaults(): Record<string, unknown>
  validate(value: unknown): { ok: boolean; value?: T; error?: string }
}

export declare const h: ElementFactory
export declare const Schema: SchemaFactory

export interface SchemaFactory {
    string(): SchemaField<string>
    boolean(): SchemaField<boolean>
    number(): SchemaField<number>
    natural(): SchemaField<number>
    percent(): SchemaField<number>
    union<T>(values: readonly T[]): SchemaField<T>
    array<T>(item: SchemaField<T>): SchemaField<T[]>
    object(shape: Record<string, SchemaField<unknown>>): SchemaField<Record<string, unknown>>
}

declare global {
  const Schema: SchemaFactory
  /** 宿主注入的消息元素工厂，和 Koishi 一样不用 import。 */
  const h: ElementFactory
}
