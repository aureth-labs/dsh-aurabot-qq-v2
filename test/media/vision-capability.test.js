// 聊天图片直接投递，后台显式选择的模型仍可查询能力。
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const { modelVision, canSeeImages, clearVisionCache } = await import('../../src/core/llm/index.ts')

const stub = (resolveModelInfo) => ({ llm: { resolveModelInfo }, get: () => null })

test('模型能力探测：支持 / 不支持 / 宿主没说', async () => {
  clearVisionCache()
  assert.equal(await modelVision(stub(async () => ({ inputModalities: ['text', 'image'] })), 'p', 'm'), true, '声明了 image')
  clearVisionCache()
  assert.equal(await modelVision(stub(async () => ({ inputModalities: ['text'] })), 'p', 'm'), false, '只声明了 text')
  clearVisionCache()
  assert.equal(await modelVision(stub(async () => ({})), 'p', 'm'), null, '没声明 → 不知道')
  clearVisionCache()
  assert.equal(await modelVision(stub(async () => { throw new Error('boom') }), 'p', 'm'), null, '探测失败 → 不知道')
  clearVisionCache()
  assert.equal(await modelVision({ get: () => null }, 'p', 'm'), null, '没有 llm 服务 → 不知道')
})

test('canSeeImages 用当前设置里的模型', async () => {
  clearVisionCache()
  const dsh = stub(async (p, m) => ({ inputModalities: m === 'see' ? ['text', 'image'] : ['text'] }))
  assert.equal(await canSeeImages(dsh, { model: { provider: 'p', model: 'blind' } }), false)
  assert.equal(await canSeeImages(dsh, { model: { provider: 'p', model: 'see' } }), true)
  assert.equal(await canSeeImages(dsh, { model: {} }), null, '没配模型 → 不知道')
})

test('后台单独选的视觉模型读取宿主元数据', async () => {
  clearVisionCache()
  const dsh = stub(async (_provider, id) => ({ inputModalities: id === 'caption' ? ['text', 'image'] : ['text'] }))
  assert.equal(await canSeeImages(dsh, { model: { provider: 'p', model: 'chat' } }, { provider: 'p', model: 'caption' }), true)
})

const dataDir = mkdtempSync(join(tmpdir(), 'aurabot-vision-'))
process.env.AURABOT_DATA_DIR = dataDir
process.env.AURABOT_WORKSPACE = join(dataDir, 'ws')
mkdirSync(dataDir, { recursive: true })

const OWNER = '10000001'
const BOT = '20000002'
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  enabled: true, dryRun: true, setupDone: true, botQQ: BOT, ownerQQ: OWNER,
  model: { provider: 'p', model: 'blind', reasoningEffort: '' },
  allow: { private: [], groups: [] },
  onebot: {},
  voice: { enabled: false }, merge: { enabled: false },
}))

const PNG = (() => {
  const b = Buffer.alloc(64)
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[7] = 0x0a
  b.writeUInt32BE(64, 16); b.writeUInt32BE(64, 20)
  return b
})()

// 模拟视觉类扩展：钩子里记下收到几张图
const peekDir = join(dataDir, 'modules', 'peek')
mkdirSync(peekDir, { recursive: true })
writeFileSync(join(peekDir, 'index.ts'), `export const name = 'peek'
export function apply(ctx) {
  ctx.on('prompt', content => { globalThis.__peekImages = content.filter(block => block.type === 'image').length })
}`)

const { createFakeDsh } = await import(`file:///${REPO}/test/helpers/fake-dsh.js`)
const fake = createFakeDsh({ brain: async () => '我看见啦' })
// 让宿主能回答「这个模型支不支持图片」
fake.ctx.llm.resolveModelInfo = async (p, m) => ({ inputModalities: m === 'see' ? ['text', 'image'] : ['text'] })
const host = await import(`file:///${REPO}/packages/app/index.ts`)
const api = host.apply(fake.ctx)
await api.ready
await new Promise((r) => setTimeout(r, 400))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const sendImage = async () => {
  await api.hub.onMessage({
    post_type: 'message', message_type: 'private', sub_type: 'friend',
    self_id: Number(BOT), user_id: Number(OWNER), time: Math.floor(Date.now() / 1000),
    message_id: Math.floor(Math.random() * 1e6),
    message: [{ type: 'image', data: { sub_type: 0, file: 'base64://' + PNG.toString('base64') } }],
    sender: { user_id: Number(OWNER), nickname: '主人' },
  })
  await wait(1500)
}

test('聊天模型直接得到图片，旧的视觉开关不改写发言', async () => {
  await sendImage()
  assert.equal(fake.turns.at(-1).images, 1)
})

test('模型支持看图：图片照常交给她', async () => {
  api.setConfig({ ...api.getConfig(), model: { provider: 'p', model: 'see', reasoningEffort: '' } })
  clearVisionCache()
  await sendImage()
  assert.equal(fake.turns.at(-1).images, 1, '支持看图就该拿到图')
})

after(() => fake.dispose())

test('关闭接收图片时，同一消息仍触发文字回合', async () => {
  api.setConfig({ ...api.getConfig(), media: { receiveImages: false } })
  await sendImage()
  assert.equal(fake.turns.at(-1).images, 0)
})
