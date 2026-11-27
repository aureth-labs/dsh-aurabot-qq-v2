import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/modules/chat-tools/index.ts'
import { readHistory } from '../../packages/modules/chat-tools/history.ts'
import { OneBotBot } from '../../packages/adapters/qq/onebot-v11/src/bot.ts'
import { satoriAdapter } from '../../packages/adapters/satori/src/index.ts'
import { createSandboxServer } from '../../packages/modules/sandbox/server.ts'

test('同号群、好友与第二个 QQ 实例按回合目标查历史', async () => {
  const calls = []
  const bots = new Map(['first', 'second'].map(id => {
    const bot = new OneBotBot({ id, isConnected: () => true, call: async (action, params) => {
      calls.push([id, action, params])
      return { messages: [{ message_id: 17, user_id: 8, sender: { nickname: '朗' }, message: '花开了' }] }
    } })
    bot.markOnline()
    return [id, bot]
  }))
  let tools
  apply({ bots: { get: id => bots.get(id) }, root: { config: {} }, tool: handler => { tools = handler } })
  for (const type of ['private', 'group']) {
    const target = { platform: 'qq', botId: 'second', type, id: '8' }
    const [tool] = tools({ target, chat: { kind: type, userId: '8' }, sessionId: 's', level: 'social' })
    assert.equal((await tool.execute({ group: '9' })).ok, false)
    assert.match((await tool.execute({ before: '18', count: 1 })).message, /朗：花开了/)
  }
  assert.deepEqual(calls.map(([id, action, params]) => [id, action, params]), [
    ['second', 'get_friend_msg_history', { user_id: '8', count: 2, message_id: 18, reverse_order: true }],
    ['second', 'get_group_msg_history', { group_id: '8', count: 2, message_id: 18, reverse_order: true }],
  ])
})

test('同一读取器通过 Satori 沙盒获取原始频道 ID、发送者和上一页', async t => {
  const server = createSandboxServer({ port: 0 })
  const { url } = await server.start()
  const spec = satoriAdapter()
  let bot
  t.after(async () => { if (bot) await spec.disconnect(bot); await server.close() })
  bot = await spec.connect({ endpoint: url, platform: 'sandbox' }, { platform: 'sandbox', log() {}, emitMessage() {} })
  const target = { platform: bot.platform, botId: bot.id, type: 'channel', id: 'issue:7' }
  await bot.sendMessage(target.id, '第一条')
  await bot.sendMessage(target.id, '第二条')
  const latest = await readHistory(bot, target, 1, '')
  assert.match(latest.message, /你：第二条/)
  const earlier = await readHistory(bot, target, 1, latest.oldest_message_id)
  assert.match(earlier.message, /你：第一条/)
  assert.doesNotMatch(earlier.message, /第二条/)
})
