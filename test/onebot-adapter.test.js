// QQ · OneBot v11 适配器 spec：网关没连上不许假装上线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOneBotV11Spec } from '../src/adapters/qq/onebot-v11/index.ts'

test('网关没连上：connect 抛错', async () => {
  const spec = createOneBotV11Spec({ call: async () => ({}), isConnected: () => false })
  await assert.rejects(() => spec.connect({}, { platform: 'qq', log: () => {} }), /还没连上/)
  assert.equal(spec.platform, 'qq')
  assert.equal(spec.name, 'QQ（OneBot v11）')
})

test('网关就绪：connect 返回已上线的 bot，disconnect 让它离线', async () => {
  const calls = []
  let connected = true
  const spec = createOneBotV11Spec({
    call: async (action, params) => {
      calls.push({ action, params })
      return { ok: true }
    },
    isConnected: () => connected,
    selfId: '1787850032',
  })

  const bot = await spec.connect({}, { platform: 'qq', log: () => {} })
  assert.equal(bot.status, 'online')
  assert.equal(bot.id, '1787850032')

  await bot.sendMessage('123456', '你好')
  assert.deepEqual(calls[0], { action: 'send_group_msg', params: { group_id: '123456', message: '你好' } })

  await spec.disconnect(bot, {})
  assert.equal(bot.status, 'offline')
  connected = false
})
