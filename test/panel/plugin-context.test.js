// S1 契约：v1 的 api 一行不改照样用；v2 的 ctx 只是别名视图。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPluginContext } from '../../src/core/module/context/plugin-context.ts'
import { checkDef } from '../../src/core/module/index.ts'
import { Pipeline } from '../../src/core/pipeline/index.ts'
import { Session } from '../../src/core/pipeline/session.ts'

function fakeApi() {
  const calls = []
  const api = {
    id: 'demo',
    every: (ms, fn, label) => {
      calls.push({ kind: 'every', ms, label })
      return () => calls.push({ kind: 'off-every' })
    },
    later: (ms, fn) => {
      calls.push({ kind: 'later', ms })
      return () => calls.push({ kind: 'off-later' })
    },
    onDispose: (fn) => {
      calls.push({ kind: 'dispose', fn })
      return () => calls.push({ kind: 'off-dispose' })
    },
    on: (event) => {
      calls.push({ kind: 'on', event })
      return () => {}
    },
    settings: () => ({ enabled: true }),
    send: (chatId, text) => calls.push({ kind: 'send', chatId, text }),
  }
  return { api, calls }
}

test('ctx 保留 v1 的全部字段', () => {
  const { api } = fakeApi()
  const ctx = createPluginContext(api)
  assert.equal(ctx.id, 'demo')
  assert.equal(typeof ctx.send, 'function')
  ctx.send('group:1', 'hi')
})

test('setInterval / setTimeout 走 v1 的 every / later', () => {
  const { api, calls } = fakeApi()
  const ctx = createPluginContext(api)
  const off = ctx.setInterval(5000, () => {}, '巡检')
  ctx.setTimeout(300, () => {})
  assert.deepEqual(calls[0], { kind: 'every', ms: 5000, label: '巡检' })
  assert.deepEqual(calls[1], { kind: 'later', ms: 300 })
  off()
  assert.deepEqual(calls[2], { kind: 'off-every' })
})

test('effect 接函数和带 dispose 的对象都进卸载队列', () => {
  const { api, calls } = fakeApi()
  const ctx = createPluginContext(api)
  ctx.effect(() => {})
  let disposed = false
  ctx.effect({ dispose: () => { disposed = true } })
  assert.equal(calls.filter((c) => c.kind === 'dispose').length, 2)
  calls[1].fn()
  assert.equal(disposed, true)
})

test("on('dispose') 归到卸载队列，其它事件照旧", () => {
  const { api, calls } = fakeApi()
  const ctx = createPluginContext(api)
  ctx.on('dispose', () => {})
  ctx.on('module/start', () => {})
  assert.equal(calls[0].kind, 'dispose')
  assert.deepEqual(calls[1], { kind: 'on', event: 'module/start' })
})

test('入口校验：v1 setup / v2 apply / 裸函数三种都认', () => {
  assert.equal(checkDef({ id: 'demo', setup() {} }, 'demo'), '')
  assert.equal(checkDef({ id: 'demo', apply() {} }, 'demo'), '')
  assert.equal(checkDef(function apply() {}, 'demo'), '')
  assert.match(checkDef({ id: 'demo' }, 'demo'), /setup\(api\) 或 apply/)
  assert.match(checkDef({ setup() {} }, ''), /模块 id/)
  assert.equal(checkDef(null, 'demo'), '入口文件要 export default 一个对象或 apply 函数（看 API.md）')
})

test('ctx.command / ctx.middleware 挂到管线，卸载时一起摘掉', async () => {
  const { api, calls } = fakeApi()
  const pipeline = new Pipeline()
  const ctx = createPluginContext(api, { pipeline })
  ctx.command('ping', async (session, args) => ({ pong: args }))
  ctx.middleware(async (session, next) => {
    if (session.content === 'mw') return 'hit'
    return next()
  })
  assert.deepEqual(pipeline.order(), ['command', 'mw-1', 'llm'])

  const byCommand = await pipeline.dispatch({ content: '/ping 1' })
  assert.equal(byCommand.by, 'command')
  assert.deepEqual(byCommand.value, { pong: '1' })

  const byMw = await pipeline.dispatch({ content: 'mw' })
  assert.equal(byMw.by, 'middleware')

  // 模块卸载：onDispose 收到的就是卸载函数
  for (const c of calls.filter((c) => c.kind === 'dispose')) c.fn()
  assert.deepEqual(pipeline.order(), ['command', 'llm'])
  assert.equal((await pipeline.dispatch({ content: 'mw' })).handled, false)
})

test('session.execute 保留 Session 原型，send 还能用', async () => {
  const sent = []
  const bot = {
    id: 'onebot', platform: 'qq', selfId: '10000', status: 'online',
    sendMessage: async (chatId, content) => sent.push(['group', chatId, content]),
    sendPrivateMessage: async (userId, content) => sent.push(['private', userId, content]),
    supports: () => true,
  }
  const pipeline = new Pipeline()
  const session = new Session({ bot, type: 'group', channelId: '123', userId: '1', content: '' , pipeline })
  pipeline.command('echo', async (s, args) => {
    await s.send(args)
    return args
  })
  const r = await session.execute('/echo 你好')
  assert.deepEqual(r.value, '你好')
  assert.deepEqual(sent, [['group', '123', '你好']])
})

test('ctx.command 双签名：字符串走管线，对象形态还给 v1 的 api.command', async () => {
  const calls = []
  const api = {
    command: (definition) => { calls.push(['v1-command', definition.name]); return () => {} },
    onDispose: () => () => {},
    settings: () => ({}),
  }
  const pipeline = new Pipeline()
  const ctx = createPluginContext(api, { pipeline })
  ctx.command({ name: 'ai-tool', run: async () => 'ok' })
  ctx.command('local', async () => 'hit')
  assert.deepEqual(calls, [['v1-command', 'ai-tool']])
  assert.deepEqual(pipeline.order(), ['command', 'llm'])
  assert.equal((await pipeline.dispatch({ content: '/local' })).by, 'command')
})
