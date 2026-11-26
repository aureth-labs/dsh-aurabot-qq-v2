// S1 补全：ctx.bot(id)、ctx.broadcast、平台/群/私聊过滤器、ctx.root、ctx.emit。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPluginContext } from '../src/core/module/plugin-context.ts'
import { createBotsAccessor, BotRegistry } from '../src/core/bot/bot/registry.ts'
import { Pipeline } from '../src/core/pipeline/index.ts'

function fakeBot(id, platform = 'qq') {
  return {
    id,
    platform,
    selfId: id,
    status: 'online',
    sends: [],
    async sendMessage(channelId, content) {
      this.sends.push(['channel', channelId, content])
      return { ok: true }
    },
    async sendPrivateMessage(userId, content) {
      this.sends.push(['private', userId, content])
      return { ok: true }
    },
    supports: () => true,
  }
}

function contextWith(bots, extras = {}) {
  const api = { onDispose: () => () => {}, settings: () => ({}), on: () => () => {} }
  const pipeline = new Pipeline()
  return { ctx: createPluginContext(api, { bots, pipeline, ...extras }), pipeline }
}

test('ctx.bot() 取默认，ctx.bot(id) 精确取，ctx.bot.list() 全给', () => {
  const registry = new BotRegistry()
  const first = fakeBot('1001')
  const second = fakeBot('1002')
  registry.add(first)
  registry.add(second)
  const { ctx } = contextWith(createBotsAccessor(registry))

  assert.equal(ctx.bot().id, '1001')
  assert.equal(ctx.bot('1002').id, '1002')
  assert.equal(ctx.bot('404'), undefined)
  assert.deepEqual(ctx.bot.list().map((bot) => bot.id), ['1001', '1002'])
})

test('ctx.broadcast 按 Target 逐个发，单条失败不影响其它条', async () => {
  const registry = new BotRegistry()
  const qq = fakeBot('1001', 'qq')
  registry.add(qq)
  const { ctx } = contextWith(createBotsAccessor(registry))

  const results = await ctx.broadcast(
    [
      { platform: 'qq', botId: '1001', type: 'group', id: '555' },
      { platform: 'qq', botId: '1001', type: 'private', id: '777' },
      { platform: 'discord', botId: 'x', type: 'group', id: '1' },
    ],
    'hello',
  )

  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, true)
  assert.equal(results[2].ok, false)
  assert.match(results[2].error, /没有可用的「discord」机器人/)
  assert.deepEqual(qq.sends.map((item) => item.slice(0, 2)), [
    ['channel', '555'],
    ['private', '777'],
  ])
})

test('ctx.platform 只收本平台的消息，指令不匹配时继续往下走', async () => {
  const { ctx, pipeline } = contextWith(undefined)
  ctx.platform('qq').command('ping', async () => 'qq-pong')
  pipeline.onLlm(async () => 'llm')

  const qq = await pipeline.dispatch({ content: '/ping', bot: { platform: 'qq' }, type: 'group' })
  assert.equal(qq.by, 'command')

  // discord 上的 /ping 不算命中 qq 的指令，落到模型段
  const discord = await pipeline.dispatch({ content: '/ping', bot: { platform: 'discord' }, type: 'group' })
  assert.equal(discord.by, 'llm')
})

test('ctx.guild / ctx.private 收窄会话类型，中间件不放行时直接 next', async () => {
  const { ctx, pipeline } = contextWith(undefined)
  const hits = []
  ctx.private().middleware(async () => { hits.push('private') }, { name: 'only-private' })
  ctx.guild('900').middleware(async () => { hits.push('guild-900') }, { name: 'guild-900' })
  pipeline.onLlm(async () => 'llm')

  await pipeline.dispatch({ content: 'a', type: 'private' })
  await pipeline.dispatch({ content: 'b', type: 'group', channelId: '900' })
  await pipeline.dispatch({ content: 'c', type: 'group', channelId: '901' })
  assert.deepEqual(hits, ['private', 'guild-900'])
})

test('ctx.platform 的 bots 只列本平台', () => {
  const registry = new BotRegistry()
  registry.add(fakeBot('1001', 'qq'))
  registry.add(fakeBot('2002', 'discord'))
  const { ctx } = contextWith(createBotsAccessor(registry))

  assert.deepEqual(ctx.platform('discord').bots.list().map((bot) => bot.id), ['2002'])
  assert.equal(ctx.platform('discord').bot('1001'), undefined)
})

test('ctx.root.config 每次读都是最新值，不是加载时快照', () => {
  let config = { enabled: false }
  const { ctx } = contextWith(undefined, { rootConfig: () => config })
  assert.equal(ctx.root.config.enabled, false)
  config = { enabled: true }
  assert.equal(ctx.root.config.enabled, true)
})

test('ctx.emit 转给模块总线', () => {
  const events = []
  const api = { emit: (event, ...args) => events.push([event, ...args]), onDispose: () => () => {} }
  const ctx = createPluginContext(api)
  ctx.emit('my-event', 1, 2)
  assert.deepEqual(events, [['my-event', 1, 2]])
})
