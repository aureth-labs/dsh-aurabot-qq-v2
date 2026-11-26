// 适配器注册表：面板「机器人列表」的数据源，也是 `ctx.adapter()` 的落地处。
//
// 和 BotRegistry 的分工：
// - BotRegistry 只管「现在哪些 bot 在线」（发送时用）
// - 这里多记一层「这个 bot 是哪个平台、谁拉起来的、什么时候上线的」，给面板用
//
// 内置 QQ 不是插件拉起来的，用 `adopt()` 挂进来；插件走 `start()`。

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
  onEvent?: (platform: string, event: string, payload: unknown) => void
  /** 宿主统一包装 bot 的发送方法。 */
  wrapBot?: (bot: BotLike, spec: AdapterSpec) => BotLike
  /** 文字转语音，给 `<voice>要念的话</voice>` 用。 */
  speak?: (text: string) => Promise<string>
}

interface Entry {
  platform: string
  name: string
  bot: BotLike
  startedAt: number
  /** 插件拉起来的才有 handle；内置适配器（QQ）没有。 */
  handle?: AdapterHandle
}

const PLATFORM_LABELS: Record<string, string> = {
  qq: 'QQ（OneBot v11）',
  discord: 'Discord',
  telegram: 'Telegram',
}

export class AdapterRegistry {
  private readonly deps: AdapterRegistryDeps
  private readonly entries = new Map<string, Entry>()
  private generation = 0
  private readonly listeners = new Set<() => void>()

  constructor(deps: AdapterRegistryDeps) {
    this.deps = deps
  }

  /** 插件入口：`ctx.adapter(spec, config)` 最终走这里。 */
  async start(spec: AdapterSpec, config?: unknown): Promise<AdapterHandle> {
    // 平台名可能是运行期才知道的（Satori 这种协议层适配器）
    const resolved = spec?.resolvePlatform?.(config)
    const platform = String(resolved || spec?.platform || '').trim()
    if (!platform) throw new Error('适配器要声明 platform')

    const generation = this.generation
    const pending: Array<(bot: BotLike) => void> = []
    let entry: Entry | undefined
    let closed = false
    const deliver = (action: (bot: BotLike) => void) => {
      if (closed || generation !== this.generation) return
      if (!entry) {
        if (pending.length < 100) pending.push(action)
        return
      }
      if (this.entries.get(botKey(platform, entry.bot.id)) === entry) action(entry.bot)
    }
    const runtime: AdapterRuntime = {
      platform,
      log: this.deps.log,
      speak: this.deps.speak,
      supports: capability => entry?.bot.supports(capability) ?? false,
      emitMessage: message => deliver(bot => this.deps.onMessage?.(bot, message)),
      emitEvent: (event, payload) => deliver(() => this.deps.onEvent?.(platform, event, payload)),
    }
    const connection = await startAdapter(this.deps.bots, spec, config, runtime, {
      platform, wrapBot: this.deps.wrapBot,
      active: () => generation === this.generation,
    })
    const bot = connection.bot
    if (generation !== this.generation) {
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
    entry = { platform, bot, handle, name: spec.name || PLATFORM_LABELS[platform] || platform, startedAt: Date.now() }
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

  /** 内置适配器（QQ）登记进来，让面板里也看得见它。 */
  adopt(bot: BotLike, meta: { platform?: string; name?: string } = {}): void {
    const platform = meta.platform || bot.platform
    this.entries.set(botKey(platform, bot.id), {
      platform,
      name: meta.name || PLATFORM_LABELS[platform] || platform,
      bot,
      startedAt: Date.now(),
    })
    this.changed()
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
    this.generation++
    const handles = [...this.entries.values()].map((entry) => entry.handle).filter(Boolean) as AdapterHandle[]
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
