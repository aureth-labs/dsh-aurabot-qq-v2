// 适配器注册表：面板「机器人列表」看到的应该和真实在线状态一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BotRegistry } from '../../src/core/bot/instance/registry.ts'
import { AdapterRegistry } from '../../src/core/bot/adapter/registry.ts'

function fakeBot(platform, id) {
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

function makeRegistry() {
  const bots = new BotRegistry()
  const logs = []
  const registry = new AdapterRegistry({ bots, log: (message) => logs.push(message) })
  return { bots, registry, logs }
}

function fakeSpec(platform, id) {
  const bot = fakeBot(platform, id)
  const state = { connected: 0, disconnected: 0 }
  return {
    bot,
    state,
    spec: {
      platform,
      name: `${platform} 测试号`,
      async connect() {
        state.connected++
        return bot
      },
      async disconnect() {
        state.disconnected++
      },
    },
  }
}

test('start 之后列表里有它，dispose 之后消失', async () => {
  const { bots, registry } = makeRegistry()
  const { spec, bot } = fakeSpec('discord', 'dc-1')

  const handle = await registry.start(spec, { token: 'x' })
  assert.deepEqual(registry.list(), [{ platform: 'discord', name: 'discord 测试号', id: 'dc-1', selfId: 'dc-1', status: 'online' }])
  assert.equal(bots.get('dc-1'), bot)

  await handle.dispose()
  assert.deepEqual(registry.list(), [])
  assert.equal(bots.get('dc-1'), undefined)
})

test('adopt 进来的内置 bot 也在列表里，且没有 handle（不会被 stopAll 断掉）', async () => {
  const { registry } = makeRegistry()
  const qq = fakeBot('qq', '1787850032')
  registry.adopt(qq)

  assert.equal(registry.list()[0].name, 'QQ（OneBot v11）')
  await registry.stopAll()
  assert.equal(registry.list().length, 1)
})

test('同一个 id 再次 start：旧的被断开，列表里只留新的', async () => {
  const { registry } = makeRegistry()
  const first = fakeSpec('telegram', 'tg-1')
  const second = fakeSpec('telegram', 'tg-1')

  await registry.start(first.spec, {})
  await registry.start(second.spec, {})

  assert.equal(first.state.disconnected, 1)
  assert.equal(registry.list().length, 1)
})

test('所有插件适配器都能被 stopAll 收掉', async () => {
  const { registry } = makeRegistry()
  const a = fakeSpec('discord', 'dc-a')
  const b = fakeSpec('telegram', 'tg-b')
  await registry.start(a.spec, {})
  await registry.start(b.spec, {})

  await registry.stopAll()
  assert.equal(a.state.disconnected, 1)
  assert.equal(b.state.disconnected, 1)
  assert.deepEqual(registry.list(), [])
})

test('每次增删都通知监听者', async () => {
  const { registry } = makeRegistry()
  let calls = 0
  const off = registry.onChange(() => calls++)
  const { spec } = fakeSpec('qq', 'qq-1')
  const handle = await registry.start(spec, {})
  await handle.dispose()
  off()
  registry.adopt(fakeBot('qq', 'qq-2'))

  assert.equal(calls, 2)
})

test('connect() 返回前投递的消息不会丢，连上之后补投', async () => {
  const bots = new BotRegistry()
  const got = []
  const registry = new AdapterRegistry({ bots, log: () => {}, onMessage: (bot, message) => got.push([bot.id, message]) })
  const bot = fakeBot('discord', 'dc-buf')
  const spec = {
    platform: 'discord',
    name: '缓冲',
    async connect(_config, runtime) {
      runtime.emitMessage({ content: '早到的消息' })
      return bot
    },
  }
  const handle = await registry.start(spec, {})
  assert.deepEqual(got, [['dc-buf', { content: '早到的消息' }]])
  await handle.dispose()
})

test('被顶替的旧实例再收到事件，不会重复进管线', async () => {
  const bots = new BotRegistry()
  const got = []
  const registry = new AdapterRegistry({ bots, log: () => {}, onMessage: (_bot, message) => got.push(message) })
  let first = null
  let second = null
  await registry.start({
    platform: 'telegram',
    name: '旧',
    async connect(_config, runtime) {
      first = runtime
      return fakeBot('telegram', 'tg-dup')
    },
  }, {})
  const handle = await registry.start({
    platform: 'telegram',
    name: '新',
    async connect(_config, runtime) {
      second = runtime
      return fakeBot('telegram', 'tg-dup')
    },
  }, {})

  first.emitMessage({ content: '旧实例' })
  assert.deepEqual(got, [])
  second.emitMessage({ content: '新实例' })
  assert.deepEqual(got, [{ content: '新实例' }])
  await handle.dispose()
})
