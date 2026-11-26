export interface NoticeHandlerDeps {
  getConfig: () => any
  userName(userId: string, guildId?: string): Promise<string>
  log: any
  isDisposed: () => boolean
  sentIds: Set<unknown>
  faces: { nameOf: (id: string | number) => string }
  noticeText: (ev: any, options: any) => { chatId: string; text: string } | null
  logChat: (chatId: string, who: string, text: string) => void
  noticesFor: Map<string, string[]>
}

export function createNoticeHandler (deps: NoticeHandlerDeps) {
  async function onNotice (ev: any) {
    const cfg = deps.getConfig()
    const groupId = ev.group_id ? String(ev.group_id) : ''
    if (groupId ? !cfg.allow.groups.map(String).includes(groupId) : !cfg.allow.private.map(String).includes(String(ev.user_id)) && String(ev.user_id) !== String(cfg.ownerQQ)) return
    const names = new Map<string, string>()
    for (const qq of new Set([ev.user_id, ev.operator_id, ev.sender_id].filter(Boolean))) {
      try {
        const name = await deps.userName(String(qq), groupId)
        names.set(String(qq), (name || '用户') + '(' + qq + ')')
      } catch (error) { names.set(String(qq), `QQ 用户(${qq})`) }
    }
    if (deps.isDisposed()) return
    const note = deps.noticeText(ev, { botQQ: cfg.botQQ, name: (qq) => names.get(String(qq)) || String(qq), ownMessage: (id) => deps.sentIds.has(String(id)), faceName: deps.faces.nameOf })
    if (!note) return
    deps.logChat(note.chatId, '系统', `【系统】${note.text}`)
    deps.noticesFor.set(note.chatId, [...(deps.noticesFor.get(note.chatId) || []), note.text].slice(-8))
  }

  return { onNotice }
}
