import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OneBotBot } from '../../packages/adapters/qq/onebot-v11/src/bot.ts'
import { wrapAdapterBot } from '../../src/core/bot/instance/bot.ts'
import { Bot } from '../../src/core/bot/index.ts'

function onebot() {
  const calls = []
  const bot = new OneBotBot({
    isConnected: () => true,
    selfId: '10000',
    call: async (action, params) => {
      calls.push({ action, params })
      if (action === 'get_login_info') return { user_id: '10000', nickname: '大肥鱼' }
      if (action === 'get_group_info') return { group_id: '7788', group_name: '摸鱼群' }
      if (action === 'get_group_member_list') {
        return [{ user_id: '20001', card: '小学', nickname: 'shangxue', role: 'owner', join_time: 1700000000 }]
      }
      if (action === 'get_msg') return { message_id: '9', group_id: '7788', user_id: '20001', message: [{ type: 'text', data: { text: '在吗' } }], time: 1700000001 }
      return {}
    },
  })
  bot.markOnline()
  return { bot, calls }
}

test('OneBot：getSelf / getGuild / getChannel 落到对应 action', async () => {
  const { bot, calls } = onebot()

  assert.deepEqual(await bot.getSelf(), { id: '10000', name: '大肥鱼', raw: { user_id: '10000', nickname: '大肥鱼' } })

  const guild = await bot.getGuild('7788')
  assert.equal(guild.name, '摸鱼群')
  assert.equal(calls.at(-1).action, 'get_group_info')
  assert.equal(calls.at(-1).params.group_id, '7788')

  const channel = await bot.getChannel('group:7788')
  assert.equal(channel.id, '7788')
  assert.equal(channel.type, 'text')
  assert.equal(channel.guildId, '7788')

  const direct = await bot.getChannel('private:20001')
  assert.deepEqual(direct, { id: '20001', type: 'direct' })
})

test('OneBot：getUserList 映射角色与入群时间，getMessage 解析元素树', async () => {
  const { bot } = onebot()

  const [member] = await bot.getUserList('7788')
  assert.equal(member.user.id, '20001')
  assert.equal(member.nick, '小学')
  assert.deepEqual(member.roles, ['owner'])
  assert.equal(member.joinedAt, 1700000000000)

  const message = await bot.getMessage('group:7788', '9')
  assert.equal(message.id, '9')
  assert.equal(message.userId, '20001')
  assert.equal(message.content, '在吗')
  assert.deepEqual(message.elements.map((item) => item.type), ['text'])
})

test('包装层：资源 API 原样转发给适配器实例', async () => {
  const { bot } = onebot()
  const wrapped = wrapAdapterBot(bot, { allowed: () => false, log: () => {} })

  assert.equal(wrapped.id, '10000')
  assert.equal(wrapped.status, 'online')
  assert.equal(wrapped.getSelfId(), '10000')
  assert.equal((await wrapped.getGuild('7788')).name, '摸鱼群')
  assert.equal((await wrapped.getChannel('group:7788')).type, 'text')
})

test('基类：平台没实现的接口抛 UnsupportedApiError，不静默返回空', async () => {
  class Mini extends Bot {
    id = 'mini'
    platform = 'demo'
    selfId = 'mini'
    status = 'online'
    supports() {
      return false
    }
    async sendMessage() {
      return {}
    }
    async sendPrivateMessage() {
      return {}
    }
  }

  const bot = new Mini()
  assert.deepEqual(await bot.getSelf(), { id: 'mini' })
  await assert.rejects(bot.deleteReaction('c', 'm', '👍'), (error) => error.code === 'UNSUPPORTED_API')
  await assert.rejects(bot.updateMessage('c', 'm', 'x'), (error) => /不支持 updateMessage/.test(error.message))
})
