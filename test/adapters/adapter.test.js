// S8：适配器插件化——连接成功才进注册表，断开就下线
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BotRegistry } from '../../src/core/bot/instance/registry.ts'
import { startAdapter } from '../../src/core/bot/adapter/contract.ts'
import { createPluginContext } from '../../src/core/module/context/plugin-context.ts'

function fakeBot(id, platform) {
  return {
    id,
    platform,
    selfId: id,
    status: 'online',
    sendMessage: async () => ({}),
    sendPrivateMessage: async () => ({}),
    supports: () => true,
  }
}

function runtime() {
  const logs = []
  return { runtime: { platform: 'discord', log: (m) => logs.push(m) }, logs }
}

test('连接成功 → 进注册表 → 发 online', async () => {
  const registry = new BotRegistry()
  const events = []
  registry.on('online', (bot) => events.push(['online', bot.id]))
  const { runtime: rt } = runtime()
  const handle = await startAdapter(registry, {
    platform: 'discord',
    connect: async (config) => fakeBot(config.id, 'discord'),
  }, { id: 'bot-1' }, rt)
  assert.equal(handle.bot.id, 'bot-1')
  assert.deepEqual(registry.list().map((b) => b.id), ['bot-1'])
  assert.deepEqual(events, [['online', 'bot-1']])
})

test('dispose：先断开，再摘注册表，再发 offline；重复调用只做一次', async () => {
  const registry = new BotRegistry()
  const events = []
  registry.on('online', (bot) => events.push(['online', bot.id]))
  registry.on('offline', (bot, reason) => events.push(['offline', bot.id, reason]))
  const { runtime: rt } = runtime()
  let disconnects = 0
  const handle = await startAdapter(registry, {
    platform: 'discord',
    connect: async () => fakeBot('bot-2', 'discord'),
    disconnect: async () => { disconnects += 1 },
  }, {}, rt)
  await handle.dispose()
  await handle.dispose()
  assert.equal(disconnects, 1)
  assert.deepEqual(registry.list(), [])
  assert.deepEqual(events, [['online', 'bot-2'], ['offline', 'bot-2', 'disconnected']])
})

test('连接失败 / 平台名对不上：什么都不注册', async () => {
  const registry = new BotRegistry()
  const { runtime: rt } = runtime()
  await assert.rejects(
    startAdapter(registry, { platform: 'discord', connect: async () => { throw new Error('token 不对') } }, {}, rt),
    /token 不对/,
  )
  await assert.rejects(
    startAdapter(registry, { platform: 'discord', connect: async () => fakeBot('x', 'telegram') }, {}, rt),
    /两边要一致/,
  )
  assert.deepEqual(registry.list(), [])
})

test('ctx.adapter：模块卸载时自动断开', async () => {
  const registry = new BotRegistry()
  const { runtime: rt } = runtime()
  const disposers = []
  const api = {
    onDispose: (fn) => { disposers.push(fn); return () => {} },
    settings: () => ({}),
  }
  const ctx = createPluginContext(api, {
    startAdapter: (spec, config) => startAdapter(registry, spec, config, rt),
  })
  const handle = await ctx.adapter({ platform: 'discord', connect: async () => fakeBot('bot-3', 'discord') }, {})
  assert.equal(handle.bot.id, 'bot-3')
  for (const off of disposers) await off()
  assert.deepEqual(registry.list(), [])
})
