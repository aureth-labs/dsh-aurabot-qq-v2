export interface MemberLookupDeps {
  onebot: any
  log: any
}

export function createMemberLookup (deps: MemberLookupDeps) {
  const groupMembers = new Map<string, { at: number; list: any[] }>()

  async function membersOf (groupId: string | number) {
    const key = String(groupId)
    const hit = groupMembers.get(key)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list
    try {
      const r = await deps.onebot.call('get_group_member_list', { group_id: Number(groupId) }, { timeoutMs: 15000 })
      const list = Array.isArray(r) ? r : r?.data || []
      groupMembers.set(key, { at: Date.now(), list })
      return list
    } catch (error) {
      deps.log.debug('拉群成员失败，@ 按文字发：', error.message)
      return hit?.list || []
    }
  }

  return { membersOf }
}

export interface NoticeHandlerDeps {
  getConfig: () => any
  onebot: any
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
        const m = groupId ? await deps.onebot.call('get_group_member_info', { group_id: Number(groupId), user_id: Number(qq) }, { timeoutMs: 3000, retries: 0 }) : null
        names.set(String(qq), `${m?.card || m?.nickname || 'QQ 用户'}(${qq})`)
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
