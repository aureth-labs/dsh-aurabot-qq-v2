import { type ReplyWait, sessionKey, SOURCE_KIND } from '../context/context.ts'
import { randomUUID } from 'node:crypto'
import { type RunSystemTurnOptions } from './options.ts'
import { personaScope, safeId } from '../../../persona/personas.ts'
import { withPromptCapture } from '../../../security/leak-guard.ts'
import { cleanText } from '../../../core/support/util/text.ts'
import { currentTimeLine } from '../../reply/context/time-context.ts'

export function createBackgroundTurns({
  dsh,
  log,
  getConfig,
  store,
  sessionToChat,
  turnState,
  bindings,
  sessions,
  systemFailures,
  systemStarting,
  assertActive,
  isDisposed,
  sourcesFor,
}) {
  const { map, saveMap } = store
  const { mounted, unmount, clearSlowNotices, slowNoticeSent } = bindings
  const { agentFor, systemChatId, systemSessionCooldown, backoffError, applyModel } = sessions

  const systemTurns = new Map()

  const SYSTEM_STUCK_GRACE_MS = 5 * 60_000

  const SYSTEM_BACKOFF = [2, 5, 15, 30, 60, 120].map((minutes) => minutes * 60_000)

  const replyWaits = new Set<ReplyWait>()

  function systemFailed(chatId) {
    const count = (systemFailures.get(chatId)?.count || 0) + 1
    const delay = SYSTEM_BACKOFF[Math.min(count - 1, SYSTEM_BACKOFF.length - 1)]
    systemFailures.set(chatId, { count, until: Date.now() + delay })
    log.warn(`${chatId}：后台轮次失败，${delay / 60_000} 分钟后再试`)
  }

  async function recoverSystemTurn(chatId, current) {
    const { agent, sessionId, key } = current
    current.needsRecovery = true
    if (typeof agent.cancel !== 'function' || typeof agent.whenIdle !== 'function')
      throw new Error('宿主没有取消或等待会话停止的能力')
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(async () => {
          await agent.cancel({ kind: 'user' })
          await agent.whenIdle()
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('等待旧后台轮次停止超时')), 15_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    assertActive()
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (typeof reg?.archiveSession !== 'function') throw new Error('宿主没有归档会话的能力')
    if (!current.archived && !(reg.archivedSessionIds || []).includes(sessionId)) {
      const archived = await reg.archiveSession(sessionId)
      if (archived === false || archived?.ok === false) throw new Error(archived?.message || '归档会话失败')
      current.archived = true
    }
    assertActive()
    const rec = mounted.get(key)
    if (rec) {
      unmount(rec)
      mounted.delete(key)
    }
    sessionToChat.delete(key)
    turnState.delete(key)
    clearSlowNotices(key)
    slowNoticeSent.delete(key)
    const m = map()
    if (m.chats[chatId]?.sessionId === sessionId) {
      delete m.chats[chatId]
      saveMap(m)
    }
    systemTurns.delete(chatId)
    log.warn(`${chatId}：卡住的后台轮次已取消并归档，换新会话`)
  }

  async function ensureDebugSession() {
    assertActive()
    const cfg = getConfig()
    if (!cfg.debug) return { ok: false, message: '没开调试模式' }
    if (!cfg.ownerQQ) return { ok: false, message: '还没填主人 QQ' }
    const chat = {
      kind: 'private',
      chatId: `private:${cfg.ownerQQ}`,
      userId: String(cfg.ownerQQ),
      groupId: '',
      nickname: cfg.ownerName || '主人',
    }
    const before = map().chats[chat.chatId]
    const prevId = before
      ? (before.sessions && before.sessions.debug) || (before.mode === 'debug' ? before.sessionId : '')
      : ''
    const r = await agentFor(chat)
    const created = r.sessionId !== prevId
    return {
      ok: true,
      sessionId: r.sessionId,
      created,
      message: created ? '建好了一条调试会话' : '调试会话已经在了',
    }
  }

  async function debugSay(text, { timeoutMs = 180000 }: { timeoutMs?: number } = {}) {
    assertActive()
    const cfg = getConfig()
    if (!cfg.debug) return { ok: false, message: '没开调试模式' }
    if (!cfg.ownerQQ) return { ok: false, message: '还没填主人 QQ' }
    const say = String(text || '')
      .trim()
      .slice(0, 2000)
    if (!say) return { ok: false, message: '说点什么吧' }
    const chat = {
      kind: 'private',
      chatId: `private:${cfg.ownerQQ}`,
      userId: String(cfg.ownerQQ),
      groupId: '',
      nickname: cfg.ownerName || '主人',
    }
    try {
      const { agent, sessionId } = await agentFor(chat)
      assertActive()
      const key = sessionKey(sessionId)
      const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
      if (st.system) return { ok: false, message: '上一轮还没结束' }
      turnState.set(key, st)
      st.lastText = say
      st.senders = new Set([String(cfg.ownerQQ)])
      st.speakers = [String(cfg.ownerQQ)]
      let timer
      let rejectWait
      const base = new Promise((resolve, reject) => {
        rejectWait = reject
        st.system = { resolve, reject }
        timer = setTimeout(() => {
          if (st.system) st.system = null
          reject(new Error('等太久了'))
        }, timeoutMs)
      })
      const system = st.system
      const wait = { timer, reject: rejectWait, result: null }
      wait.result = base.finally(() => {
        clearTimeout(timer)
        replyWaits.delete(wait)
      })
      replyWaits.add(wait)
      wait.result.catch(() => {})
      Promise.resolve()
        .then(() => {
          assertActive()
          return agent.followup({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: say }],
            source: { kind: SOURCE_KIND },
          })
        })
        .catch((error) => {
          if (st.system === system) {
            st.system = null
            rejectWait(error)
          }
        })
      const reply = await wait.result
      return { ok: true, text: reply, sessionId }
    } catch (error) {
      return { ok: false, message: error.message || String(error) }
    }
  }

  async function runSystemTurn(
    name,
    title,
    prompt,
    {
      timeoutMs = 180000,
      noTools = false,
      key: scope = '',
      presetId = '',
      level: levelName = '',
      model = null,
    }: RunSystemTurnOptions = {},
  ) {
    const chat = {
      chatId: systemChatId(name, scope),
      kind: 'system',
      title,
      noTools: !!noTools,
      presetId: String(presetId || ''),
      level: String(levelName || ''),
    }
    assertActive()

    const pinned = personaScope.getStore()
    if (pinned && pinned !== safeId(getConfig().persona?.current))
      throw new Error('人格已切换，这次后台任务作废')
    if (systemStarting.has(chat.chatId)) throw new Error('这个后台会话的上一轮还没结束')
    systemStarting.add(chat.chatId)
    let result
    try {
      const current = systemTurns.get(chat.chatId)
      if (current?.st.system && current.st.system.timedOutAt == null)
        throw new Error('这个后台会话的上一轮还没结束')
      const failure = systemSessionCooldown(name, { key: scope })
      if (failure) throw backoffError(chat.chatId, failure)
      if (current?.st.system && Date.now() - current.st.system.timedOutAt < SYSTEM_STUCK_GRACE_MS)
        throw new Error('这个后台会话的上一轮还没结束')
      if (current?.needsRecovery || current?.st.system) {
        try {
          await recoverSystemTurn(chat.chatId, current)
        } catch (error) {
          if (!isDisposed()) systemFailed(chat.chatId)
          throw error
        }
      } else if (current) systemTurns.delete(chat.chatId)
      const { agent, sessionId } = await agentFor(chat)

      if (model && model.provider && model.model) applyModel(agent, model)
      assertActive()
      const key = sessionKey(sessionId)
      const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
      if (st.system) throw new Error('这个后台会话的上一轮还没结束')
      turnState.set(key, st)
      let timer
      let rejectWait
      const base = new Promise((resolve, reject) => {
        rejectWait = reject
        st.system = { resolve, reject }
        timer = setTimeout(() => {
          if (st.system === system) {
            system.timedOutAt = Date.now()
            systemFailed(chat.chatId)
          }
          reject(new Error('等太久了'))
        }, timeoutMs)
      })
      const system = st.system
      systemTurns.set(chat.chatId, { agent, sessionId, key, st })

      const wait = { timer, reject: rejectWait, result: null }
      wait.result = base
        .then(
          (text) => {
            systemFailures.delete(chat.chatId)
            return text
          },
          (error) => {
            if (system.timedOutAt == null && !isDisposed()) systemFailed(chat.chatId)
            throw error
          },
        )
        .finally(() => {
          clearTimeout(timer)
          replyWaits.delete(wait)
        })
      replyWaits.add(wait)
      wait.result.catch(() => {})
      result = wait.result

      Promise.resolve()
        .then(() => {
          assertActive()
          const sources = sourcesFor(chat.chatId)
          return withPromptCapture(sources, () =>
            agent.followup({
              id: randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: cleanText(prompt) + '\n' + currentTimeLine() }],
              source: { kind: SOURCE_KIND, speaker: { role: 'none' } },
            }),
          )
        })
        .catch((error) => {
          if (st.system === system && system.timedOutAt == null) {
            st.system = null
            system.reject(error)
          }
        })
    } finally {
      systemStarting.delete(chat.chatId)
    }
    return result
  }
  function dispose(error: Error) {
    for (const wait of replyWaits) {
      clearTimeout(wait.timer)
      wait.reject(error)
    }
    replyWaits.clear()
    systemTurns.clear()
    systemStarting.clear()
    systemFailures.clear()
  }
  return { ensureDebugSession, debugSay, runSystemTurn, dispose }
}
