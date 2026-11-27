export interface NoticeHandlerDeps {
  getConfig: () => any
  bot: () => any
  userName(userId: string, guildId?: string): Promise<string>
  log: any
  isDisposed: () => boolean
  sentIds: Set<unknown>
  faces: { nameOf: (id: string | number) => string }
  noticeText: (ev: any, options: any) => { chatId: string; text: string } | null
  logChat: (chatId: string, who: string, text: string) => void
  noticesFor: Map<string, string[]>
  allowed: (notice: any) => boolean
}

export function createNoticeHandler (deps: NoticeHandlerDeps) {
  async function onNotice (ev: any) {
    if (!deps.allowed(ev)) return
    const account = deps.bot()
    const groupId = ev.type === 'group' ? String(ev.channelId) : ''
    const names = new Map<string, string>()
    for (const id of new Set([ev.userId, ev.operatorId].filter(Boolean))) {
      try {
        const name = await deps.userName(String(id), groupId)
        names.set(String(id), (name || '用户') + '(' + id + ')')
      } catch (error) { names.set(String(id), `用户(${id})`) }
    }
    if (deps.isDisposed()) return
    const note = deps.noticeText(ev, {
      selfId: account?.selfId, platform: account?.platform, botId: account?.id,
      name: (id) => names.get(String(id)) || String(id), ownMessage: (id) => deps.sentIds.has(String(id)), faceName: deps.faces.nameOf,
    })
    if (!note) return
    deps.logChat(note.chatId, '系统', `【系统】${note.text}`)
    deps.noticesFor.set(note.chatId, [...(deps.noticesFor.get(note.chatId) || []), note.text].slice(-8))
  }

  return { onNotice }
}
