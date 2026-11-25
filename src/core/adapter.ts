// 适配器插件化：一个适配器就是「注册 bot → 连接 → 上线 → 可用 → 断开 → 下线」。
//
// 适配器不是宿主的内置特例，而是普通插件里调 ctx.adapter(spec, config)：
// 宿主负责把它挂进 bots、发上线/下线事件、模块卸载时断开。

import type { AdapterHandle, AdapterRuntime, AdapterSpec } from '../types/adapter.ts'
import type { BotLike } from '../types/bot.ts'
import type { BotRegistry } from './bot-registry.ts'

export type { AdapterHandle, AdapterInfo, AdapterRuntime, AdapterSpec } from '../types/adapter.ts'

/**
 * 启动一个适配器实例。
 * 顺序固定：连接成功 → 进注册表 → 发 online。连接失败什么都不留下。
 */
export async function startAdapter(
  registry: BotRegistry,
  spec: AdapterSpec,
  config: unknown,
  runtime: AdapterRuntime,
): Promise<AdapterHandle> {
  if (!spec || typeof spec.connect !== 'function') throw new Error('适配器要有 connect(config, runtime)')
  const platform = String(spec.platform || runtime.platform || '').trim()
  if (!platform) throw new Error('适配器要声明 platform')

  const bot = await spec.connect(config, { ...runtime, platform })
  if (!bot || typeof bot.id !== 'string' || !bot.id) {
    throw new Error(`适配器 ${platform} 的 connect 要返回带 id 的 bot 实例`)
  }
  if (bot.platform !== platform) {
    // 平台名对不上会让 Target 与能力表错位，早点拦下来
    throw new Error(`适配器 ${platform} 返回的 bot.platform 是「${bot.platform}」，两边要一致`)
  }

  registry.add(bot)
  registry.emit('online', bot)

  let closed = false
  return {
    bot,
    async dispose() {
      if (closed) return
      closed = true
      try {
        await spec.disconnect?.(bot, config)
      } catch (error) {
        runtime.log(`适配器 ${platform} 断开时出错：${String((error as Error)?.message ?? error)}`)
      }
      registry.remove(bot.id)
      registry.emit('offline', bot, 'disconnected')
    },
  }
}
