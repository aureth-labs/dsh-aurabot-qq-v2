// 私聊里等她回复时，在 QQ 上显示「对方正在输入…」（模型慢的时候让人知道她在想）。
// 6 分钟封顶，期间每 15 秒续一次。

export interface TypingDeps {
  isDisposed: () => boolean
  getConfig: () => any
  onebot: any
}

export function createTyping({ isDisposed, getConfig, onebot }: TypingDeps) {
  const typing = new Map<string, ReturnType<typeof setInterval>>()

  function startTyping(key: string, chat: any) {
    if (isDisposed()) return
    const cfg = getConfig()
    if (chat.kind !== 'private' || !cfg.enabled || typing.has(key)) return
    const ping = () => { if (!isDisposed()) onebot.call('set_input_status', { user_id: Number(chat.userId), event_type: 1 }, { timeoutMs: 5000 }).catch(() => {}) }
    ping()
    const started = Date.now()
    // lifecycle-safe: hub.dispose() 调用 stopAll()，正常回合结束时调用 stopTyping()。
    const t = setInterval(() => {
      if (Date.now() - started > 6 * 60_000) return stopTyping(key)
      ping()
    }, 15_000)
    t.unref?.()
    typing.set(key, t)
  }

  function stopTyping(key: string) {
    const t = typing.get(key)
    if (t) clearInterval(t)
    typing.delete(key)
  }

  function stopAll() { for (const key of [...typing.keys()]) stopTyping(key) }

  return { startTyping, stopTyping, stopAll }
}
