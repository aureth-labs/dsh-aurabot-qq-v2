// Bot 注册表：宿主持有，插件只读。
// bots 同时支持三种取法：ctx.bots[0]、ctx.bots('id')、ctx.bots.list()。

import type { BotsAccessor, BotEvents, BotLike } from '../../../types/adapter/bot.ts'

export type { BotsAccessor } from '../../../types/adapter/bot.ts'

type Listener<K extends keyof BotEvents> = BotEvents[K]

export const botKey = (platform: string, id: string) => JSON.stringify([platform, id])

export function findBot(bots: Iterable<BotLike>, id: string, platform?: string): BotLike | undefined {
  let match: BotLike | undefined
  for (const bot of bots) {
    if (bot.id !== id || (platform !== undefined && bot.platform !== platform)) continue
    if (match) return undefined
    match = bot
  }
  return match
}

export class BotRegistry {
  private readonly bots = new Map<string, BotLike>()
  private readonly listeners: { [K in keyof BotEvents]: Set<Listener<K>> } = {
    online: new Set(),
    offline: new Set(),
    error: new Set(),
  }

  add(bot: BotLike): void {
    this.bots.set(botKey(bot.platform, bot.id), bot)
  }

  remove(target: BotLike | string): boolean {
    const bot = typeof target === 'string' ? this.get(target) : target
    if (!bot) return false
    const key = botKey(bot.platform, bot.id)
    return this.bots.get(key) === bot && this.bots.delete(key)
  }

  get(id: string, platform?: string): BotLike | undefined {
    return platform === undefined ? findBot(this.bots.values(), id) : this.bots.get(botKey(platform, id))
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
  const lookup = (id: string, platform?: string) => registry.get(id, platform)
  const accessor = lookup as BotsAccessor
  Object.defineProperties(accessor, {
    get: { value: lookup },
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
