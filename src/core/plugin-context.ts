// 模块拿到的 ctx：v1 的 api 原样保留（老插件零改动），再补 v2 的别名。
// 规则：v1 里已有同名能力的，只做转发，不改语义；v1 没有的才新增。

import type { AdapterHandle, AdapterSpec } from '../types/adapter.ts'
import type { BotsAccessor, BotLike } from '../types/bot.ts'
import type { ApiLike, CommandArg, CommandBuilder, LlmFacade, PipelineLike, PluginContext, PluginContextExtras, TtsFacade } from '../types/ctx.ts'
import type { Middleware, MiddlewareOptions } from '../types/pipeline.ts'

export type {
  ApiLike,
  LlmFacade,
  LlmSummaryOptions,
  LlmTextOptions,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  TtsFacade,
} from '../types/ctx.ts'

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
  if (extras.bot) ctx.bot = extras.bot
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
  const registerCommand = (signature: string, handler: (...args: any[]) => unknown) => {
    if (!pipeline) return () => {}
    const parsed = parseSignature(signature)
    const off = pipeline.command(parsed.name, handler as any)
    const dispose = api.onDispose?.(off)
    return () => { off(); dispose?.() }
  }

  /** `ctx.command('名字 <参数>')` 的链式写法：最后 .action() 才真正注册。 */
  const commandBuilder = (signature: string): CommandBuilder => {
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
        })
        return dispose
      },
      dispose() { dispose?.(); dispose = null },
    }
    return builder
  }

  ctx.command = ((signature: unknown, handler?: (...args: any[]) => unknown) => {
    // v1 兼容：api.command({ name, run }) 注册的是「给 AI 调用的命令」，不是本地指令
    if (signature && typeof signature === 'object') return (api.command as any)?.(signature) ?? (() => {})
    const text = String(signature ?? '').trim()
    if (!text) return () => {}
    // 老写法：整段参数原样交给回调
    if (typeof handler === 'function') return registerCommand(text, handler)
    return commandBuilder(text)
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

  return ctx
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
