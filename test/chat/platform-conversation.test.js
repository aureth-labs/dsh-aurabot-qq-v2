import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../packages/modules/chat-bridge/index.ts'
import { h, toText } from '../../src/core/message/element/element.ts'
import { isSilence } from '../../src/chat/reply/format/sanitize.ts'
import { normalize } from '../../src/core/config/state/normalize.ts'
import { cleanupDir } from '../helpers/cleanup.js'

test('跨平台对话隔离人格和平台，重启后记得上文并忽略旧事件', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-platform-chat-'))
  const calls = [], sent = [], observed = [], errors = []
  let receive, stop, answer = '收到', persona = '晴'
  const ctx = {
    config: { history: 4 }, root: { config: normalize({ enabled: true, group: { wakeWords: ['小雪'], ignoreAtOthers: true }, media: { receiveImages: false } }) },
    get: key => key === 'mood' ? { contextLine: () => '今天很开心', observe: (...args) => observed.push(args) }
      : key === 'persona' ? { current: () => ({ id: persona, name: persona, body: '人格卡 ' + persona }) } : undefined,
    llm: { generate: async request => { calls.push(request); return answer } },
    text: { clean: s => s, isSilence }, logger: { warn: (...args) => errors.push(args) },
    isOwner: s => s.platform === 'matrix', dataDir: name => join(dir, name),
    effect: fn => { stop = fn }, on: (_, fn) => { receive = fn },
  }
  apply(ctx)
  t.after(() => { stop(); cleanupDir(dir) })
  const session = {
    platform: 'matrix', bot: { id: 'work', selfId: 'bot', supports: () => false }, type: 'private', isPrivate: true,
    channelId: 'dm', userId: '42', userName: '用户', content: '第一条', elements: [], messageId: '1',
    send: async elements => { sent.push(toText(elements)); return { id: 'receipt' } },
  }
  await Promise.all([receive(session), receive(session)])
  assert.deepEqual(sent, ['收到'])
  assert.match(calls[0].system, /人格卡 晴[\s\S]*今天很开心[\s\S]*登记的主人/)
  stop()
  apply(ctx)
  await receive(session)
  assert.equal(calls.length, 1)
  answer = '[沉默]'
  await receive({ ...session, messageId: '2', content: '下一条' })
  assert.deepEqual(JSON.parse(calls.at(-1).text).transcript.map(x => x.text), ['第一条', '收到', '下一条'])
  assert.equal(sent.length, 1)
  await receive({ ...session, platform: 'discord', content: '', elements: [h.image('https://fixture.invalid/image')] })
  assert.deepEqual(JSON.parse(calls.at(-1).text).transcript.map(x => x.text), ['[图片]'])
  assert.match(calls.at(-1).system, /普通用户/)
  await receive({ ...session, bot: { ...session.bot, id: 'home' } })
  assert.equal(JSON.parse(calls.at(-1).text).transcript.length, 1)
  persona = '雪'
  await receive({ ...session, messageId: '3' })
  assert.equal(JSON.parse(calls.at(-1).text).transcript.length, 1)
  assert.match(calls.at(-1).system, /人格卡 雪/)
  await receive({ ...session, isPrivate: false, type: 'group' })
  assert.equal(calls.length, 5)
  assert.equal(observed.length, 5)
  const group = { ...session, isPrivate: false, type: 'group' }
  let n = 0
  const talk = elements => receive({ ...group, messageId: 'group-' + ++n, elements, content: toText(elements) })
  await talk([h.forward([h.text('小雪')])])
  await talk([h.at('guest'), h.text('小雪')])
  assert.equal(calls.length, 5)
  await talk([h('message', {}, [h.text('小雪，早安')])])
  assert.equal(calls.length, 6)
  assert.equal(observed.at(-1)[2].direct, true)
  ctx.root.config = normalize({ ...ctx.root.config, wakeWords: [] })
  await talk([h.text('小雪')])
  assert.equal(calls.length, 6)
  await talk([h.at('bot'), h.text('早安')])
  assert.equal(calls.length, 7)
  assert.deepEqual(errors, [])
})
