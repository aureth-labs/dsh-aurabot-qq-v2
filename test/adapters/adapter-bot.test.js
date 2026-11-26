// S4：所有平台共用的出站处理——试运行闸门、`<voice>` 合成、元素按能力降级。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrapAdapterBot } from '../../src/core/bot/bot/instance.ts'
import { toText } from '../../src/core/message/element/element.ts'

function fakeBot(capabilities = ['text']) {
  const sent = []
  const bot = {
    id: 'demo-bot',
    platform: 'demo',
    selfId: 'demo-bot',
    status: 'online',
    supports: (capability) => capabilities.includes(capability),
    async sendMessage(channelId, content) {
      sent.push({ channelId, content })
      return { message_id: sent.length }
    },
    async sendPrivateMessage(userId, content) {
      sent.push({ userId, content })
      return { message_id: sent.length }
    },
  }
  return { bot, sent }
}

test('试运行：一条都不发，只记日志', async () => {
  const { bot, sent } = fakeBot()
  const logs = []
  const wrapped = wrapAdapterBot(bot, { allowed: () => false, log: (m) => logs.push(m) })
  const result = await wrapped.sendMessage('c1', '不该发出去')
  assert.deepEqual(result, { ok: false, simulated: true })
  assert.deepEqual(sent, [])
  assert.match(logs[0], /试运行（demo 适配器没真发）/)
})

test('能力降级：纯文本平台上的文件与图片变成人话，路径不丢', async () => {
  const { bot, sent } = fakeBot(['text'])
  const wrapped = wrapAdapterBot(bot, { allowed: () => true, log: () => {} })
  await wrapped.sendMessage('c1', [
    { type: 'text', attrs: { content: '文件给你' } },
    { type: 'file', attrs: { url: 'file:///D:/demo/LICENSE' } },
    { type: 'image', attrs: { url: 'https://example.com/a.png' } },
  ])
  const text = toText(sent[0].content)
  assert.match(text, /文件给你/)
  assert.match(text, /\[文件\] file:\/\/\/D:\/demo\/LICENSE/)
  assert.match(text, /\[图片\]/)
  assert.equal(sent[0].content.some((item) => item.type === 'file'), false, '发不了的元素不能原样交给适配器')
})

test('支持语音的平台：<voice>文字</voice> 先合成成语音再发', async () => {
  const { bot, sent } = fakeBot(['text', 'voice'])
  const spoken = []
  const wrapped = wrapAdapterBot(bot, {
    allowed: () => true,
    log: () => {},
    speak: async (text) => {
      spoken.push(text)
      return 'file:///tmp/voice.mp3'
    },
  })
  await wrapped.sendMessage('c1', '<text>听这句</text><voice>你好呀</voice>')
  assert.deepEqual(spoken, ['你好呀'])
  const voice = sent[0].content.find((item) => item.type === 'voice')
  assert.equal(voice.attrs.url, 'file:///tmp/voice.mp3')
  assert.equal(toText(sent[0].content), '听这句')
})

test('TTS 失败：语音降成文字，整条消息照发', async () => {
  const { bot, sent } = fakeBot(['text', 'voice'])
  const wrapped = wrapAdapterBot(bot, {
    allowed: () => true,
    log: () => {},
    speak: async () => { throw new Error('TTS 没配') },
  })
  await wrapped.sendMessage('c1', '<voice>念不出来</voice>')
  assert.equal(sent.length, 1)
  assert.equal(toText(sent[0].content), '念不出来')
})

test('未知标签整块丢掉，不把半截 XML 当文字发出去', async () => {
  const { bot, sent } = fakeBot(['text'])
  const wrapped = wrapAdapterBot(bot, { allowed: () => true, log: () => {} })
  await wrapped.sendMessage('c1', '</acp>\n你好啊，又见面了')
  const text = toText(sent[0].content)
  assert.equal(text.trim(), '你好啊，又见面了')
  assert.doesNotMatch(text, /acp/i, '别的框架的标签不能漏进消息')
})
