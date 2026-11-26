import type { AdapterHandle, AdapterInfo, AdapterRuntime, AdapterSpec, InboundMessage } from '../../../types/adapter/adapter.ts'
import type { BotLike } from '../../../types/adapter/bot.ts'
import { startAdapter } from './contract.ts'
import type { BotRegistry } from '../instance/registry.ts'
import { botKey, findBot } from '../instance/registry.ts'

export interface AdapterRegistryDeps {
  bots: BotRegistry
  log: (message: string) => void
  /** 适配器投递入站消息：宿主建 Session 跑管线。 */
  onMessage?: (bot: BotLike, message: InboundMessage) => void
  /** 适配器的非消息事件（加群、撤回……）。 */
  onEvent?: (platform: string, event: string, payload: unknown, bot: BotLike) => void
  /** 宿主统一包装 bot 的发送方法。 */
  wrapBot?: (bot: BotLike, spec: AdapterSpec) => BotLike
  /** 文字转语音，给 `<voice>要念的话</voice>` 用。 */
  speak?: (text: string) => Promise<string>
}

interface Entry {
  instance?: string
  platform: string
  name: string
  bot: BotLike
  startedAt: number
  handle: AdapterHandle
}

export class AdapterRegistry {
  private readonly deps: AdapterRegistryDeps
  private readonly entries = new Map<string, Entry>()
  private readonly connecting = new Map<symbol, { instance: string; platform: string; signal: AbortSignal }>()
  private readonly failures = new Map<string, { instance: string; platform: string; id: string; selfId: string; status: string }>()
  private lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()

  constructor(deps: AdapterRegistryDeps) {
    this.deps = deps
  }

  /** 插件入口：`ctx.adapter(spec, config)` 最终走这里。 */
  async start(spec: AdapterSpec, config?: unknown, owner?: AbortSignal, instance?: string): Promise<AdapterHandle> {
    // 平台名可能是运行期才知道的（Satori 这种协议层适配器）
    const resolved = spec?.resolvePlatform?.(config)
    const platform = String(resolved || spec?.platform || '').trim()
    if (!platform) throw new Error('适配器要声明 platform')

    const signal = owner ? AbortSignal.any([owner, this.lifetime.signal]) : this.lifetime.signal
    signal.throwIfAborted()
    const pending: Array<(bot: BotLike) => void> = []
    let entry: Entry | undefined
    let closed = false
    const deliver = (action: (bot: BotLike) => void) => {
      if (closed || signal.aborted) return
      if (!entry) {
        if (pending.length < 100) pending.push(action)
        return
      }
      if (this.entries.get(botKey(platform, entry.bot.id)) === entry) action(entry.bot)
    }
    const runtime: AdapterRuntime = {
      signal,
      platform,
      log: this.deps.log,
      speak: this.deps.speak,
      supports: capability => entry?.bot.supports(capability) ?? false,
      emitMessage: message => deliver(bot => this.deps.onMessage?.(bot, message)),
      emitEvent: (event, payload) => deliver(bot => this.deps.onEvent?.(platform, event, payload, bot)),
    }
    const attempt = Symbol()
    if (instance) {
      this.failures.delete(instance)
      this.connecting.set(attempt, { instance, platform, signal })
    }
    const connection = await startAdapter(this.deps.bots, spec, config, runtime, {
      platform, wrapBot: this.deps.wrapBot,
      active: () => !signal.aborted,
      statusChanged: () => { if (entry) this.changed() },
    }).catch(error => {
      if (instance && !signal.aborted) {
        const failure = { instance, platform, id: '', selfId: '', status: 'error' }
        this.failures.set(instance, failure)
        signal.addEventListener('abort', () => {
          if (this.failures.get(instance) === failure) this.failures.delete(instance)
        }, { once: true })
      }
      throw error
    }).finally(() => this.connecting.delete(attempt))
    const bot = connection.bot
    if (signal.aborted) {
      await connection.dispose()
      throw new Error(`适配器 ${platform} 已停止`)
    }
    const key = botKey(platform, bot.id)
    const previous = this.entries.get(key)
    const handle: AdapterHandle = {
      bot,
      dispose: async () => {
        if (closed) return
        closed = true
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
          this.changed()
        }
        await connection.dispose()
      },
    }
    entry = { platform, bot, instance, handle, name: spec.name || platform, startedAt: Date.now() }
    this.entries.set(key, entry)
    this.changed()
    try {
      for (const action of pending.splice(0)) deliver(action)
    } catch (error) {
      await handle.dispose()
      throw error
    } finally {
      await previous?.handle?.dispose()
    }
    return handle
  }

  /** 面板用：只读快照，字段都转成字符串，免得前端拿到 undefined。 */
  list(): AdapterInfo[] {
    return [...this.entries.values()].map((entry) => ({
      platform: entry.platform,
      name: entry.name,
      id: entry.bot.id,
      selfId: String(entry.bot.selfId || ''),
      status: entry.bot.status,
    }))
  }

  connections() {
    const online = [...this.entries.values()].map(({ instance, platform, bot }) => ({
      instance: instance || '', platform, id: bot.id, selfId: bot.selfId, status: bot.status,
    }))
    const pending = [...this.connecting.values()].filter(row => !row.signal.aborted).map(({ instance, platform }) => ({
      instance, platform, id: '', selfId: '', status: 'connecting',
    }))
    return [...online, ...pending, ...this.failures.values()]
  }

  get(id: string, platform?: string): BotLike | undefined {
    if (platform !== undefined) return this.entries.get(botKey(platform, id))?.bot
    return findBot(Array.from(this.entries.values(), entry => entry.bot), id)
  }

  /** 有增删 / 状态可能变化时通知（面板轮询之外的第二条路）。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async stopAll(): Promise<void> {
    this.lifetime.abort()
    this.lifetime = new AbortController()
    const handles = [...this.entries.values()].map(entry => entry.handle)
    for (const handle of handles) await handle.dispose().catch(() => {})
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 一个监听器抛错不影响别的
      }
    }
  }
}
