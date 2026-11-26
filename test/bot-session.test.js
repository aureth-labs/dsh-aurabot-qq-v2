// S0 地基的行为契约：Bot 状态机、注册表取法、Session 的发送路由。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BotRegistry, createBotsAccessor } from '../src/core/bot/bot/registry.ts'
import { Session } from '../src/core/pipeline/session.ts'
import { BotStateError, assertOnline } from '../src/core/bot/index.ts'
import { OneBotBot } from '../packages/adapters/qq/onebot-v11/src/bot.ts'

function fakeBot(overrides = {}) {
  const sent = []
  const bot = {
    id: '10001',
    platform: 'qq',
    selfId: '10001',
    status: 'online',
    supports: () => true,
    async sendMessage(channelId, content) {
      sent.push({ to: 'group', channelId, content })
      return { message_id: sent.length }
    },
    async sendPrivateMessage(userId, content) {
      sent.push({ to: 'private', userId, content })
      return { message_id: sent.length }
    },
    ...overrides,
  }
  return { bot, sent }
}

test('注册表三种取法都通', () => {
  const registry = new BotRegistry()
  const { bot } = fakeBot()
  registry.add(bot)
  const bots = createBotsAccessor(registry)

  assert.equal(bots.length, 1)
  assert.equal(bots[0], bot)
  assert.equal(bots('10001'), bot)
  assert.equal(bots.get('10001'), bot)
  assert.deepEqual(bots.list(), [bot])
  assert.deepEqual([...bots], [bot])

  registry.remove('10001')
  assert.equal(bots.length, 0)
})

test('注册表事件：一个监听器抛错不影响其它监听器', () => {
  const registry = new BotRegistry()
  const seen = []
  registry.on('online', () => {
    throw new Error('boom')
  })
  registry.on('online', (bot) => seen.push(bot.id))
  registry.emit('online', { id: '1' })
  assert.deepEqual(seen, ['1'])
})

test('群消息回群、私聊回私聊', async () => {
  const { bot, sent } = fakeBot()
  const group = new Session({ bot, type: 'group', channelId: 'g1', userId: 'u1', content: 'hi' })
  const privateChat = new Session({ bot, type: 'private', channelId: 'u1', userId: 'u1', content: 'hi' })

  await group.send('群里回')
  await privateChat.send('私聊回')

  assert.deepEqual(sent[0], { to: 'group', channelId: 'g1', content: '群里回' })
  assert.deepEqual(sent[1], { to: 'private', userId: 'u1', content: '私聊回' })
})

test('主动私聊与主动发群不看当前会话位置', async () => {
  const { bot, sent } = fakeBot()
  const session = new Session({ bot, type: 'group', channelId: 'g1', userId: 'u1', content: '' })

  await session.sendPrivateMessage('90001', '主人，插件坏了')
  await session.sendMessage('g2', '另一个群')

  assert.deepEqual(sent[0], { to: 'private', userId: '90001', content: '主人，插件坏了' })
  assert.deepEqual(sent[1], { to: 'group', channelId: 'g2', content: '另一个群' })
})

test('未上线不能发，抛 BotStateError 而不是静默丢弃', async () => {
  const calls = []
  const bot = new OneBotBot({
    call: async (action, params) => {
      calls.push({ action, params })
      return {}
    },
    isConnected: () => false,
  })

  await assert.rejects(() => bot.sendMessage('g1', 'hi'), BotStateError)
  await assert.rejects(() => bot.sendPrivateMessage('u1', 'hi'), BotStateError)
  assert.deepEqual(calls, [], '未上线时不应该真的发出 OneBot 调用')
  assert.throws(() => assertOnline(bot, 'sendMessage'), BotStateError)
})

test('上线后按 OneBot action 发，私聊/群各自走对接口', async () => {
  const calls = []
  const bot = new OneBotBot({
    call: async (action, params) => {
      calls.push({ action, params })
      return { message_id: 1 }
    },
    isConnected: () => true,
    selfId: '10001',
  })
  bot.markOnline()

  await bot.sendMessage('group:123', 'hello')
  await bot.sendPrivateMessage('456', 'hi')

  assert.deepEqual(calls[0], { action: 'send_group_msg', params: { group_id: '123', message: 'hello' } })
  assert.deepEqual(calls[1], { action: 'send_private_msg', params: { user_id: '456', message: 'hi' } })
  assert.equal(bot.id, '10001')
})

test('元素树发出前会被序列化成 OneBot 消息段', async () => {
  const calls = []
  const bot = new OneBotBot({
    call: async (action, params) => {
      calls.push({ action, params })
      return {}
    },
    isConnected: () => true,
    selfId: '10001',
  })
  bot.markOnline()

  const { h } = await import('../src/core/message/element/element.ts')
  await bot.sendMessage('123', [h.at('456'), h.text(' 你好'), h.image('http://x/y.png')])

  assert.deepEqual(calls[0].params.message, [
    { type: 'at', data: { qq: '456' } },
    { type: 'text', data: { text: ' 你好' } },
    { type: 'image', data: { file: 'http://x/y.png' } },
  ])
})
