// 适配器注册表：面板「机器人列表」的数据源，也是 `ctx.adapter()` 的落地处。
//
// 和 BotRegistry 的分工：
// - BotRegistry 只管「现在哪些 bot 在线」（发送时用）
// - 这里多记一层「这个 bot 是哪个平台、谁拉起来的、什么时候上线的」，给面板用
//
// 内置 QQ 不是插件拉起来的，用 `adopt()` 挂进来；插件走 `start()`。

import type { AdapterHandle, AdapterInfo, AdapterRuntime, AdapterSpec, InboundMessage } from '../types/adapter.ts'
import type { BotLike } from '../types/bot.ts'
import { startAdapter } from './adapter.ts'
import type { BotRegistry } from './bot-registry.ts'

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

    // runtime 要在 connect() 之前交出去，但消息只能挂在 connect() 返回的 bot 上。
    // 用一个可变槽位接住：连上之前投进来的消息直接丢（那时还没有实例可挂）。
    let bound: BotLike | null = null
    const runtime: AdapterRuntime = {
      platform,
      log: this.deps.log,
      emitMessage: (message) => {
        if (!bound) {
          this.deps.log(`适配器 ${platform} 在 connect() 返回前投递了消息，已丢弃`)
          return
        }
        this.deps.onMessage?.(bound, message)
      },
      emitEvent: (event, payload) => this.deps.onEvent?.(platform, event, payload),
      speak: this.deps.speak,
      supports: (capability) => {
        if (!bound) return false
        return bound.supports(capability)
      },
    }
    const handle = await startAdapter(this.deps.bots, spec, config, runtime, {
      wrapBot: this.deps.wrapBot,
    })
    bound = handle.bot
    const key = handle.bot.id
    const existing = this.entries.get(key)
    if (existing?.handle) {
      // 同一个 id 被两个适配器抢：先让新的生效，旧的断开，别留一个收不到消息的幽灵
      await existing.handle.dispose().catch(() => {})
    }
    this.entries.set(key, {
      platform,
      name: String(spec.name || PLATFORM_LABELS[platform] || platform),
      bot: handle.bot,
      startedAt: Date.now(),
      handle,
    })
    this.changed()
    const dispose = handle.dispose.bind(handle)
    handle.dispose = async () => {
      await dispose()
      // 只有「当前这条记录还是它」才删，避免重连时把新实例记的条目抹掉
      if (this.entries.get(key)?.handle === handle) this.entries.delete(key)
      this.changed()
    }
    return handle
  }

  /** 内置适配器（QQ）登记进来，让面板里也看得见它。 */
  adopt(bot: BotLike, meta: { platform?: string; name?: string } = {}): void {
    const platform = meta.platform || bot.platform
    this.entries.set(bot.id, {
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

  get(id: string): BotLike | undefined {
    return this.entries.get(String(id))?.bot
  }

  /** 有增删 / 状态可能变化时通知（面板轮询之外的第二条路）。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async stopAll(): Promise<void> {
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
