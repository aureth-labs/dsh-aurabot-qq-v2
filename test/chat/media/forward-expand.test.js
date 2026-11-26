import test from 'node:test'
import assert from 'node:assert/strict'
import { OneBotBot } from '../../../packages/adapters/qq/onebot-v11/src/bot.ts'
import { fromOneBot, toOneBot } from '../../../packages/adapters/qq/onebot-v11/src/element.ts'
import { hubSegments } from '../../../packages/adapters/qq/onebot-v11/src/inbound.ts'
import { toText } from '../../../src/core/message/element/element.ts'

const text = value => ({ type: 'text', data: { text: value } })
const forward = id => ({ type: 'forward', data: { id } })
const node = (name, body) => ({ sender: { user_id: 2, nickname: name }, message: [text(body)] })

function instance(name, expandForwards) {
  const calls = []
  const message = { message_id: '11', user_id: '22', message: [forward('shared')] }
  const bot = new OneBotBot({ id: name, selfId: name, expandForwards, isConnected: () => true,
    async call(action, params) {
      if (action === 'get_msg') return message
      if (action === 'get_friend_msg_history') return { messages: [message] }
      assert.equal(action, 'get_forward_msg')
      calls.push(params.id)
      return { messages: [node(name, '收到的记录 ' + params.id)] }
    } })
  bot.markOnline()
  return { bot, calls }
}

test('展开按实例生效，保留转发 ID、原文位置和引用来源', async () => {
  const a = instance('甲'), b = instance('乙', false)
  const raw = [text('原话[合并转发]'), forward('shared')]
  const card = { type: 'json', data: { data: '{"app":"card"}' } }
  const sticker = { type: 'image', data: { file: 'a.gif', url: 'https://example.org/a.gif', sub_type: 1 } }
  const elements = fromOneBot([card, ...raw, sticker])
  const expanded = await a.bot.expandForwards(elements, '11')
  assert.deepEqual(a.calls, ['11'])
  assert.match(toText(expanded), /^原话\[合并转发\][\s\S]*甲：收到的记录 11/)
  assert.deepEqual(toOneBot(expanded).find(seg => seg.type === 'forward'), raw[1])
  const projected = hubSegments(expanded, [card, ...raw, sticker])
  assert.deepEqual(projected[0], card)
  assert.deepEqual(projected.at(-1), sticker)
  assert.match(hubSegments(expanded).map(seg => seg.data.text).join(''), /甲：收到的记录/)
  assert.equal(await b.bot.expandForwards(elements, '11'), elements)
  const history = await b.bot.getMessageList('22', { channelType: 'private' })
  assert.equal(history[0].elements[0].attrs.id, 'shared')
  assert.deepEqual(b.calls, [])
  assert.match((await a.bot.getMessage('22', '11')).content, /甲：收到的记录/)
  await assert.rejects(a.bot.getMessage('another', '11'), /不属于当前会话/)
  assert.deepEqual(a.calls, ['11', '11'])
})

test('多条转发分别使用段内 ID，内联节点直接展开', async () => {
  const { bot, calls } = instance('乙')
  const input = fromOneBot([forward('first'), { type: 'forward', data: { id: 'inline', content: [node('小明', '排练结束')] } }, forward('last')])
  const output = await bot.expandForwards(input, 'same-envelope')
  assert.deepEqual(calls, ['first', 'last'])
  assert.match(toText(output), /first[\s\S]*小明：排练结束[\s\S]*last/)
})
