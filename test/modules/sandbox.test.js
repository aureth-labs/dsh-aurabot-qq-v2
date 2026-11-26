// 聊天沙盒：服务端 + Satori 适配器 + 网页那一路的收发，全走真实实现。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxServer } from '../../packages/sandbox/server.ts'
import { startAdapter } from '../../src/core/bot/adapter/contract.ts'
import { BotRegistry } from '../../src/core/bot/instance/registry.ts'
import { satoriAdapter } from '../../packages/adapters/satori/src/index.ts'

const sandboxModule = (await import('../../packages/sandbox/index.ts')).default

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待超时')
}

const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('聊天沙盒：网页发消息进适配器，机器人回复回到网页', async (t) => {
  const server = createSandboxServer({ port: 0, token: 'sandbox-token', platform: 'sandbox' })
  await server.start()
  const registry = new BotRegistry()
  const inbound = []
  let handle = null
  t.after(async () => {
    await handle?.dispose().catch(() => {})
    await server.close()
  })

  handle = await startAdapter(
    registry,
    satoriAdapter(),
    { endpoint: server.url, token: 'sandbox-token', platform: 'sandbox' },
    { platform: 'sandbox', log: () => {}, emitMessage: (message) => inbound.push(message) },
  )
  assert.equal(handle.bot.id, 'sandbox-bot')
  assert.equal(handle.bot.status, 'online')

  const sent = await postJson(`${server.url}/_sandbox/send`, { text: '你好', kind: 'group', userName: '小明', userId: 'u1' })
  assert.equal(sent.status, 200)
  const message = await waitFor(() => inbound[0])
  assert.equal(message.type, 'group')
  assert.equal(message.channelId, 'sandbox-1')
  assert.equal(message.userId, 'u1')
  assert.equal(message.content, '你好')

  await handle.bot.sendMessage('sandbox-1', '<text>收到啦</text>')
  const state = await waitFor(async () => {
    const data = await fetch(`${server.url}/_sandbox/state`).then((r) => r.json())
    return data.messages.some((m) => m.direction === 'out' && m.content.includes('收到啦')) ? data : null
  })
  assert.ok(state.messages.length >= 2)

  await postJson(`${server.url}/_sandbox/send`, { text: '私聊你', kind: 'private', userName: '小红', userId: 'u9' })
  const dm = await waitFor(() => inbound[1])
  assert.equal(dm.type, 'private')
  assert.equal(dm.channelId, 'dm-u9')
  assert.equal(dm.content, '私聊你')

  await handle.bot.sendPrivateMessage('u9', '私聊回复')
  await waitFor(async () => {
    const data = await fetch(`${server.url}/_sandbox/state`).then((r) => r.json())
    return data.messages.some((m) => m.direction === 'out' && m.channelId === 'dm-u9')
  })
})

test('聊天沙盒：令牌不对就连不上', async (t) => {
  const server = createSandboxServer({ port: 0, token: 'right' })
  await server.start()
  t.after(() => server.close())
  const registry = new BotRegistry()
  await assert.rejects(() => startAdapter(
    registry,
    satoriAdapter(),
    { endpoint: server.url, token: 'wrong' },
    { platform: 'sandbox', log: () => {}, emitMessage: () => {} },
  ), /READY|超时|断开|登录/)
})

test('聊天沙盒：网页能拿到状态', async (t) => {
  assert.equal(sandboxModule.id, 'sandbox')
  assert.equal(sandboxModule.defaults.sandbox, undefined)
  assert.equal(sandboxModule.defaults.port, 5140)
  const server = createSandboxServer({ port: 0 })
  await server.start()
  t.after(() => server.close())
  const page = await fetch(`${server.url}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /聊天沙盒/)
  const state = await fetch(`${server.url}/_sandbox/state`).then((r) => r.json())
  assert.equal(state.ok, true)
  assert.ok(state.channels.some((c) => c.id === 'sandbox-1'))
})
