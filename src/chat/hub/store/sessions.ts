// 会话表与聊天流水按人格分开存：入口固定了人格，这里按「这件事的人格」取目录。

import { readJson, writeJson } from '../../../core/store/index.ts'
import { personaDataDir, personaNow } from '../../../persona/personas.ts'

export interface CreateSessionStoreOptions {
  getConfig: () => Record<string, any>
}

export function createSessionStore({ getConfig }: CreateSessionStoreOptions) {  // 会话表和聊天流水都按人格分开（见 personas.js）：入口固定了人格，这里按「这件事的人格」取目录
  const pnow = () => personaNow(getConfig())
  const mapFile = (pid = pnow()) => personaDataDir(getConfig(), pid, 'sessions.json')
  const map = (pid?: string): { chats: Record<string, any>; memoryCutoffs?: Record<string, number> } =>
    readJson(mapFile(pid), () => ({ chats: {} as Record<string, any> }))
  const saveMap = (m, pid?: string) => writeJson(mapFile(pid), m)
  const chatDir = (pid = pnow()) => personaDataDir(getConfig(), pid, 'chatlog')
  const sessionPersona = new Map() // sessionKey → 这个 DSH 会话属于哪个人格
  // 清理某人记忆的截止时间存在各人格自己的会话表里：在哪个人格下清理，就只清这个人格的
  const cutoffCache = new Map() // 会话表文件 → { QQ 号: 截止时间 }（还没认领时几个人格共用一个文件，按文件缓存）
  const memoryCutoffs = (pid = pnow()) => {
    const file = mapFile(pid)
    if (!cutoffCache.has(file)) cutoffCache.set(file, map(pid).memoryCutoffs || {})
    return cutoffCache.get(file)
  }
  const memoryResetAt = (qq) => Number(memoryCutoffs()[qq]) || 0
  function chatMemoryCutoff(chatId, uid) {
    const qq = chatId.startsWith('private:') ? chatId.slice(8) : chatId.startsWith('group:') ? uid : ''
    return memoryResetAt(qq)
  }
  function isBeforeMemoryReset(chatId, uid, at) {
    const cutoff = chatMemoryCutoff(chatId, uid)
    return cutoff > 0 && (Number(at) || 0) <= cutoff
  }
  function historyVisible(chatId, uid, time) {
    const at = Number(time) || 0
    return !isBeforeMemoryReset(chatId, uid, at < 1e12 ? at * 1000 : at)
  }
  function filterHistory(chatId, messages) {
    return messages.filter((message) => message && historyVisible(chatId, message.sender?.user_id ?? message.user_id, message.time))
  }

  return { pnow, mapFile, map, saveMap, chatDir, sessionPersona, memoryCutoffs, memoryResetAt, chatMemoryCutoff, isBeforeMemoryReset, historyVisible, filterHistory }
}
