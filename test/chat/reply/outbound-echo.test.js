// S5 出站回写：中间件 / 指令先发的话要能被这一轮的模型看到，且条数与字数有上限。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pipeline } from '../../../src/core/pipeline/index.ts'
import { Session, SENT_LOG_MAX, SENT_TEXT_MAX } from '../../../src/core/pipeline/session.ts'
import { h } from '../../../src/core/message/element/element.ts'

function fakeBot(overrides = {}) {
  const sent = []
  const bot = {
    id: 'bot-1',
    platform: 'qq',
    selfId: 'bot-1',
    status: 'online',
    supports: () => true,
    async sendMessage(channelId, content) {
      sent.push({ channelId, content })
      return { message_id: sent.length }
    },
    async sendPrivateMessage(userId, content) {
      sent.push({ userId, content })
      return { message_id: sent.length }
    },
    ...overrides,
  }
  return { bot, sent }
}

function sessionOf(bot, extra = {}) {
  return new Session({
    bot,
    type: 'group',
    channelId: 'g1',
    userId: 'u1',
    userName: '小明',
    content: '在吗',
    ...extra,
  })
}

test('send 成功后记一条纯文本；失败不记', async () => {
  const { bot } = fakeBot()
  const session = sessionOf(bot)
  await session.send('先回一句')
  assert.deepEqual(session.sentLog.map((item) => item.text), ['先回一句'])

  const failing = fakeBot({ sendMessage: async () => { throw new Error('没连上网关') } })
  const broken = sessionOf(failing.bot)
  await assert.rejects(() => broken.send('发不出去'), /没连上网关/)
  assert.deepEqual(broken.sentLog, [], '没发出去的话不能进回写流水')
})

test('元素树发出去也能回写成文字', async () => {
  const { bot } = fakeBot()
  const session = sessionOf(bot)
  await session.send([h('text', { content: '视频在这：' }, []), h('text', { content: 'BV1xx' }, [])])
  assert.equal(session.sentLog[0].text, '视频在这：BV1xx')
})

test('回写有上限：最多 5 条、每条 300 字', async () => {
  const { bot } = fakeBot()
  const session = sessionOf(bot)
  for (let i = 1; i <= SENT_LOG_MAX + 3; i++) await session.send(`第 ${i} 句`)
  assert.equal(session.sentLog.length, SENT_LOG_MAX)
  assert.deepEqual(session.sentLog.map((item) => item.text), ['第 4 句', '第 5 句', '第 6 句', '第 7 句', '第 8 句'])

  const long = sessionOf(fakeBot().bot)
  await long.send('长'.repeat(SENT_TEXT_MAX + 50))
  assert.equal(long.sentLog[0].text.length, SENT_TEXT_MAX)
})

test('中间件先发一句再 next()：模型段拿到的会话里带着这句话', async () => {
  const { bot, sent } = fakeBot()
  const pipeline = new Pipeline()
  pipeline.use(async (session, next) => {
    await session.send('我先接住这个 BV 号')
    return next()
  })
  pipeline.onLlm((session) => ({ echo: session.sentLog.map((item) => item.text) }))

  const result = await pipeline.dispatch(sessionOf(bot))
  assert.equal(result.handled, true)
  assert.equal(result.by, 'llm')
  assert.deepEqual(result.value, { echo: ['我先接住这个 BV 号'] })
  assert.equal(sent.length, 1)
})
