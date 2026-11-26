// 适配器插件化：一个适配器就是「注册 bot → 连接 → 上线 → 可用 → 断开 → 下线」。
//
// 适配器不是宿主的内置特例，而是普通插件里调 ctx.adapter(spec, config)：
// 宿主负责把它挂进 bots、发上线/下线事件、模块卸载时断开。

import type { AdapterHandle, AdapterRuntime, AdapterSpec } from '../types/adapter.ts'
import type { BotLike } from '../types/bot.ts'
import type { BotRegistry } from './bot-registry.ts'

export type { AdapterHandle, AdapterInfo, AdapterRuntime, AdapterSpec } from '../types/adapter.ts'

export interface StartAdapterOptions {
  /**
   * 宿主统一包装 bot 的发送方法。
   *
   * 试运行闸门、元素降级、`<voice>` 合成这些是**所有**平台都要的，
   * 不能让每个适配器各写一遍（写漏一个就等于那个平台能绕过试运行真发消息）。
   */
  wrapBot?: (bot: BotLike, spec: AdapterSpec) => BotLike
}

/**
 * 启动一个适配器实例。
 * 顺序固定：连接成功 → 进注册表 → 发 online。连接失败什么都不留下。
 */
export async function startAdapter(
  registry: BotRegistry,
  spec: AdapterSpec,
  config: unknown,
  runtime: AdapterRuntime,
  options: StartAdapterOptions = {},
): Promise<AdapterHandle> {
  if (!spec || typeof spec.connect !== 'function') throw new Error('适配器要有 connect(config, runtime)')
  const platform = String(spec.platform || runtime.platform || '').trim()
  if (!platform) throw new Error('适配器要声明 platform')

  const connected = await spec.connect(config, { ...runtime, platform })
  if (!connected || typeof connected.id !== 'string' || !connected.id) {
    throw new Error(`适配器 ${platform} 的 connect 要返回带 id 的 bot 实例`)
  }
  if (connected.platform !== platform) {
    // 平台名对不上会让 Target 与能力表错位，早点拦下来
    throw new Error(`适配器 ${platform} 返回的 bot.platform 是「${connected.platform}」，两边要一致`)
  }
  const bot = options.wrapBot ? options.wrapBot(connected, { ...spec, platform }) : connected

  registry.add(bot)
  registry.emit('online', bot)

  let closed = false
  return {
    bot,
    async dispose() {
      if (closed) return
      closed = true
      try {
        // 用适配器自己的实例断开：包装层只是发送闸门，不是它认识的 bot
        await spec.disconnect?.(connected, config)
      } catch (error) {
        runtime.log(`适配器 ${platform} 断开时出错：${String((error as Error)?.message ?? error)}`)
      }
      registry.remove(bot.id)
      registry.emit('offline', bot, 'disconnected')
    },
  }
}
