import * as chatTools from '../../packages/modules/chat-tools/index.ts'
import { BOT_ID } from './hub.js'

export function chatToolsFor({ config, hub = {}, bot = {}, realBot, where = {}, ownerTurn, logger, harness } = {}) {
  let build
  const ctx = {
    bots: { get: () => realBot || ({ status: 'online', platform: 'qq', selfId: '20000002', getGuildList: async () => [], getUserList: async () => [], ...bot }) },
    root: { get config() { return typeof config === 'function' ? config() : config }, read: () => ({}), update: () => {} },
    host: { hub },
    harness,
    logger,
    turnFromOwner: ownerTurn || ((sessionId) => Boolean(hub.turnSendersAllOwner?.(sessionId))),
    tool: (fn) => { build = fn },
  }
  chatTools.apply(ctx, {})
  const kind = where.kind || 'private'
  const id = where.id || (kind === 'group' ? '9' : '1')
  const chat = where.chat || { kind, chatId: `${kind}:${id}`, ...(kind === 'group' ? { groupId: id } : { userId: id }) }
  return build({ chat, level: where.level || 'full', sessionId: where.sessionId || 's', primaryChat: true, target: { platform: 'qq', botId: BOT_ID, type: chat.kind, id: chat.kind === 'group' ? chat.groupId : chat.userId || id } }) || []
}
