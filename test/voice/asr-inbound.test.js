import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply } from '../../packages/modules/asr/index.ts'
import { buildWav } from '../../src/core/message/media/wav.ts'
import { h, toText } from '../../src/core/message/element/element.ts'

test('语音归档并转写，拒绝越界文件和过期识别结果', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-asr-'))
  const previous = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = root
  t.after(() => {
    if (previous === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  })
  const audio = buildWav(new Int16Array(400), 16000)
  let entered = 0, cleanup, hook
  const bot = { platform: 'mock', id: 'bot', selfId: 'self' }
  const stt = { resolve: spec => spec, transcribe: async spec => {
    assert.deepEqual(Buffer.from(spec.audio), audio)
    entered++
    return '明天是周五'
  } }
  const ctx = { root: { config: { voice: { asr: true }, local: {}, enabled: true } }, config: { enabled: true },
    bots: { get: () => bot }, host: {}, harness: { get: () => stt }, logger: { debug() {} },
    effect: fn => { cleanup = fn }, provide() {}, get() {}, on: (name, fn) => { assert.equal(name, 'before-parse'); hook = fn } }
  apply(ctx)
  const draft = url => ({ platform: bot.platform, botId: bot.id, type: 'private', userId: 'listener', elements: [h.voice(url)] })
  const url = 'data:audio/wav;base64,' + audio.toString('base64')
  const first = draft(url)
  await hook(first)
  const el = first.elements[0]
  assert.equal(el.children[0].type, 'translateVoice')
  assert.equal(toText(h.parse(h.stringify(el))), '明天是周五')
  assert.deepEqual(readFileSync(fileURLToPath(el.attrs.url)), audio)
  await hook(draft(el.attrs.url))
  assert.equal(readdirSync(join(root, 'media', 'voice')).length, 1)
  writeFileSync(join(root, 'outside.wav'), audio)
  const outside = draft(pathToFileURL(join(root, 'outside.wav')).href)
  await hook(outside)
  assert.match(toText(outside.elements), /未能识别/)
  assert.equal(entered, 2)
  ctx.root.config.voice.asr = false
  const disabled = draft(url)
  await hook(disabled)
  assert.deepEqual(disabled.elements, [h.voice(url)])
  ctx.root.config.voice.asr = true
  stt.transcribe = async () => { cleanup(); return '已卸载的结果' }
  await hook(disabled)
  assert.deepEqual(disabled.elements, [h.voice(url)])
})
