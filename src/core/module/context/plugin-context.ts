import type { HttpMethod, RouteOptions } from '../kernel/routes.ts'
// 模块拿到的 ctx：只有 v2 能力，没有 v1 的 setup(api) 字段。

import type { AdapterHandle, AdapterSpec } from '../../../types/adapter/adapter.ts'
import type { BotsAccessor, BotLike } from '../../../types/adapter/bot.ts'
import type {
  BotAccessor,
  BroadcastResult,
  CommandArg,
  CommandBuilder,
  LlmFacade,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  TtsFacade,
  ThinkOptions,
  ChatLogFacade,
  HttpHelpers,
  TextHelpers,
} from '../../../types/plugin/ctx.ts'
import type { Middleware, MiddlewareOptions, SessionFilter } from '../../../types/plugin/pipeline.ts'
import type { Target } from '../../../types/core/target.ts'
import { findBot } from '../../bot/instance/registry.ts'

export type {
  LlmFacade,
  LlmSummaryOptions,
  LlmTextOptions,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  TtsFacade,
} from '../../../types/plugin/ctx.ts'

/** 内核内部的注册器；插件作者看不到这个对象，只看到它投出来的 ctx。 */
interface KernelApi {
  assertActive?: () => void
  id: string
  instanceId?: string
  version: string
  apiVersion: number
  dir?: string
  log: PluginContext['logger']
  core: Record<string, any>
  dsh: Record<string, any>
  settings: () => Record<string, any>
  saveSettings: (patch: any) => Record<string, any>
  setConfig: (patch: any) => unknown
  config: () => Record<string, any>
  use: (id: string) => Record<string, any> | null
  lazy: (id: string) => Record<string, any>
  has: (id: string) => boolean
  isOwner: PluginContext['isOwner']
  defineTool: (spec: any) => any
  tool: (builder: any) => () => void
  on: (event: string, fn: (...args: any[]) => unknown) => () => void
  emit: (event: string, ...args: any[]) => void
  every: (ms: number, fn: () => unknown, label?: string) => () => void
  later: (ms: number, fn: () => unknown) => () => void
  onDispose: (fn: () => unknown) => () => void
  context: (fn: (args: any) => unknown) => () => void
  rule: (fn: any) => () => void
  dataDir: (...parts: string[]) => string
  sendText: (chatId: string, text: string, opts?: any) => Promise<any>
  sendImage: (chatId: string, src: unknown) => Promise<any>
  sendFile: (chatId: string, file: unknown, name?: string) => Promise<any>
  sendVoiceFile: (chatId: string, file: unknown, note?: string) => Promise<any>
  reply: (msg: any, text: string) => Promise<any>
  proactive: PluginContext['proactive']
  ask: (options: any) => Promise<any>
  think: (prompt: string, options?: ThinkOptions) => Promise<string>
  thinkCooldown: (key?: string) => { retryAt: number; message?: string } | null
  chatLog: ChatLogFacade
  http: HttpHelpers
  media: PluginContext['media']
  turnFromOwner: (sessionId: string) => boolean
  text: TextHelpers
  route: (path: string, handler: (req: any, res: any) => unknown, options: RouteOptions) => () => void
}

export function createPluginContext(api: KernelApi, extras: PluginContextExtras = {}): PluginContext {
  const ctx = {} as PluginContext
  const value = (key: string, v: unknown) => Object.defineProperty(ctx, key, { enumerable: true, configurable: true, writable: true, value: v })
  const getter = (key: string, get: () => unknown) => Object.defineProperty(ctx, key, { enumerable: true, configurable: true, get })

  value('id', api.id)
  value('instanceId', api.instanceId ?? api.id)
  value('version', api.version)
  value('apiVersion', api.apiVersion)
  value('baseDir', api.dir || '')
  // 本插件自己的配置：live 视图，面板存完立刻读到新值
  getter('config', () => api.settings())
  // 全局配置：ctx.root.config 直接读，ctx.root.read() 是函数形态（给回调用）
  const readRoot = () => (extras.rootConfig ? extras.rootConfig() : api.config())
  const root = {}
  Object.defineProperty(root, 'config', { enumerable: true, get: readRoot })
  value('root', root)
  Object.defineProperty(root, 'read', { enumerable: false, value: readRoot })
  Object.defineProperty(root, 'update', { enumerable: false, value: (patch: any) => api.setConfig(patch) })

  value('updateConfig', (patch: any) => api.saveSettings(typeof patch === 'function' ? patch(api.settings()) : patch))
  value('logger', api.log)
  value('host', api.core)
  value('harness', api.dsh)

  const services = extras.services
  value('get', (id: string) => (services?.get(id) as any) ?? (api.use(id) as any))
  const lazyService = (id: string) => new Proxy({}, {
    get: (_t, key) => {
      const impl: any = (services?.get(id) as any) ?? (api.use(id) as any)
      const v = impl?.[key]
      return typeof v === 'function' ? v.bind(impl) : v
    },
    has: (_t, key) => Boolean(((services?.get(id) as any) ?? (api.use(id) as any)) && key in ((services?.get(id) as any) ?? (api.use(id) as any))),
  })
  value('provide', (name: string, impl: any) => {
    if (!services) return () => {}
    api.assertActive?.()
    const off = services.provide(name, impl, api.instanceId ?? api.id)
    api.onDispose(off)
    return off
  })
  value('require', (name: string) => {
    if (!services) throw new Error('宿主没有提供服务表')
    return services.require(name)
  })
  value('services', {
    get: (name: string) => services?.get(name) ?? null,
    has: (name: string) => Boolean(services?.has(name)),
    require: (name: string) => {
      if (!services) throw new Error('宿主没有提供服务表')
      return services.require(name)
    },
    names: () => services?.names() ?? [],
  })
  value('has', (id: string) => api.has(id))
  value('isOwner', api.isOwner)
  value('lazy', (id: string) => lazyService(id))
  getter('voice', () => services?.get('voice') ?? null)
  getter('sing', () => services?.get('sing') ?? null)
  getter('database', () => services?.get('database') ?? null)
  getter('ffmpeg', () => services?.get('ffmpeg') ?? null)
  value('defineTool', (spec: any) => api.defineTool(spec))
  value('prompt', (fn: any) => api.context(fn))
  value('rule', (fn: any) => api.rule(fn))

  value('sendTo', (chatId: string, content: any, options?: any) => api.sendText(chatId, String(content ?? ''), options))
  value('sendImage', (chatId: string, src: any) => api.sendImage(chatId, src))
  value('sendFile', (chatId: string, file: any, name?: string) => api.sendFile(chatId, file, name))
  value('sendVoiceFile', (chatId: string, file: any, note?: string) => api.sendVoiceFile(chatId, file, note))
  value('reply', (msg: any, content: any) => api.reply(msg, String(content ?? '')))
  value('proactive', api.proactive)
  value('ask', (options: any) => api.ask(options))
  value('think', (prompt: string, options?: ThinkOptions) => api.think(prompt, options).then((out: unknown) => String(out ?? '')))
  value('thinkCooldown', (key?: string) => api.thinkCooldown(key))
  value('chatLog', api.chatLog)
  value('http', api.http)
  value('media', api.media)
  value('turnFromOwner', (sessionId: string) => api.turnFromOwner(sessionId))
  value('text', api.text)
  value('dataDir', (...parts: string[]) => api.dataDir(...parts))

  // 定时器随模块卸载自动回收（Cordis 的 effect 语义），不要用裸 setInterval
  value('setInterval', (ms: number, fn: () => unknown, label?: string) => api.every(ms, fn, label))
  value('setTimeout', (ms: number, fn: () => unknown) => api.later(ms, fn))

  // effect：接函数或带 dispose 的对象，统一挂到模块的 dispose 队列
  value('effect', (fn: any) => {
    if (typeof fn === 'function') return api.onDispose(fn)
    const disposable = fn as { dispose?: () => unknown } | null
    return api.onDispose(() => disposable?.dispose?.())
  })

  // on('dispose') 归到卸载队列，其它事件照旧
  value('on', (event: string, fn: (...args: any[]) => unknown) => (event === 'dispose' ? api.onDispose(fn) : api.on(event, fn)))

  if (extras.bots) value('bots', extras.bots)
  value('bot', makeBotAccessor(extras.bots, extras.bot))
  value('emit', (event: string, ...args: any[]) => { api.emit(event, ...args) })
  if (extras.Schema) value('Schema', extras.Schema)
  if (extras.h) value('h', extras.h)
  getter('llm', () => services?.get('llm') ?? extras.llm ?? services?.require('llm'))
  if (extras.tts) value('tts', extras.tts)
  if (extras.nativePreview) value('nativePreview', extras.nativePreview)

  value('adapter', async (spec: AdapterSpec, config?: unknown) => {
    if (!extras.startAdapter) throw new Error('宿主没有提供适配器注册表')
    const controller = new AbortController()
    let handle: AdapterHandle | undefined
    api.onDispose(() => {
      controller.abort()
      return handle?.dispose()
    })
    controller.signal.throwIfAborted()
    handle = await extras.startAdapter(spec, config, controller.signal)
    if (controller.signal.aborted) {
      await handle.dispose()
      controller.signal.throwIfAborted()
    }
    return handle
  })

  // S5：管线三段。注册即绑定到本模块的卸载队列——模块关了，中间件/指令一起没。
  const pipeline = extras.pipeline
  value('middleware', (fn: Middleware, options?: MiddlewareOptions) => {
    if (!pipeline) return () => {}
    const off = pipeline.use(fn, options)
    api.onDispose(off)
    return off
  })
  const registerCommand = (signature: string, handler: (...args: any[]) => unknown, filter?: SessionFilter) => {
    if (!pipeline) return () => {}
    // 官方插件必须显式打开 registerCommands（默认 false）；社区插件不声明就照常注册。
    if (api.settings().registerCommands === false) return () => {}
    const parsed = parseSignature(signature)
    const off = pipeline.command(parsed.name, handler as any, filter ? { filter } : undefined)
    api.onDispose(off)
    return off
  }
  const commandBuilder = (signature: string, filter?: SessionFilter): CommandBuilder => {
    const parsed = parseSignature(signature)
    const meta = { description: '', usage: '', alias: [] as string[] }
    let dispose: (() => void) | null = null
    const builder: CommandBuilder = {
      description(text) { meta.description = String(text || ''); return builder },
      usage(text) { meta.usage = String(text || ''); return builder },
      alias(...names) { meta.alias.push(...names.map(String)); return builder },
      action(fn) {
        dispose = registerCommand(signature, (session: any, raw: string, command: string) => {
          const values = parseValues(parsed.args, String(raw ?? ''))
          return (fn as any)({ session, command, args: String(raw ?? ''), options: {} }, ...values)
        }, filter)
        return dispose
      },
      dispose() { dispose?.(); dispose = null },
    }
    return builder
  }
  value('command', ((signature: unknown, handler?: (...args: any[]) => unknown, filter?: SessionFilter) => {
    if (typeof signature !== 'string') {
      throw new TypeError('ctx.command 只接受字符串签名，例如 ctx.command("weather <city:string>")；v1 的对象写法已删除')
    }
    const text = String(signature ?? '').trim()
    if (!text) return () => {}
    if (typeof handler === 'function') return registerCommand(text, handler, filter)
    return commandBuilder(text, filter)
  }) as PluginContext['command'])

  value('tool', (builder: unknown) => api.tool(builder))

  const registerRoute = (
    method: HttpMethod,
    path: string,
    handler: (req: any, res: any) => unknown,
    options: { access?: 'panel' | null } = {},
  ) => {
    const access = options.access === undefined ? 'panel' : options.access
    return api.route(path, handler, { method, access })
  }
  value('server', {
    get: (path: string, handler: any, options?: any) => registerRoute('GET', path, handler, options),
    post: (path: string, handler: any, options?: any) => registerRoute('POST', path, handler, options),
    put: (path: string, handler: any, options?: any) => registerRoute('PUT', path, handler, options),
    patch: (path: string, handler: any, options?: any) => registerRoute('PATCH', path, handler, options),
    delete: (path: string, handler: any, options?: any) => registerRoute('DELETE', path, handler, options),
  })
  // 页面注册：先统一进宿主的页面表，侧栏按这份表渲染。
  value('page', (page: any) => {
    if (!extras.registerPage) return () => {}
    return extras.registerPage(page)
  })

  return installScopes(ctx, api.assertActive)
}

/** 会话形状的判断只认这几个字段：平台、类型、群/频道号。 */
interface SessionFace {
  platform: string
  type: string
  channelId: string
  guildId?: string
}

function sessionOfEvent(value: unknown): SessionFace | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, any>
  const session = candidate.session && typeof candidate.session === 'object' ? candidate.session : candidate
  if (typeof session.platform === 'string' && typeof session.type === 'string') return session as SessionFace
  if (typeof session.type === 'string') return faceOf(session)
  return null
}

/**
 * 把「会话」压成过滤器要看的几个字段。
 *
 * 真实 `Session` 有 `platform` getter，但管线里的轻量会话只有 `bot.platform`，
 * 两边都要认——不然作用域过滤器在测试桩和定时任务上会静默失效。
 */
function faceOf(value: any): SessionFace {
  return {
    platform: String(value?.platform ?? value?.bot?.platform ?? ''),
    type: String(value?.type ?? ''),
    channelId: String(value?.channelId ?? ''),
    guildId: value?.guildId,
  }
}

/** `ctx.bot()`：不传 id 取第一个上线的；传 id 精确取。 */
function makeBotAccessor(bots?: BotsAccessor, fallback?: BotLike): BotAccessor {
  const list = (): BotLike[] => (bots ? bots.list() : fallback ? [fallback] : [])
  const accessor = ((id?: string, platform?: string) => {
    const all = platform === undefined ? list() : list().filter(bot => bot.platform === platform)
    if (id === undefined || id === null || id === '') {
      return all.find((bot) => bot.status === 'online') ?? all[0]
    }
    return findBot(all, String(id))
  }) as BotAccessor
  Object.defineProperty(accessor, 'list', { value: list })
  return accessor
}

/** 只保留满足条件的机器人；取法（下标 / 调用 / list）保持一致。 */
function filterBots(source: BotsAccessor, keep: (bot: BotLike) => boolean): BotsAccessor {
  const list = (): BotLike[] => source.list().filter(keep)
  const lookup = (id: string, platform?: string) => findBot(list(), String(id), platform)
  const accessor = lookup as BotsAccessor
  Object.defineProperties(accessor, {
    get: { value: lookup },
    list: { value: list },
  })
  return new Proxy(accessor, {
    get(target, prop, receiver) {
      if (prop === 'length') return list().length
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return list()[Number(prop)]
      if (prop === Symbol.iterator) return list()[Symbol.iterator].bind(list())
      return Reflect.get(target, prop, receiver)
    },
  }) as BotsAccessor
}

async function broadcast(
  ctx: PluginContext,
  targets: Target[],
  content: unknown,
  options: { timeoutMs?: number } = {},
  assertActive?: () => void,
): Promise<BroadcastResult[]> {
  const results: BroadcastResult[] = []
  for (const target of Array.isArray(targets) ? targets : []) {
    assertActive?.()
    const bot = ctx.bots?.get(target.botId, target.platform)
    if (!bot) {
      results.push({ target, ok: false, error: `没有可用的「${target.platform}」机器人` })
      continue
    }
    try {
      const sendOptions = options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined
      if (target.type === 'private') await bot.sendPrivateMessage(target.id, content, sendOptions)
      else await bot.sendMessage(target.id, content, sendOptions)
      results.push({ target, ok: true })
    } catch (error) {
      results.push({ target, ok: false, error: messageOf(error) })
    }
  }
  return results
}

function messageOf(error: unknown): string {
  return String((error as { message?: string })?.message ?? error).slice(0, 300)
}

interface ScopeRules {
  session: (session: SessionFace) => boolean
  platform: (name: string) => boolean
}

const ROOT_RULES: ScopeRules = { session: () => true, platform: () => true }

/** 给 ctx 装上 `platform() / guild() / private()`：每次调用返回一层更窄的视图。 */
function installScopes(ctx: PluginContext, assertActive?: () => void): PluginContext {
  const scoped = (rules: ScopeRules): PluginContext => {
    // 用属性描述符复制，不走 spread：`root` 是取值器，spread 会把它固化成快照
    const view = Object.create(
      Object.getPrototypeOf(ctx),
      Object.getOwnPropertyDescriptors(ctx),
    ) as PluginContext

    view.middleware = (fn, options) =>
      ctx.middleware((session, next) => (rules.session(faceOf(session)) ? fn(session, next) : next()), options)

    // 指令：过滤交给管线。不匹配时这条消息不算指令，会继续往下走到中间件与模型。
    view.command = ((signature: unknown, handler?: (...args: any[]) => unknown) => {
      const filter = (session: unknown) => rules.session(faceOf(session))
      const base = ctx.command as (...args: any[]) => any
      if (typeof handler === 'function') return base(signature, handler, filter)
      const builder = base(signature, undefined, filter)
      return builder
    }) as PluginContext['command']

    view.on = (event, fn) => {
      if (event === 'dispose') return ctx.on(event, fn)
      return ctx.on(event, (...args: any[]) => {
        const session = sessionOfEvent(args[0])
        if (session && !rules.session(session)) return undefined
        return (fn as (...a: any[]) => unknown)(...args)
      })
    }

    if (ctx.bots) view.bots = filterBots(ctx.bots, (bot) => rules.platform(bot.platform))
    const fallback = view.bots ? undefined : ctx.bot?.()
    view.bot = makeBotAccessor(view.bots, fallback && rules.platform(fallback.platform) ? fallback : undefined)
    view.broadcast = (targets, content, options) => broadcast(view, targets, content, options, assertActive)

    view.platform = (name: string) => scoped({
      session: (session) => rules.session(session) && session.platform === String(name),
      platform: (value) => rules.platform(value) && value === String(name),
    })
    view.guild = (id?: string) => scoped({
      session: (session) =>
        rules.session(session) &&
        (session.type === 'group' || session.type === 'channel') &&
        (!id || session.guildId === String(id) || session.channelId === String(id)),
      platform: rules.platform,
    })
    view.private = () => scoped({
      session: (session) => rules.session(session) && session.type === 'private',
      platform: rules.platform,
    })

    return view
  }

  return scoped(ROOT_RULES)
}

/**
 * 解析指令签名：`'hello <text:string> [times:number]'`
 * - 第一个词是指令名
 * - `<…>` 必填，`[…]` 可选，`名字:类型` 里类型不写就是 string，`text` 表示「吃掉后面整段」
 */
export function parseSignature(signature: string): { name: string; args: CommandArg[] } {
  const text = String(signature || '').trim()
  const match = text.match(/^(\S+)\s*([\s\S]*)$/)
  const name = match?.[1] || text
  const rest = match?.[2] || ''
  const args: CommandArg[] = []
  const token = /<([^>]+)>|\[([^\]]+)\]/g
  let hit: RegExpExecArray | null
  while ((hit = token.exec(rest))) {
    const body = String(hit[1] ?? hit[2] ?? '').trim()
    if (!body) continue
    const [argName, argType] = body.split(':')
    args.push({ name: argName.trim(), type: String(argType || 'string').trim(), required: Boolean(hit[1]) })
  }
  return { name, args }
}

/** 按签名把参数原文切开：text 类型吃掉剩下全部，其它按空白切；number 转数字。 */
export function parseValues(args: CommandArg[], raw: string): any[] {
  if (!args.length) return []
  const out: any[] = []
  let rest = String(raw ?? '').trim()
  for (const arg of args) {
    if (!rest) {
      out.push(undefined)
      continue
    }
    if (arg.type === 'text') {
      out.push(rest)
      rest = ''
      continue
    }
    const match = rest.match(/^(\S+)\s*([\s\S]*)$/)
    const value = match?.[1] ?? ''
    rest = String(match?.[2] ?? '').trim()
    out.push(arg.type === 'number' ? (value === '' ? undefined : Number(value)) : value)
  }
  return out
}
