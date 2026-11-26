// 模块拿到的 ctx：v1 的 api 原样保留（老插件零改动），再补 v2 的别名。
// 规则：v1 里已有同名能力的，只做转发，不改语义；v1 没有的才新增。

import type { AdapterHandle, AdapterSpec } from '../../../types/adapter/adapter.ts'
import type { BotsAccessor, BotLike } from '../../../types/adapter/bot.ts'
import type {
  ApiLike,
  BotAccessor,
  BroadcastResult,
  CommandArg,
  CommandBuilder,
  LlmFacade,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  TtsFacade,
} from '../../../types/plugin/ctx.ts'
import type { Middleware, MiddlewareOptions, SessionFilter } from '../../../types/plugin/pipeline.ts'
import type { Target } from '../../../types/core/target.ts'

export type {
  ApiLike,
  LlmFacade,
  LlmSummaryOptions,
  LlmTextOptions,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  TtsFacade,
} from '../../../types/plugin/ctx.ts'

export function createPluginContext(api: ApiLike, extras: PluginContextExtras = {}): PluginContext {
  const ctx = { ...api } as PluginContext

  // 定时器随模块卸载自动回收（Cordis 的 effect 语义），不要用裸 setInterval
  ctx.setInterval = (ms, fn, label) => api.every?.(ms, fn, label) ?? (() => {})
  ctx.setTimeout = (ms, fn) => api.later?.(ms, fn) ?? (() => {})

  // effect：接函数或带 dispose 的对象，统一挂到模块的 dispose 队列
  ctx.effect = (fn) => {
    if (typeof fn === 'function') return api.onDispose?.(fn as () => unknown) ?? (() => {})
    const disposable = fn as { dispose?: () => unknown } | null
    return api.onDispose?.(() => disposable?.dispose?.()) ?? (() => {})
  }

  // on('dispose') 归到卸载队列，其它事件照旧
  ctx.on = (event, fn) => (event === 'dispose' ? ctx.effect(fn) : (api.on?.(event, fn) ?? (() => {})))

  if (extras.bots) ctx.bots = extras.bots
  ctx.bot = makeBotAccessor(extras.bots, extras.bot)
  ctx.broadcast = (targets, content, options) => broadcast(ctx, targets, content, options)
  ctx.emit = (event, ...args) => { api.emit?.(event, ...args) }
  // 全局配置是活的：模块卸载/重装、面板改设置之后读到的必须是最新值
  Object.defineProperty(ctx, 'root', {
    enumerable: true,
    configurable: true,
    get: () => ({ config: extras.rootConfig?.() ?? {} }),
  })
  if (extras.Schema) ctx.Schema = extras.Schema
  if (extras.h) ctx.h = extras.h
  if (extras.llm) ctx.llm = extras.llm
  if (extras.tts) ctx.tts = extras.tts

  ctx.adapter = async (spec, config) => {
    if (!extras.startAdapter) throw new Error('宿主没有提供适配器注册表')
    const handle = await extras.startAdapter(spec, config)
    // 模块卸载 = 适配器下线，顺序和 koishi 一样：先断连，再摘 bots，再发 offline
    api.onDispose?.(() => handle.dispose())
    return handle
  }

  // S5：管线三段。注册即绑定到本模块的卸载队列——模块关了，中间件/指令一起没。
  const pipeline = extras.pipeline
  ctx.middleware = (fn, options) => {
    if (!pipeline) return () => {}
    const off = pipeline.use(fn, options)
    const dispose = api.onDispose?.(off)
    return () => { off(); dispose?.() }
  }
  /** 注册一条指令，返回卸载函数；模块卸载时宿主也会一起撤。 */
  const registerCommand = (signature: string, handler: (...args: any[]) => unknown, filter?: SessionFilter) => {
    if (!pipeline) return () => {}
    const parsed = parseSignature(signature)
    const off = pipeline.command(parsed.name, handler as any, filter ? { filter } : undefined)
    const dispose = api.onDispose?.(off)
    return () => { off(); dispose?.() }
  }

  /** `ctx.command('名字 <参数>')` 的链式写法：最后 .action() 才真正注册。 */
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

  ctx.command = ((signature: unknown, handler?: (...args: any[]) => unknown, filter?: SessionFilter) => {
    // v1 兼容：api.command({ name, run }) 注册的是「给 AI 调用的命令」，不是本地指令
    if (signature && typeof signature === 'object') return (api.command as any)?.(signature) ?? (() => {})
    const text = String(signature ?? '').trim()
    if (!text) return () => {}
    // 老写法：整段参数原样交给回调
    if (typeof handler === 'function') return registerCommand(text, handler, filter)
    return commandBuilder(text, filter)
  }) as PluginContext['command']

  /**
   * 工具注册。三种写法都认：
   * - `ctx.tool(fn)`：v1 的工厂函数
   * - `ctx.tool({ name, description, parameters, execute })`：Koishi 那种 JSON Schema 写法，转成 defineTool
   * - 已经做好、带 output 的工具：原样收下
   */
  ctx.tool = (builder) => {
    const define = (api as any).defineTool
    const raw = builder as any
    let tool: any = builder
    if (raw && typeof raw === 'object' && typeof raw.execute === 'function' && typeof raw.name === 'string' && !raw.output) {
      const params = raw.parameters && typeof raw.parameters === 'object' ? raw.parameters : {}
      if (typeof define === 'function') {
        tool = define({
          name: raw.name,
          description: raw.description || '',
          properties: params.properties || {},
          required: params.required || [],
          execute: raw.execute,
        })
      }
    }
    return (api.tool as any)?.(tool) ?? (() => {})
  }

  /** 面板接口：默认带 access: 'panel'，和宿主的管理面同一套闸。 */
  const registerRoute = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    handler: (req: any, res: any) => unknown,
    options: { access?: 'panel' | null } = {},
  ) => {
    const route = (api as any).route
    if (typeof route !== 'function') return () => {}
    const access = options.access === undefined ? 'panel' : options.access
    return route(path, (req: any, res: any) => {
      const actual = String(req?.method || 'GET').toUpperCase()
      if (actual !== method) return { ok: false, code: 'METHOD_NOT_ALLOWED', message: `这个接口只接受 ${method}` }
      return handler(req, res)
    }, access === null ? {} : { access })
  }
  ctx.server = {
    get: (path, handler, options) => registerRoute('GET', path, handler, options),
    post: (path, handler, options) => registerRoute('POST', path, handler, options),
    put: (path, handler, options) => registerRoute('PUT', path, handler, options),
    patch: (path, handler, options) => registerRoute('PATCH', path, handler, options),
    delete: (path, handler, options) => registerRoute('DELETE', path, handler, options),
  }

  // 写惯 Koishi 的会顺手写 ctx.logger，给它一个别名
  ctx.logger = (api.log || api.logger) as PluginContext['logger']
  // 管线末段（llm）由宿主独占：插件要抢在模型前处理，用
  // ctx.middleware(fn, { before: 'llm' })，不要替换模型入口。

  // 作用域视图（ctx.platform / guild / private）挂在这一层：
  // 注册仍然落到当前模块的卸载队列，只是多了一层「这条会话归不归我管」的判断。
  return installScopes(ctx)
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
  const accessor = ((id?: string) => {
    const all = list()
    if (id === undefined || id === null || id === '') {
      return all.find((bot) => bot.status === 'online') ?? all[0]
    }
    return all.find((bot) => bot.id === String(id))
  }) as BotAccessor
  Object.defineProperty(accessor, 'list', { value: list })
  return accessor
}

/** 只保留满足条件的机器人；取法（下标 / 调用 / list）保持一致。 */
function filterBots(source: BotsAccessor, keep: (bot: BotLike) => boolean): BotsAccessor {
  const list = (): BotLike[] => source.list().filter(keep)
  const accessor = ((id: string) => list().find((bot) => bot.id === String(id))) as BotsAccessor
  Object.defineProperties(accessor, {
    get: { value: (id: string) => list().find((bot) => bot.id === String(id)) },
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
): Promise<BroadcastResult[]> {
  const all = ctx.bots ? ctx.bots.list() : []
  const results: BroadcastResult[] = []
  for (const target of Array.isArray(targets) ? targets : []) {
    const bot =
      all.find((item) => item.id === target.botId) ??
      all.find((item) => item.platform === target.platform && item.status === 'online') ??
      all.find((item) => item.platform === target.platform)
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
function installScopes(ctx: PluginContext): PluginContext {
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
    if (ctx.bot) {
      const source = ctx.bot
      const narrowed = ((id?: string) => {
        const bot = source(id)
        return bot && rules.platform(bot.platform) ? bot : undefined
      }) as BotAccessor
      Object.defineProperty(narrowed, 'list', { value: () => source.list().filter((bot) => rules.platform(bot.platform)) })
      view.bot = narrowed
    }

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
