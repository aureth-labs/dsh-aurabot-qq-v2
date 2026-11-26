// `<voice>文字</voice>` 出站：有 TTS 就换成音频，没有就降级成文字。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h, toText } from '../src/core/message/element/element.ts'
import { hasVoiceText, needsVoiceResolve, resolveVoice } from '../src/core/message/element/voice-element.ts'

test('<voice>文字</voice> 解析成带正文的 voice 元素', () => {
  const tree = h.parse('<voice>说话语音啦</voice>')
  assert.equal(tree.length, 1)
  assert.equal(tree[0].type, 'voice')
  assert.equal(toText(tree[0].children), '说话语音啦')
})

test('自闭合的 <voice url="…"/> 保持空元素', () => {
  const tree = h.parse('<voice url="file:///a.mp3"/>')
  assert.deepEqual(tree, [{ type: 'voice', attrs: { url: 'file:///a.mp3' } }])
})

test('resolveVoice 把文字换成合成出来的地址', async () => {
  const spoken = []
  const out = await resolveVoice('<text>给你</text><voice>念这句</voice>', async (text) => {
    spoken.push(text)
    return 'file:///tmp/voice.mp3'
  })

  assert.deepEqual(spoken, ['念这句'])
  const voice = out.find((element) => element.type === 'voice')
  assert.equal(voice.attrs.url, 'file:///tmp/voice.mp3')
})

test('已经有地址的 voice 不再合成', async () => {
  let calls = 0
  const out = await resolveVoice(h.voice('file:///ready.mp3'), async () => {
    calls++
    return 'file:///other.mp3'
  })
  assert.equal(calls, 0)
  assert.equal(out[0].attrs.url, 'file:///ready.mp3')
})

test('合成失败降级成文字，并记一条 warn', async () => {
  const warnings = []
  const out = await resolveVoice('<voice>念不出来</voice>', async () => {
    throw new Error('语音模块关着')
  }, { warn: (...args) => warnings.push(args.join(' ')) })

  assert.deepEqual(out, [{ type: 'text', attrs: { content: '念不出来' } }])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /语音模块关着/)
})

test('只有真的可能有 voice 块时才进合成，普通文本一次都不碰', async () => {
  assert.equal(hasVoiceText('普通的一句话'), false)
  assert.equal(hasVoiceText('要不要听 <voice>这句</voice>'), true)
  assert.equal(needsVoiceResolve('普通的一句话'), false)
  assert.equal(needsVoiceResolve([h.text('普通')]), false)
  assert.equal(needsVoiceResolve([h('voice', {})]), true)
})
