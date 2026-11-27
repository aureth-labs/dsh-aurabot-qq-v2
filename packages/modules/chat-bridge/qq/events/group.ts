import { roomKey } from '../../../../../src/core/bot/room.ts'

export interface GroupEventDeps {
  isDisposed: () => boolean
  getConfig: () => any
  getSelfId: () => string
  bot: () => any
  userName(userId: string, guildId?: string): Promise<string>
  hooks: any
  lastPoker: Map<string, string>
  ignoredGroupMember: (cfg: any, chat: any) => boolean
  groupResponseMode: (cfg: any, groupId: string, where?: any) => string
  onMessage: (ev: any) => Promise<any>
  log: any
}

export function createGroupEvents (deps: GroupEventDeps) {
  const pokeAt = new Map()
  const account = () => {
    const bot = deps.bot()
    return { platform: bot?.platform || 'qq', id: bot?.id || '', selfId: String(bot?.selfId || deps.getSelfId() || '') }
  }
  const chatOf = (ev) => {
    const self = account()
    return { kind: ev.type, chatId: roomKey({ platform: self.platform, botId: self.id, type: ev.type, id: ev.channelId }),
      groupId: ev.type === 'group' ? String(ev.channelId) : '', userId: String(ev.userId), platform: self.platform, botId: self.id }
  }

  async function onGroupFile(ev) {
    if (deps.isDisposed() || !ev.file?.name || ev.type !== 'group') return
    const chat = chatOf(ev)
    if (deps.ignoredGroupMember(deps.getConfig(), chat)) return
    let nickname = chat.userId
    try {
      nickname = await deps.userName(chat.userId, chat.groupId) || nickname
    } catch (error) {}
    await deps.onMessage({
      bot: account(), type: 'group', channelId: chat.groupId, userId: chat.userId, userName: nickname, messageId: '0',
      elements: [{ type: 'file', attrs: { ...ev.file } }],
    })
  }

  async function onPoke(ev) {
    if (deps.isDisposed()) return
    const self = account().selfId
    if (String(ev.targetId) !== self) return
    const chat = chatOf(ev)
    if (deps.ignoredGroupMember(deps.getConfig(), chat)) return
    if (deps.hooks?.poke) {
      try { if (await deps.hooks.poke({ ...ev, chatId: chat.chatId })) return } catch (error) {}
    }
    if (deps.isDisposed()) return
    if (chat.groupId && deps.groupResponseMode(deps.getConfig(), chat.groupId, chat) !== 'chat') return
    const poker = chat.userId
    if (!poker || poker === self) return
    deps.lastPoker.set(chat.chatId, poker)
    if (Date.now() - (pokeAt.get(chat.chatId) || 0) < 20_000) return
    pokeAt.set(chat.chatId, Date.now())
    let nickname = poker
    try {
      nickname = await deps.userName(poker, chat.groupId) || poker
    } catch (error) {}
    if (deps.isDisposed()) return
    deps.log.info(`${chat.chatId}：${nickname} 戳了戳她`)
    await deps.onMessage({
      bot: account(), type: ev.type, channelId: ev.channelId, userId: poker, userName: nickname, messageId: '0',
      elements: [{ type: 'at', attrs: { id: self } }, { type: 'text', attrs: { content: ev.value ? ' [' + ev.value + '（这是戳一戳的动作）]' : ' [戳了戳你]' } }],
    })
  }

  return { onGroupFile, onPoke }
}
