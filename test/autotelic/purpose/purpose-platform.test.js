import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../../../packages/modules/purpose/index.ts'
import { apply as chatBridge } from '../../../packages/modules/chat-bridge/index.ts'
import { openOwnerChannel } from '../../../packages/modules/purpose/owners.ts'
import { normalize } from '../../../src/core/config/index.ts'
import { isOwnerOf } from '../../../src/core/config/owners.ts'

test('主人私聊按平台、机器人登录身份及人格投递，失效的生成与工具不能沿用', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-purpose-platform-'))
  const previous = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  const disposers = []
  t.after(() => {
    for (const fn of disposers.reverse()) fn()
    if (previous === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
  const bob = { platform: 'telegram', botId: 'work', type: 'private', id: '1234' }
  const alice = { ...bob, platform: 'qq', botId: 'other' }
  const targets = [bob, alice]
  const cfg = normalize({ enabled: true, owners: targets.map(t => ({ ...t, userId: t.id })),
    speakUp: { reminderEnabled: true }, ext: { purpose: { enabled: true, minMaterials: 0 } } })
  const bots = targets.map(t => ({ platform: t.platform, id: t.botId, selfId: t.botId + '-login', status: 'online' }))
  const services = new Map(), sent = [], prompts = []
  let tools, during, answer = '排练顺利吗？\n【目的】私人备忘'
  const card = { id: '', name: '小羽', body: '你喜欢听音乐。' }
  const ctx = {
    config: { enabled: true, history: 15 }, root: { config: cfg, read: () => cfg, update() {} },
    host: { personas: { current: () => card.body }, hub: {} }, bots: { list: () => bots, get: (id, p) => bots.find(b => b.id === id && b.platform === p) },
    isOwner: (...args) => isOwnerOf(cfg, ...args), dataDir: file => join(dir, file),
    get: name => services.get(name), require: name => services.get(name), provide: (k, v) => services.set(k,v),
    effect: fn => disposers.push(fn), logger: { info() {}, warn() {}, debug() {} },
    on() {}, prompt() {}, setInterval() {}, tool: factory => { tools = factory }, server: { get() {}, post() {} },
    llm: { generate: async prompt => { prompts.push(prompt); await during?.(); return answer } },
    sendTo: async (target, el) => { sent.push({ target, text: el.attrs.content }); return { id: 'sent' } },
  }
  services.set('persona', { current: () => card })
  chatBridge(ctx)
  const timeline = services.get('room-timeline')
  const say = (target, text) => timeline.record(target, ctx.bots.get(target.botId, target.platform).selfId, card.id,
    { role: 'user', speaker: '主人', text, at: Date.now() })
  say(bob, '明天要第一次上台演出，有点紧张。')
  say(alice, '保密的另一场音乐会')
  const purpose = apply(ctx)
  assert.equal((await purpose.fire()).outcome, 'select-owner')
  assert.deepEqual(purpose.targets(), targets)
  assert.equal((await purpose.fire('手动', bob)).outcome, 'sent')
  assert.deepEqual(sent, [{target: bob, text: '排练顺利吗？'}])
  assert.match(prompts[0].text, /第一次上台/)
  assert.doesNotMatch(prompts[0].text, /保密的另一场音乐会/)
  assert.equal(timeline.read(bob, bots[0].selfId, card.id).messages.at(-1).text, sent[0].text)

  const where = { target: bob, chat: { kind: 'private', userId: bob.id } }
  const list = tools(where).find(t => t.name === 'purpose_list_reminders')
  const aliceEngine = purpose.select(alice)
  assert.deepEqual(await list.execute({}), [])
  assert.deepEqual(tools({ ...where, target: { ...bob, id: 'another' } }), [])
  assert.deepEqual(tools({ ...where, target: { ...bob, type: 'group' } }), [])

  answer = '[沉默]'
  assert.equal((await purpose.fire('手动', bob)).outcome, 'silent')
  answer = '过期的草稿'
  const generateDraft = async () => {
    const channel = openOwnerChannel(ctx, bob, bots[0], () => true)
    const raw = await channel.generate('准备发言')
    return channel.send(raw)
  }
  during = () => say(bob, '已经演完啦。')
  assert.equal(await generateDraft(), false)
  during = () => { cfg.persona.current = 'other-card' }
  assert.equal(await generateDraft(), false)
  cfg.persona.current = ''
  during = () => { bots[0].selfId = 'new-login' }
  assert.equal(await generateDraft(), false)
  assert.deepEqual(timeline.read(bob, 'new-login', card.id).messages, [])
  assert.equal((await list.execute({})).ok, false)
  assert.equal(purpose.select(alice), aliceEngine)
  during = () => { cfg.owners = cfg.owners.filter(owner => owner.platform !== 'telegram') }
  say(bob, '换号后的单独会话。')
  assert.equal(await generateDraft(), false)
  assert.equal(sent.length, 1)
})
