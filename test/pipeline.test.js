// S5 契约：command → middleware → llm，消费语义与失败隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pipeline } from '../src/core/pipeline/index.ts'
import { Session } from '../src/core/pipeline/session.ts'

const s = (content) => ({ content })

/** 真 Session + 记账 bot：execute 要验的就是「真实例复制」，用假对象测不出来。 */
function realSession(pipeline, { type = 'group', content = '' } = {}) {
  const sent = []
  const bot = {
    platform: 'onebot',
    selfId: '10000',
    async sendMessage(channelId, text) {
      sent.push({ kind: 'group', channelId, text })
    },
    async sendPrivateMessage(userId, text) {
      sent.push({ kind: 'private', userId, text })
    },
  }
  const session = new Session({ bot, type, channelId: 'g1', userId: 'u1', content, pipeline })
  return { session, sent }
}

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

test('session.execute 复制出真实例会话：中间件照常拦、照常发', async () => {
  const p = new Pipeline()
  p.use(async (session, next) => {
    const hit = /\b(BV[0-9A-Za-z]{10})\b/.exec(String(session.content || ''))
    if (!hit) return next()
    await session.send(`bili:${hit[1]}`)
  }, { name: 'bv-parse', before: 'llm' })
  p.onLlm(() => 'llm-reply')

  const { session, sent } = realSession(p, { content: '' })
  const r = await session.execute('BV1xx411c7mD 看看这个')

  // 中间件认领了这条消息，不落到模型段
  assert.equal(r.by, 'middleware')
  assert.deepEqual(sent, [{ kind: 'group', channelId: 'g1', text: 'bili:BV1xx411c7mD' }])
  // 发的是复制出来的会话，原会话的计数不该被改写
  assert.equal(session.sentCount, 0)
})

test('session.execute 递归限一层：handler 里再 execute 直接拒绝', async () => {
  const p = new Pipeline()
  const { session } = realSession(p, { content: '/outer' })
  let inner
  p.command('outer', async (sess) => {
    inner = await sess.execute('inner')
    return 'outer-done'
  })
  p.command('inner', () => 'inner-done')

  const r = await session.execute('outer')
  assert.equal(r.by, 'command')
  assert.equal(r.value, 'outer-done')
  assert.equal(inner.handled, false)
  assert.match(inner.error, /递归/)
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
