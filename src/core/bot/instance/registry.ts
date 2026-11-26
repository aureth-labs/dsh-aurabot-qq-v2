// Bot 注册表：宿主持有，插件只读。
// bots 同时支持三种取法：ctx.bots[0]、ctx.bots('id')、ctx.bots.list()。

import type { BotsAccessor, BotEvents, BotLike } from '../../../types/adapter/bot.ts'

export type { BotsAccessor } from '../../../types/adapter/bot.ts'

type Listener<K extends keyof BotEvents> = BotEvents[K]

export class BotRegistry {
  private readonly bots = new Map<string, BotLike>()
  private readonly listeners: { [K in keyof BotEvents]: Set<Listener<K>> } = {
    online: new Set(),
    offline: new Set(),
    error: new Set(),
  }

  add(bot: BotLike): void {
    this.bots.set(bot.id, bot)
  }

  remove(id: string): void {
    this.bots.delete(id)
  }

  get(id: string): BotLike | undefined {
    return this.bots.get(id)
  }

  list(): BotLike[] {
    return [...this.bots.values()]
  }

  on<K extends keyof BotEvents>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener)
    return () => this.listeners[event].delete(listener)
  }

  emit<K extends keyof BotEvents>(event: K, ...args: Parameters<Listener<K>>): void {
    for (const listener of this.listeners[event]) {
      try {
        ;(listener as (...a: unknown[]) => void)(...args)
      } catch {
        // 一个监听器抛错不能影响其它监听器与宿主
      }
    }
  }
}

const arrayTrap = Symbol('bots-array')

export function createBotsAccessor(registry: BotRegistry): BotsAccessor {
  const accessor = ((id: string) => registry.get(id)) as BotsAccessor
  Object.defineProperties(accessor, {
    get: { value: (id: string) => registry.get(id) },
    list: { value: () => registry.list() },
  })
  return new Proxy(accessor, {
    get(target, prop, receiver) {
      if (prop === arrayTrap) return registry.list()
      if (prop === 'length') return registry.list().length
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return registry.list()[Number(prop)]
      if (prop === Symbol.iterator) return registry.list()[Symbol.iterator].bind(registry.list())
      return Reflect.get(target, prop, receiver)
    },
  }) as BotsAccessor
}
