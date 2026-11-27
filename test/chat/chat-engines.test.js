import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatEngines } from '../../packages/app/runtime/chat-engine.ts'
import { roomKey, useLegacyRooms } from '../../src/core/bot/room.ts'

test('每个机器人一个对话引擎，按房间键和会话路由', () => {
  const off = useLegacyRooms('qq', 'adapter-qq-onebot-v11')
  const qq = { platform: 'qq', id: 'adapter-qq-onebot-v11', selfId: '1', status: 'online' }
  const tg = { platform: 'telegram', id: 'work', selfId: 'tg-bot', status: 'online' }
  const bots = [qq, tg]
  const made = []
  const create = (bot, primary) => {
    const calls = []
    const hub = {
      bot, primary, calls,
      sendText: (chatId, text) => { calls.push(['send', chatId, text]); return true },
      onMessage: (session) => calls.push(['in', session.userId]),
      chatOfSession: (id) => id === `${bot().platform}-s` ? 'x' : '',
      turnSendersAllOwner: (id) => { calls.push(['owner', id]); return primary },
      onSessionEvent: () => calls.push(['event']),
      busy: () => false, dispose: () => calls.push(['dispose']),
    }
    made.push(hub)
    return hub
  }
  const engines = createChatEngines({ registry: { get: (id, platform) => bots.find(b => b.id === id && b.platform === platform) }, primaryId: qq.id, create, log: { info () {} } })
  const hub = engines.router
  hub.sendText('private:42', 'hi')
  const tgRoom = roomKey({ platform: 'telegram', botId: 'work', type: 'private', id: '7' })
  assert.equal(tgRoom, 'private:7#telegram/work')
  hub.sendText(tgRoom, 'yo')
  hub.onMessage({ bot: tg, userId: '7' })
  assert.equal(made.length, 2)
  assert.deepEqual(made[0].calls, [['send', 'private:42', 'hi']])
  assert.deepEqual(made[1].calls, [['send', tgRoom, 'yo'], ['in', '7']])
  assert.equal(hub.turnSendersAllOwner('telegram-s'), false)
  assert.equal(hub.turnSendersAllOwner('qq-s'), true)
  hub.onSessionEvent({ id: 'z' }, {})
  assert.equal(made.every(h => h.calls.some(c => c[0] === 'event')), true)
  hub.dispose()
  assert.equal(made.every(h => h.calls.some(c => c[0] === 'dispose')), true)
  off()
})
