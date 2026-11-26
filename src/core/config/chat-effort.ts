export const effortId = (value) => typeof value === 'string' && /^[^\s\p{C}]{1,80}$/u.test(value)

export const chatKey = /^(private|group):\d+$/
export const modelKey = ({ provider, model }) => JSON.stringify([provider, model])

export function chatEffortFor(cfg, chatId, model) {
  return model ? cfg.chatEfforts?.[chatId]?.[modelKey(model)] : undefined
}

export function normalizeChatEfforts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const chats: Record<string, any> = {}
  for (const [chatId, models] of Object.entries(raw)) {
    if (!chatKey.test(chatId) || !models || typeof models !== 'object' || Array.isArray(models)) continue
    const entries = Object.entries(models).filter(([key, value]) => key.startsWith('["') && effortId(value))
    if (entries.length) chats[chatId] = Object.fromEntries(entries)
  }
  return chats
}
