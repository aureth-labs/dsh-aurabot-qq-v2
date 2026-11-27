import { isPrivateRoom, userOf } from '../../../../../src/core/bot/room.ts'

export interface SessionQueryDeps {
  getConfig: () => any
  isOwner: (cfg: any, userId: string, where?: any) => boolean
  sessionKey: (id: string) => string
  turnState: any
  sessionToChat: any
  sessionPersona: any
  mounted: any
  busy: any
  isBusy: (chatId: string) => boolean
  running: any
  systemStarting: any
  map: (persona?: string) => any
  personaDataRoots: (cfg: any) => Array<{ id: string }>
}

export function createSessionQuery(deps: SessionQueryDeps) {
  const { getConfig, isOwner, sessionKey, turnState, sessionToChat, sessionPersona, mounted, busy, isBusy, running, systemStarting, map, personaDataRoots } = deps

  function chatOfSession(sessionId: string): string {
    const key = sessionKey(sessionId)
    const live = sessionToChat.get(key)
    if (live) return live
    return findSession(key)?.chatId || ''
  }

  // 重启后会话还没被第一条消息唤醒时，内存映射是空的：退回持久化的 聊天→会话 映射（#90 兜底）。
  // 各人格的会话表都要找：主人可能直接在 DSH 窗口里给不是当前人格的会话打字。
  function findSession(key: string): { chatId: string; persona: string } | null {
    for (const { id } of personaDataRoots(getConfig())) {
      try {
        for (const [chatId, entry] of Object.entries(map(id).chats || {})) {
          if (!(entry as any)?.sessionId || sessionKey((entry as any).sessionId) !== key) continue
          sessionPersona.set(key, id)
          return { chatId, persona: id }
        }
      } catch {}
    }
    return null
  }

  function ownerPrivateChat(sessionId: string): boolean {
    try {
      const chatId = chatOfSession(sessionId)
      return isPrivateRoom(chatId) && isOwner(getConfig(), userOf(chatId), { chatId })
    } catch { return false }
  }

  function turnHasOwner(sessionId: string): boolean {
    const st = turnState.get(sessionKey(sessionId))
    if (st && st.directOwner) return true // 主人在 DSH 面板里直接打字
    if (st && [...st.senders].some((u: string) => isOwner(getConfig(), u, { chatId: chatOfSession(sessionId) }))) return true
    return ownerPrivateChat(sessionId)
  }

  function turnSenders(sessionId: string): string[] {
    return [...(turnState.get(sessionKey(sessionId))?.senders || [])]
  }

  function turnSendersAllOwner(sessionId: string, state?: any): boolean {
    const st = state || turnState.get(sessionKey(sessionId))
    if (st && st.directOwner) return true
    if (!st || !st.senders.size) return ownerPrivateChat(sessionId)
    return [...st.senders].every((u: string) => isOwner(getConfig(), u, { chatId: chatOfSession(sessionId) }))
  }

  /** 生图的群聊例外：主人是本轮唯一明确 @ / 引用回复的请求者。 */
  function turnDirectFromOwner(sessionId: string): boolean {
    const st = turnState.get(sessionKey(sessionId))
    const uid = String(st?.directRequester?.uid || '')
    return Boolean(uid && st?.senders.has(uid) && isOwner(getConfig(), uid, { chatId: chatOfSession(sessionId) }))
  }

  /** 这个 DSH 会话属于哪个人格（不是 aurabot 的会话时为空）。 */
  function personaOf(sessionId: string): string {
    const key = sessionKey(sessionId)
    return sessionPersona.get(key) || findSession(key)?.persona || ''
  }

  /** 有聊天或后台轮次在进行：这时切人格，旧人格的回复会被当成新人格的发出去。 */
  function hubBusy(): boolean {
    return [...busy.keys()].some(isBusy) || running.size > 0 || systemStarting.size > 0 || [...turnState.values()].some((st: any) => st.system && st.system.timedOutAt == null)
  }

  /** 这个 DSH 会话是不是 aurabot 自己开出来的（由 QQ 聊天映射过来），危险命令守卫用它区分。 */
  function isOwnedSession(sessionId: string): boolean {
    if (chatOfSession(sessionId)) return true
    return mounted.has(sessionKey(sessionId))
  }

  return { chatOfSession, findSession, ownerPrivateChat, turnHasOwner, turnSenders, turnSendersAllOwner, turnDirectFromOwner, personaOf, hubBusy, isOwnedSession }
}
