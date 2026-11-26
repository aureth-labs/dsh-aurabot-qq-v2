// 管线出错要「跳过但不静默」：onError 收到段名和原始错误。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pipeline } from '../src/core/pipeline/index.ts'

/** 最小会话：中间件会调 send，给它一个空实现。 */
const sessionOf = (content) => ({ content, sent: [], async send(text) { this.sent.push(text) } })

test('中间件抛错：跳过这一段继续往后，onError 收到它的名字', async () => {
  const seen = []
  const pipeline = new Pipeline({ onError: (info) => seen.push(info) })
  pipeline.use(async () => { throw new Error('中间件炸了') }, { name: 'boom' })
  pipeline.use(async (session, next) => { await session.send('第二个中间件处理了') })

  const result = await pipeline.dispatch(sessionOf('随便说点什么'))
  assert.equal(result.handled, true)
  assert.equal(result.by, 'middleware')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].stage, 'boom')
  assert.match(String(seen[0].error.message), /中间件炸了/)
})

test('指令抛错：照样记到 onError，并返回 error 文本', async () => {
  const seen = []
  const pipeline = new Pipeline({ onError: (info) => seen.push(info) })
  pipeline.command('坏指令', async () => { throw new Error('指令失败') })

  const result = await pipeline.dispatch({ content: '坏指令' })
  assert.equal(result.handled, true)
  assert.equal(result.by, 'command')
  assert.match(result.error, /指令失败/)
  assert.equal(seen[0].stage, 'command')
})

test('onError 自己抛错也不影响管线', async () => {
  const pipeline = new Pipeline({ onError: () => { throw new Error('回调炸了') } })
  pipeline.use(async () => { throw new Error('中间件炸了') }, { name: 'boom' })
  pipeline.use(async (session, next) => { await session.send('还是走到了这里') })

  const result = await pipeline.dispatch(sessionOf('喂'))
  assert.equal(result.by, 'middleware')
})

test('中间件发过消息才炸：按已消费收口，不再交给模型', async () => {
  const seen = []
  const pipeline = new Pipeline({ onError: (info) => seen.push(info) })
  const session = sessionOf('喂')

  session.sentCount = 0
  session.send = async function (text) {
    this.sentCount = (this.sentCount || 0) + 1
    this.sent.push(text)
    throw new Error('网关没连')
  }

  pipeline.use(async (sess) => { await sess.send('先回一句') }, { name: 'boom' })
  pipeline.use(async (sess, next) => { await sess.send('第二个中间件不该跑到'); return next() })
  pipeline.onLlm(async () => '模型不该被调用')

  const result = await pipeline.dispatch(session)

  assert.equal(result.handled, true)
  assert.equal(result.by, 'middleware')
  assert.match(result.error, /网关没连/)
  assert.deepEqual(session.sent, ['先回一句'], '只发出认领的那一条，后面的中间件和模型都不动')
  assert.equal(seen[0].stage, 'boom')
})

test('中间件没发消息就炸：仍然跳过它继续往后（失败隔离不变）', async () => {
  const pipeline = new Pipeline()
  pipeline.use(async () => { throw new Error('还没发就炸了') }, { name: 'boom' })
  pipeline.use(async (sess) => { await sess.send('后面这个接手') })

  const result = await pipeline.dispatch(sessionOf('喂'))

  assert.equal(result.by, 'middleware')
  assert.equal(result.error, undefined)
})
