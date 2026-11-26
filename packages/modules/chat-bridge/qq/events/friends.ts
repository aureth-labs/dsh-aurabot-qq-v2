// QQ 好友列表缓存：5 分钟内复用，避免每次判「是不是好友」都打一次 OneBot。
// 取不到就保持上一次的结果，不打断聊天。

export function createFriends({ onebot, log }: { onebot: any; log: any }) {
  const friendIds = new Set<string>()
  let friendsAt = 0
  let friendsPending: Promise<void> | null = null

  function refreshFriends(): Promise<void> {
    if (friendsPending) return friendsPending
    if (Date.now() - friendsAt < 300_000) return Promise.resolve()
    friendsAt = Date.now()
    friendsPending = (async () => {
      try {
        const result = await onebot.call('get_friend_list', {}, { timeoutMs: 3000, retries: 0 })
        const list = Array.isArray(result) ? result : result?.friends
        if (!Array.isArray(list)) return
        friendIds.clear()
        for (const friend of list) if (friend?.user_id) friendIds.add(String(friend.user_id))
      } catch (error: any) { log.debug?.('暂时取不到 QQ 好友列表：', error.message) }
    })().finally(() => { friendsPending = null })
    return friendsPending
  }

  return { refreshFriends, friendIds }
}
