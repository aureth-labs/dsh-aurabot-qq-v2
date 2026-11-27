export interface GroupEventDeps {
  isDisposed: () => boolean
  getConfig: () => any
  getSelfId: () => string
  bot: () => any
  userName(userId: string, guildId?: string): Promise<string>
  hooks: any
  lastPoker: Map<string, string>
  ignoredGroupMember: (cfg: any, chat: any) => boolean
  groupResponseMode: (cfg: any, groupId: string) => string
  onMessage: (ev: any) => Promise<any>
  log: any
}

export function createGroupEvents (deps: GroupEventDeps) {
  const pokeAt = new Map()
  const account = () => {
    const bot = deps.bot()
    return { platform: bot?.platform || 'qq', id: bot?.id || '', selfId: String(bot?.selfId || deps.getSelfId() || '') }
  }

  async function onGroupFile(ev) {
    if (deps.isDisposed() || !ev.file?.name) return
    if (deps.ignoredGroupMember(deps.getConfig(), { kind: 'group', groupId: ev.group_id, userId: ev.user_id })) return
    let nickname = String(ev.user_id)
    try {
      nickname = await deps.userName(String(ev.user_id), String(ev.group_id)) || nickname
    } catch (error) {}
    await deps.onMessage({
      bot: account(), type: 'group', channelId: String(ev.group_id), userId: String(ev.user_id), userName: nickname, messageId: '0',
      elements: [{ type: 'file', attrs: { name: ev.file.name, size: ev.file.size, id: ev.file.id, busid: ev.file.busid } }],
    })
  }

  async function onPoke(ev) {
    if (deps.isDisposed()) return
    const self = String(ev.self_id || account().selfId)
    if (String(ev.target_id) !== self) return
    if (deps.ignoredGroupMember(deps.getConfig(), { kind: ev.group_id ? 'group' : 'private', groupId: ev.group_id, userId: ev.user_id })) return
    if (deps.hooks?.poke) {
      try { if (await deps.hooks.poke(ev)) return } catch (error) {}
    }
    if (deps.isDisposed()) return
    const group = ev.group_id ? String(ev.group_id) : ''
    if (group && deps.groupResponseMode(deps.getConfig(), group) !== 'chat') return
    const poker = String(group ? ev.user_id : ev.sender_id ?? ev.user_id)
    if (!poker || poker === self) return
    if (deps.isDisposed()) return
    const chatId = group ? `group:${group}` : `private:${poker}`
    deps.lastPoker.set(chatId, poker)
    if (Date.now() - (pokeAt.get(chatId) || 0) < 20_000) return
    pokeAt.set(chatId, Date.now())
    let nickname = poker
    try {
      nickname = await deps.userName(poker, group) || poker
    } catch (error) {}
    if (deps.isDisposed()) return
    deps.log.info(`${chatId}：${nickname} 戳了戳她`)
    await deps.onMessage({
      bot: { ...account(), selfId: self }, type: group ? 'group' : 'private', channelId: group || poker, userId: poker, userName: nickname, messageId: '0',
      elements: [{ type: 'at', attrs: { id: self } }, { type: 'text', attrs: { content: ev.action ? ' [' + ev.action + (ev.suffix || '') + '（这是戳一戳的动作）]' : ' [戳了戳你]' } }],
    })
  }

  return { onGroupFile, onPoke }
}
