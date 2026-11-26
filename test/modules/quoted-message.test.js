import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createQuoteHistory } from '../../src/core/pipeline/quotes.ts'
import { h } from '../../src/core/message/element/element.ts'
import { inboundOf, recalledMessage } from '../../packages/adapters/qq/onebot-v11/src/inbound.ts'
import { OneBotBot } from '../../packages/adapters/qq/onebot-v11/src/bot.ts'
import { inboundOf as satoriInbound } from '../../packages/adapters/satori/src/index.ts'

test('引用先查当前账号和会话；重启、撤回与平台重放保留同一来源', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-quote-'))
  const file = () => join(root, 'quotes.db')
  let store = createQuoteHistory(file)
  t.after(() => {
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const calls = []
  const bot = new OneBotBot({
    id: 'a',
    selfId: '1000',
    isConnected: () => true,
    call: async (action, args) => {
      calls.push([action, args])
      return {
        group_id: '234',
        message_id: '6',
        user_id: '777',
        message: [{ type: 'text', data: { text: '异群消息' } }],
      }
    },
  })
  bot.markOnline()
  const base = {
    message_type: 'group',
    group_id: '123',
    user_id: '777',
    message_id: '6',
    message: [{ type: 'text', data: { text: '原消息' } }],
  }
  await store.receive(bot, inboundOf(base))
  store.close()
  store = createQuoteHistory(file)
  const quoted = inboundOf({ ...base, message_id: '7', message: [{ type: 'reply', data: { id: '6' } }] })
  const original = await store.receive(bot, quoted)
  assert.equal(original.content, '原消息')
  assert.equal(calls.length, 0)
  const other = { id: 'a', platform: 'sandbox', selfId: '1000', getMessage: () => bot.getMessage('123', '6') }
  const sandbox = satoriInbound(
    {
      type: 'message-created',
      channel: { id: '123', type: 0 },
      user: { id: '777' },
      message: { id: 's1', content: '<quote id="6"/>新问题' },
    },
    {},
  )
  assert.deepEqual(await store.receive(other, sandbox), { id: '6', channelId: '123' })
  assert.equal(calls.length, 1)
  store.recall(
    bot,
    recalledMessage({ post_type: 'notice', notice_type: 'group_recall', group_id: '123', message_id: '6' }),
  )
  await store.receive(bot, inboundOf(base))
  const withdrawn = await store.receive(bot, quoted)
  assert(withdrawn.deletedAt)
  assert.equal(withdrawn.content, undefined)
  assert.equal(calls.length, 1)
  const pm = { ...quoted, type: 'private', elements: [h.quote('6')] }
  assert.equal((await store.receive(bot, pm)).content, undefined)
})
