// 模块拿到的 ctx：v1 的 api 原样保留（老插件零改动），再补 v2 的别名。
// 规则：v1 里已有同名能力的，只做转发，不改语义；v1 没有的才新增。

import type { AdapterHandle, AdapterSpec } from '../types/adapter.ts'
import type { BotsAccessor, BotLike } from '../types/bot.ts'
import type { ApiLike, LlmFacade, PipelineLike, PluginContext, PluginContextExtras, TtsFacade } from '../types/ctx.ts'
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
  ctx.command = ((name: unknown, handler?: (...args: any[]) => unknown) => {
    // v1 兼容：api.command({ name, run }) 注册的是「给 AI 调用的命令」，不是本地指令
    if (name && typeof name === 'object') return (api.command as any)?.(name) ?? (() => {})
    if (!pipeline) return () => {}
    const off = pipeline.command(String(name), handler as any)
    const dispose = api.onDispose?.(off)
    return () => { off(); dispose?.() }
  }) as PluginContext['command']
  ctx.tool = (builder) => (api.tool as any)?.(builder) ?? (() => {})
  // 管线末段（llm）由宿主独占：插件要抢在模型前处理，用
  // ctx.middleware(fn, { before: 'llm' })，不要替换模型入口。

  return ctx
}
