// S5 契约：command → middleware → llm，消费语义与失败隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pipeline } from '../src/core/pipeline.ts'

const s = (content) => ({ content })

test('没人接手 → 进模型段', async () => {
  const p = new Pipeline()
  p.onLlm((session) => `llm:${session.content}`)
  const r = await p.dispatch(s('你好'))
  assert.deepEqual(r, { handled: true, by: 'llm', value: 'llm:你好' })
})

test('中间件 return 不调 next = 消费掉，模型段不跑', async () => {
  const p = new Pipeline()
  let llmRan = false
  p.onLlm(() => { llmRan = true })
  p.use(async (session) => `bili:${session.content}`)
  const r = await p.dispatch(s('BV1xx'))
  assert.equal(r.by, 'middleware')
  assert.equal(r.value, 'bili:BV1xx')
  assert.equal(llmRan, false)
})

test('return next() 继续往下传', async () => {
  const p = new Pipeline()
  const seen = []
  p.use(async (session, next) => { seen.push('a'); return next() }, { name: 'a' })
  p.use(async (session, next) => { seen.push('b'); return next() }, { name: 'b' })
  p.onLlm(() => 'llm')
  const r = await p.dispatch(s('x'))
  assert.deepEqual(seen, ['a', 'b'])
  assert.equal(r.value, 'llm')
})

test('指令先匹配：默认消费后不进中间件', async () => {
  const p = new Pipeline()
  const seen = []
  p.command('tell', (session, args) => `tell:${args}`)
  p.use(async () => { seen.push('mw') })
  p.onLlm(() => 'llm')
  const r = await p.dispatch(s('/tell 主人的插件坏了'))
  assert.equal(r.by, 'command')
  assert.equal(r.value, 'tell:主人的插件坏了')
  assert.deepEqual(seen, [])
})

test('middlewareAfterCommand 打开后指令也继续走中间件', async () => {
  const p = new Pipeline({ middlewareAfterCommand: true })
  const seen = []
  p.command('tell', () => 'ok')
  p.use(async () => { seen.push('mw') })
  await p.dispatch(s('/tell hi'))
  assert.deepEqual(seen, ['mw'])
})

test('前缀：默认无前缀和 / 都认', async () => {
  const p = new Pipeline()
  p.command('echo', () => 'echo')
  assert.equal((await p.dispatch(s('echo hi'))).by, 'command')
  assert.equal((await p.dispatch(s('/echo hi'))).by, 'command')
  assert.equal((await p.dispatch(s('随便说点什么'))).by, null)
})

test('同名指令带前缀和无前缀都能命中，参数原样保留', async () => {
  const p = new Pipeline()
  let got = ''
  p.command('tell', (session, args) => { got = args; return 'ok' })
  await p.dispatch(s('tell  a   b '))
  assert.equal(got, 'a   b')
  await p.dispatch(s('/tell x y'))
  assert.equal(got, 'x y')
})

test('before / after 定位顺序', async () => {
  const p = new Pipeline()
  const seen = []
  p.use(async (session, next) => { seen.push('mid'); return next() }, { name: 'mid' })
  p.use(async (session, next) => { seen.push('first'); return next() }, { name: 'first', before: 'mid' })
  p.use(async (session, next) => { seen.push('last'); return next() }, { name: 'last', after: 'mid' })
  p.onLlm(() => 'llm')
  await p.dispatch(s('x'))
  assert.deepEqual(seen, ['first', 'mid', 'last'])
  assert.deepEqual(p.order(), ['command', 'first', 'mid', 'last', 'llm'])
})

test('中间件抛错默认跳过，后面的照常跑', async () => {
  const p = new Pipeline()
  const seen = []
  p.use(async () => { throw new Error('boom') }, { name: 'bad' })
  p.use(async (session, next) => { seen.push('after'); return next() }, { name: 'ok' })
  p.onLlm(() => 'llm')
  const r = await p.dispatch(s('x'))
  assert.deepEqual(seen, ['after'])
  assert.equal(r.by, 'llm')
})

test('onError: throw 时错误冒出来', async () => {
  const p = new Pipeline()
  p.use(async () => { throw new Error('boom') }, { onError: 'throw' })
  await assert.rejects(() => p.dispatch(s('x')), /boom/)
})

test('超时按 skip 处理，不卡住整条管线', async () => {
  const p = new Pipeline()
  const seen = []
  p.use(() => new Promise(() => {}), { timeoutMs: 30, name: 'slow' })
  p.use(async (session, next) => { seen.push('next'); return next() }, { name: 'fast' })
  p.onLlm(() => 'llm')
  const r = await p.dispatch(s('x'))
  assert.deepEqual(seen, ['next'])
  assert.equal(r.by, 'llm')
})

test('session.execute 走完整管线并真的发出，递归限一层', async () => {
  const p = new Pipeline()
  const sent = []
  const session = { content: '', send: async (t) => sent.push(t) }
  p.command('tell', async (sess, args) => {
    await sess.send(`【转告】${args}`)
    return 'sent'
  })

  const r = await p.execute(session, '/tell 主人的插件坏了')
  assert.equal(r.by, 'command')
  assert.deepEqual(sent, ['【转告】主人的插件坏了'])

  // execute 里再 execute：拒绝
  const inner = await p.execute({ ...session, nested: true }, 'tell x')
  assert.equal(inner.by, 'command')
})

test('卸载中间件与指令', async () => {
  const p = new Pipeline()
  const offMw = p.use(async () => 'handled', { name: 'x' })
  const offCmd = p.command('echo', () => 'ok')
  assert.equal((await p.dispatch(s('/echo'))).by, 'command')
  offCmd()
  assert.equal((await p.dispatch(s('/echo'))).by, 'middleware')
  offMw()
  assert.equal((await p.dispatch(s('/echo'))).by, null)
})

test('中间件重名直接报错', () => {
  const p = new Pipeline()
  p.use(async () => {}, { name: 'dup' })
  assert.throws(() => p.use(async () => {}, { name: 'dup' }), /重复/)
})
