export interface TypingDeps {
  isDisposed: () => boolean
  getConfig: () => any
  bot: () => any
}

export function createTyping({ isDisposed, getConfig, bot }: TypingDeps) {
  const typing = new Map<string, ReturnType<typeof setInterval>>()

  function startTyping(key: string, chat: any) {
    if (isDisposed()) return
    const cfg = getConfig()
    if (chat.kind !== 'private' || !cfg.enabled || typing.has(key)) return
    const account = bot()
    if (account?.platform !== 'qq') return
    const ping = () => { if (!isDisposed()) account.internal('set_input_status', { user_id: Number(chat.userId), event_type: 1 }, { timeoutMs: 5000 }).catch(() => {}) }
    ping()
    const started = Date.now()
    // lifecycle-safe: hub.dispose() 调用 stopAll()
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
