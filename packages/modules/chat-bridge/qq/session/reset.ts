import { sessionKey, workspaceDirOf } from '../context/context.ts'
import { personaDataRoots } from '../../../../../src/persona/personas.ts'
import type { createSessionStore } from '../store/sessions.ts'
export function createSessionReset({
  dsh,
  getConfig,
  log,
  store,
  chatLog,
  sessionToChat,
  turnState,
  sessionTarget,
  bindings,
  clearSeed,
  stopTyping,
  outputSources,
  turnGuard,
  sendChain,
  isCreating,
  noticesFor,
  saidElsewhere,
  recentFiles,
  recentMedia,
  quoteCache,
  groupBuf,
}) {
  const { map, saveMap, memoryCutoffs }: ReturnType<typeof createSessionStore> = store
  const { mounted, unmount, clearSlowNotices } = bindings
  const { busy, busyTurns, busySessions, pending, running, isBusy } = turnGuard

  function resetChat(chatId, { memoryResetAt: cutoff = 0 }: { memoryResetAt?: number } = {}) {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const m = map()
    const entry = m.chats[chatId]
    if (!entry && !cutoff) return false
    const qq = chatId.slice(8)
    if (cutoff) m.memoryCutoffs = { ...memoryCutoffs(), [qq]: cutoff }
    delete m.chats[chatId]
    saveMap(m)
    if (cutoff) {
      memoryCutoffs()[qq] = cutoff
      chatLog.bumpRevision()
    }
    const sessions = new Set(
      [entry?.sessionId, ...(cutoff ? Object.values(entry?.sessions || {}) : [])].filter(Boolean),
    )
    for (const sessionId of sessions) {
      const key = sessionKey(sessionId)
      sessionToChat.delete(key)
      turnState.delete(key)
      if (cutoff) {
        const rec = mounted.get(key)
        if (rec) unmount(rec)
        mounted.delete(key)
        sessionTarget.delete(key)
        clearSeed(key)
        clearSlowNotices(key)
        stopTyping(key)
      }
      try {
        Promise.resolve(reg?.archiveSession?.(sessionId)).catch((error) =>
          log.debug('归档会话失败：', error.message),
        )
      } catch (error) {
        log.debug('归档会话失败：', error.message)
      }
    }
    outputSources.delete(chatId)
    log.info(`${chatId} 重新开始`)
    return true
  }

  function resetPersonChat(qq) {
    const chatId = `private:${qq}`
    if (isBusy(chatId) || running.has(chatId) || sendChain.has(chatId) || isCreating(chatId)) {
      return { ok: false, message: '该私聊正在回复，请等这轮结束后再清理' }
    }
    const cutoff = Date.now()
    resetChat(chatId, { memoryResetAt: cutoff })
    clearTimeout(pending.get(chatId)?.timer)
    pending.delete(chatId)
    busy.delete(chatId)
    busyTurns.delete(chatId)
    busySessions.delete(chatId)
    noticesFor.delete(chatId)
    saidElsewhere.delete(chatId)
    recentFiles.delete(chatId)
    recentMedia.clear(chatId)
    for (const key of quoteCache.keys()) if (key.startsWith(chatId + '|')) quoteCache.delete(key)
    for (const [groupId, entries] of groupBuf) {
      groupBuf.set(
        groupId,
        entries.filter((entry) => entry.uid !== qq || entry.t > cutoff),
      )
    }
    return { ok: true }
  }

  function resetSessions() {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    let n = 0

    for (const { id } of personaDataRoots(getConfig())) n += resetMap(reg, id)

    try {
      const norm = (p) =>
        String(p || '')
          .replace(/[\\/]+$/, '')
          .toLowerCase()
      const ws = (reg?.list?.() || []).find((w) => norm(w.path) === norm(workspaceDirOf(getConfig())))
      for (const sid of ws?.sessionIds || []) {
        if ((reg.archivedSessionIds || []).includes(sid)) continue
        Promise.resolve(reg.archiveSession(sid)).catch(() => {})
        n++
      }
    } catch (error) {}
    log.info(`重新开始：归档了 ${n} 个 QQ 会话`)
    return n
  }

  function resetMap(reg, pid) {
    const m = map(pid)
    let n = 0
    for (const [chatId, e] of Object.entries(m.chats)) {
      try {
        Promise.resolve(reg?.archiveSession?.(e.sessionId)).catch((error) =>
          log.debug('归档会话失败：', error.message),
        )
      } catch (error) {
        log.debug('归档会话失败：', error.message)
      }
      sessionToChat.delete(sessionKey(e.sessionId))
      turnState.delete(sessionKey(e.sessionId))
      outputSources.delete(chatId)
      delete m.chats[chatId]
      n++
    }
    if (n) saveMap(m, pid)
    return n
  }

  return { resetChat, resetPersonChat, resetSessions }
}
