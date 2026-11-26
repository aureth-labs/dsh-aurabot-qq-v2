import { workspaceDirOf, WORKSPACE_TITLE, sessionKey } from '../context/context.ts'
import { mkdirSync } from 'node:fs'
import { grantOwner } from '../../../../../src/core/runtime/workspace-move.ts'
import { personaDataDir, selfName, personaScope } from '../../../../../src/persona/personas.ts'
import { dataDir } from '../../../../../src/core/store/index.ts'
import { presetFor, levelFor } from '../../../../../src/chat/policy/rules/access.ts'
import { SESSION_BACKOFF } from '../turn/session-backoff.ts'
import { createSessionModels } from './models.ts'

import type { createSessionStore } from '../store/sessions.ts'

export function createSessionManager({
  dsh,
  getConfig,
  log,
  store,
  groupNames,
  systemFailures,
  sessionToChat,
  sessionTarget,
  checkTurn,
  assertActive,
  isDisposed,
  availableModels,
  hooks,
  mount,
}) {
  const { pnow, map, saveMap, sessionPersona }: ReturnType<typeof createSessionStore> = store
  const sessionFailures = new Map()
  const sessionCreating = new Map()
  const SESSION_BACKOFF_MS = [1, 5, 15, 30, 60].map((minutes) => minutes * 60_000)

  async function ensureWorkspace() {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!reg) throw new Error('宿主没有 workspaceRegistry')
    const dir = workspaceDirOf(getConfig())
    mkdirSync(dir, { recursive: true })
    grantOwner(dir, log) // 不等它：模型回话要好几秒，够它先做完，这里多等一拍会让并发建会话的判断错位
    const norm = (p) =>
      String(p || '')
        .replace(/[\\/]+$/, '')
        .toLowerCase()
    let ws = reg.list().find((w) => norm(w.path) === norm(dir))
    if (!ws) {
      ws = await reg.create(dir, WORKSPACE_TITLE)
      log.info('建好了工作区「' + WORKSPACE_TITLE + '」：' + dir)
    }
    return ws
  }

  function controller() {
    const c = dsh.get('sessionController')
    if (!c) throw new Error('宿主没有 sessionController（需要 DSH 桌面版 / Web 组合）')
    return c
  }

  function titleFor(chat) {
    const owner = getConfig().ownerName || '主人'

    const who = personaDataDir(getConfig(), pnow()) === dataDir() ? '' : `${selfName(getConfig())} · `
    if (chat.kind === 'system') {
      const t = String(chat.title || '后台')
      return `QQ · ${who}${t.startsWith('QQ · ') ? t.slice(5) : t}`
    }
    if (chat.kind === 'group') return `QQ 群 · ${who}${groupNames.get(chat.groupId) || chat.groupId}`
    return chat.userId === getConfig().ownerQQ
      ? `QQ · ${who}${owner}私聊`
      : `QQ 私聊 · ${who}${chat.nickname || chat.userId}`
  }

  function presetForChat(chat, level) {
    const cfg = getConfig()
    const wanted = chat.noTools ? '' : String(chat.presetId || '').trim()
    return wanted && cfg.ext?.autotelic?.presetIdOverride ? wanted : presetFor(level, cfg, chat)
  }

  const systemChatId = (name, scope = '') => {
    const suffix = String(scope || '')
      .trim()
      .replace(/[^\w:-]/g, '')
      .slice(0, 32)
    return suffix ? `system:${name}:${suffix}` : `system:${name}`
  }

  function sessionFailure(chatId) {
    const failure = sessionFailures.get(chatId)

    if (failure && failure.workspacePath !== workspaceDirOf(getConfig())) {
      sessionFailures.delete(chatId)
      return null
    }
    return failure
  }

  function backoffError(chatId, failure, cause?) {
    return Object.assign(
      new Error(
        `${chatId}：会话冷却中，${Math.ceil(Math.max(0, failure.until - Date.now()) / 60_000)} 分钟后再试${failure.message ? `；${failure.message}` : ''}`,
        cause ? { cause } : undefined,
      ),
      {
        code: SESSION_BACKOFF,
        chatId,
        retryAt: failure.until,
      },
    )
  }

  function systemSessionCooldown(name, { key = '' }: { key?: string } = {}) {
    const chatId = systemChatId(name, key)
    const failure = [sessionFailure(chatId), systemFailures.get(chatId)].find(
      (item) => item && Date.now() < item.until,
    )
    return failure ? { ...failure, chatId, retryAt: failure.until } : null
  }

  function chatCooldown(chatId) {
    const id = String(chatId || '')
    if (!id) return null
    const failure = [sessionFailure(id), systemFailures.get(id)].find(
      (item) => item && Date.now() < item.until,
    )
    return failure ? { ...failure, chatId: id, retryAt: failure.until } : null
  }

  // 只清理由本次 create 明确返回、且没有挂到任何工作区的孤儿会话。
  async function cleanOrphan(error, ws, c) {
    const match = String(error?.message || '').match(
      /session ["']([^"']+)["'] was created but could not attach to workspace ["']([^"']+)["']/i,
    )
    const details = error?.data || error?.details
    const sid = match?.[1] || (error?.code === 'session/workspace-attach-failed' ? details?.sessionId : '')
    const workspaceId = match?.[2] || details?.workspaceId
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const attached =
      sid &&
      (reg?.list?.() || []).some((workspace) =>
        (workspace.sessionIds || []).some((id) => sessionKey(id) === sessionKey(sid)),
      )
    if (
      !sid ||
      workspaceId !== ws.id ||
      attached ||
      Object.values(map().chats).some((entry) => sessionKey(entry.sessionId) === sessionKey(sid)) ||
      sessionToChat.has(sessionKey(sid))
    ) {
      log.debug?.('新会话挂载失败：无法确认孤儿会话身份，未清理')
      return
    }

    const cleanup = typeof c.delete === 'function' ? c.delete : typeof c.close === 'function' ? c.close : null
    if (!cleanup) {
      log.debug?.(`孤儿会话 ${sid} 无法清理：宿主 sessionController 没有删除或关闭接口`)
      return
    }
    try {
      const result = await cleanup.call(c, { sessionId: sid })
      if (result === false || result?.ok === false) throw new Error(result?.message || '宿主拒绝清理')
      log.debug?.(`已清理未挂上工作区的孤儿会话 ${sid}`)
    } catch (cleanupError) {
      log.debug?.(`孤儿会话 ${sid} 清理失败：${cleanupError.message}`)
    }
  }

  async function createSession(chat, level, turnToken) {
    const failure = sessionFailure(chat.chatId)
    if (failure && Date.now() < failure.until) throw backoffError(chat.chatId, failure)

    const key = pnow() + '|' + chat.chatId + ':' + (getConfig().debug ? 'debug' : 'live')
    if (sessionCreating.has(key)) return sessionCreating.get(key)
    const task = Promise.resolve().then(() => createSessionNow(chat, level, turnToken))
    sessionCreating.set(key, task)
    try {
      return await task
    } finally {
      if (sessionCreating.get(key) === task) sessionCreating.delete(key)
    }
  }

  async function createSessionNow(chat, level, turnToken) {
    const ws = await ensureWorkspace()
    const workspacePath = workspaceDirOf(getConfig())
    checkTurn(chat.chatId, turnToken)
    assertActive()
    const preset = presetForChat(chat, level)
    const debug = getConfig().debug

    const title = titleFor(chat) + (debug ? '（调试）' : '')
    const c = controller()
    let r
    try {
      r = await c.create({ workspaceId: ws.id, agentPreset: preset })
    } catch (error) {
      if (
        isDisposed() ||
        !(
          error?.code === 'session/workspace-attach-failed' ||
          /could not attach to workspace/i.test(String(error?.message || ''))
        )
      )
        throw error
      const previous = sessionFailure(chat.chatId)
      const count = (previous?.count || 0) + 1
      const tier = Math.min(count - 1, chat.kind === 'system' ? SESSION_BACKOFF_MS.length - 1 : 1)
      const delay = SESSION_BACKOFF_MS[tier]
      const message = `DSH 无法把新会话挂到工作区 ${workspacePath}，可在 DSH 里检查该工作区或删掉重建`
      const failure = {
        count,
        tier,
        until: Date.now() + delay,
        workspacePath,
        message,
        error: String(error?.message || error),
      }
      sessionFailures.set(chat.chatId, failure)
      if (!previous || tier > previous.tier)
        log.warn(
          `${chat.chatId}：${message}；${delay / 60_000} 分钟后再试${chat.kind === 'system' ? '' : '；QQ 消息已保留，下次消息到来时重试'}`,
        )
      try {
        await cleanOrphan(error, ws, c)
      } catch (cleanupError) {
        log.debug?.(`检查孤儿会话失败，未清理：${cleanupError.message}`)
      }
      assertActive()
      throw backoffError(chat.chatId, failure, error)
    }
    assertActive()
    const sid = String(r.sessionId)
    try {
      await controller().rename({ sessionId: sid, title })
    } catch (error) {
      log.debug('改会话标题失败：', error.message)
    }

    checkTurn(chat.chatId, turnToken)
    assertActive()
    const m = map()
    const prev = m.chats[chat.chatId] || {}
    const mode = debug ? 'debug' : 'live'
    const sessions = prev.preset === preset && prev.level === level ? { ...(prev.sessions || {}) } : {}
    if (prev.sessionId && prev.preset === preset && prev.level === level) {
      const prevMode = prev.mode || 'live'
      if (!sessions[prevMode]) sessions[prevMode] = prev.sessionId
    }
    sessions[mode] = sid
    m.chats[chat.chatId] = {
      ...prev,
      sessionId: sid,
      mode,
      sessions,
      preset,
      level,
      createdAt: Date.now(),
      title,
    }
    saveMap(m)
    log.info(`为 ${chat.chatId} 新建了 DSH 会话 ${sid.slice(-8)}（${preset}${debug ? '，调试' : ''}）`)
    return sid
  }

  async function resolveAgent(sid) {
    const live = dsh.agents.get(sid) || dsh.agents.get('session-' + sid)
    if (live) return live
    const r = await controller().resolveAgent(sid)
    if (r && r.agent) return r.agent
    const e = r && r.error
    throw Object.assign(new Error(e?.message || '恢复会话失败'), { code: e?.code })
  }

  const agentFor = (chat, turnToken?, assertMemoryCurrent?) =>
    personaScope.run(pnow(), () => agentForPersona(chat, turnToken, assertMemoryCurrent))

  async function agentForPersona(chat, turnToken?, assertMemoryCurrent?) {
    checkTurn(chat.chatId, turnToken)
    const failure = sessionFailure(chat.chatId)
    if (failure && Date.now() < failure.until) throw backoffError(chat.chatId, failure)
    const cfg = getConfig()

    const level =
      chat.kind === 'system' ? chat.level || (chat.noTools ? 'chat' : 'social') : levelFor(cfg, chat)

    const preset = presetForChat(chat, level)
    const entry = map().chats[chat.chatId]

    const mode = cfg.debug ? 'debug' : 'live'
    const sameLevel = Boolean(entry && entry.preset === preset && entry.level === level)
    const prevMode = (entry && entry.mode) || 'live'
    const remembered = sameLevel
      ? (entry.sessions && entry.sessions[mode]) || (prevMode === mode ? entry.sessionId : '')
      : ''
    let sid = remembered || ''
    let agent = null
    if (sid) {
      try {
        agent = await resolveAgent(sid)
      } catch (error) {
        assertActive()
        log.warn(`会话 ${sid.slice(-8)} 恢复不了（${error.message}），换一个新的`)
        sid = ''
      }
      assertActive()
      const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
      if (sid && reg && (reg.archivedSessionIds || []).includes(sid)) {
        let restored = false
        try {
          if (reg.unarchiveSession) {
            await reg.unarchiveSession(sid)
            restored = true
          }
        } catch (error) {
          log.debug(`会话 ${sid.slice(-8)} 解归档失败：${error.message}`)
        }
        if (restored) {
          log.info(`会话 ${sid.slice(-8)} 被归档了，已解归档，继续用这间`)
        } else {
          log.info(`会话 ${sid.slice(-8)} 被归档了，换一个新的`)
          sid = ''
          agent = null
        }
      }
    }
    if (!sid) {
      sid = await createSession(chat, level, turnToken)
      assertActive()
      agent = await resolveAgent(sid)
    }
    assertMemoryCurrent?.()

    if (sid) {
      const mm = map()
      const rec = mm.chats[chat.chatId] || {}
      mm.chats[chat.chatId] = {
        ...rec,
        sessionId: sid,
        mode,
        sessions: { ...(rec.sessions || {}), [mode]: sid },
        preset,
        level,
        title: rec.title || titleFor(chat),
      }
      saveMap(mm)
    }
    assertActive()

    const target = await resolveTarget(chat)
    assertActive()
    assertMemoryCurrent?.()
    const want = keyOf(target)
    const m = map()
    if (want && m.chats[chat.chatId]) {
      applyModel(agent, target)
      if (m.chats[chat.chatId].model !== want) {
        m.chats[chat.chatId].model = want
        saveMap(m)
        log.info(`${chat.chatId} 的模型切到 ${want}`)
      }
    }
    sessionToChat.set(sessionKey(sid), chat.chatId)
    sessionPersona.set(sessionKey(sid), pnow())
    if (target) sessionTarget.set(sessionKey(sid), { provider: target.provider, model: target.model })
    mount(agent, chat, level)
    sessionFailures.delete(chat.chatId)
    return { agent, sessionId: sid, level }
  }

  const { targetModel, resolveTarget, keyOf, applyModel } = createSessionModels({
    dsh,
    getConfig,
    availableModels,
    hooks,
    controller,
    log,
  })
  const health = () =>
    [...sessionFailures.keys()]
      .map((chatId) => ({ chatId, ...sessionFailure(chatId) }))
      .filter((row) => row.message)
  const isCreating = (chatId) =>
    ['live', 'debug'].some((mode) => sessionCreating.has(pnow() + '|' + chatId + ':' + mode))
  const dispose = () => {
    sessionFailures.clear()
    sessionCreating.clear()
  }
  return {
    agentFor,
    ensureWorkspace,
    chatCooldown,
    systemSessionCooldown,
    systemChatId,
    backoffError,
    applyModel,
    targetModel,
    health,
    isCreating,
    dispose,
  }
}
