import { createHub as createEngine } from '../../packages/modules/chat-bridge/qq/index.ts'
import { OneBotBot } from '../../packages/adapters/qq/onebot-v11/src/bot.ts'
import { inboundOf } from '../../packages/adapters/qq/onebot-v11/src/inbound.ts'
import { chatNotice } from '../../packages/adapters/qq/onebot-v11/src/notices.ts'
import { inboundSession } from '../../src/core/pipeline/session.ts'
import { useLegacyRooms } from '../../src/core/bot/room.ts'

export const BOT_ID = 'adapter-qq-onebot-v11'

export function qqBot(onebot = {}, selfId = '') {
  const bot = new OneBotBot({
    id: BOT_ID,
    selfId: String(selfId || ''),
    expandForwards: false,
    isConnected: () => onebot.connected !== false,
    call: (action, params, options) => onebot.call
      ? onebot.call(action, params, options)
      : Promise.reject(Object.assign(new Error('网关未连接'), { transport: true })),
  })
  bot.markOnline()
  if (onebot.bot) for (const [key, value] of Object.entries(onebot.bot)) Object.defineProperty(bot, key, { value, configurable: true })
  return bot
}

const pipeline = { run: async () => {} }

export function sessionOf(bot, event) {
  if (event?.bot && event?.type) return event
  if (event?.self_id && !bot.selfId) bot.setSelfId?.(String(event.self_id))
  return inboundSession(bot, inboundOf({ post_type: 'message', ...event }), pipeline)
}

const noticeOf = (event, notice_type, sub_type) => chatNotice({ post_type: 'notice', notice_type, sub_type, ...event })

export function createHub({ onebot, bot, selfId = '20000002', ...options } = {}) {
  useLegacyRooms('qq', BOT_ID)
  let instance
  const botOf = bot ?? (() => instance ??= qqBot(onebot, selfId))
  const hub = createEngine({ ...options, bot: botOf })
  const onMessage = hub.onMessage
  return Object.assign(hub, {
    onMessage: (event, deleted) => onMessage(sessionOf(botOf(), event), deleted),
    onPoke: event => hub.onNotice(event?.action ? event : noticeOf(event, 'notify', 'poke')),
    onGroupFile: event => hub.onNotice(event?.action ? event : noticeOf(event, 'group_upload')),
  })
}
