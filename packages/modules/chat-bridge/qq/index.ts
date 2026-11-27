import { createMessageMedia } from './media/context.ts'
import { createTimeline } from './store/timeline.ts'
import { createSessionReset } from './session/reset.ts'
import { createDirectTurns } from './turn/direct.ts'
import { createBackgroundTurns } from './turn/background.ts'
import { createTurnSubmission } from './turn/submit.ts'
import { createTurnQueue } from './turn/queue.ts'
import { createIncomingMessages } from './events/message.ts'
import { createSessionBindings } from './session/bindings.ts'
import { createTurnEvents } from './turn/events.ts'
import { createSessionManager } from './session/manager.ts'
import { ignoredGroupMember } from '../../../../src/chat/inbound/filter/member-filter.ts'

import { createDeliverySources } from './delivery/sources.ts'
import { dataDir } from '../../../../src/core/store/index.ts'
import { groupOf, isGroupRoom, isLegacyScope } from '../../../../src/core/bot/room.ts'
import { parseReply, bubbleDelay, itemsToLine, cleanOutboundText, cleanOutboundSegments,
  tidyPunctuation, hasSuspectTagShape } from '../../../../src/chat/reply/index.ts'
import { checkAllowed, groupResponseMode, isOwner } from '../../../../src/chat/policy/rules/access.ts'
import { createFaces } from '../../../adapters/qq/onebot-v11/src/face/index.ts'
import { guardOutgoing } from '../../../../src/chat/inbound/hooks/guard.ts'
import { currentPromptSources } from '../../../../src/security/leak-guard.ts'
import { noticeText } from '../../../../src/chat/reply/notices/index.ts'
import { personaDataRoots } from '../../../../src/persona/personas.ts'

export * from './context/context.ts'

import { createSessionStore } from './store/sessions.ts'
import { createOutbound } from './delivery/outbound.ts'
import { createDeliver } from './delivery/deliver.ts'
import { createTurnState } from './turn/turn-state.ts'
import { createStats } from './store/stats.ts'
import { stickerHint } from './format/sticker.ts'
import { createMediaScope, type AccountMedia } from './media/account.ts'
import { createGroupEvents } from './events/group.ts'
import { createNoticeHandler } from './events/notices.ts'
import { createSubagent } from './subagent/index.ts'
import { createOutboundGuard } from './delivery/guard.ts'
import { createDirectory } from '../directory.ts'
import { createReact } from './media/react.ts'
import { createSessionQuery } from './session/query.ts'
import { createTyping } from './media/typing.ts'
import { createCapture } from './turn/capture.ts'
import { captureStore, sessionKey, simulationStore } from './context/context.ts'

export function createHub({
  scope = null,
  dsh,
  getConfig,
  log,
  bot: botOf,
  outbox,
  stickers,
  tts,
  asr,
  buildTools,
  contextProviders,
  onActivity,
  memoryScore,
  onMemoryCommand,
  onCommand,
  isMuted,
  dislikes,
  random = Math.random,
  moodEffects,
  localApi,
  hooks,
  availableModels,
  toolsGeneration,
  capabilitiesOf,
  askModel,
}) {
  const mood = () =>
    (typeof moodEffects === 'function' ? moodEffects() : null) || {
      sticker: 1,
      voice: 1,
      delay: 1,
      chatty: 1,
    }
  const store = createSessionStore({ getConfig })
  const { pnow, map, sessionPersona, memoryResetAt, filterHistory } = store

  const sessionToChat = new Map() // sessionKey → chatId
  const sessionTarget = new Map() // sessionKey → { provider, model }：记 token 用量时按这次会话用的模型计价
  const turnState = new Map()

  const systemStarting = new Set() // 建会话和恢复期间，同一个聊天只能有一个调用
  const systemFailures = new Map()
  const groups = {
    groupBuf: new Map(),
    groupInterjects: new Map(),
    groupSaid: new Map(),
    groupMusts: new Map(),
    groupRefs: new Map(),
    groupEngaged: new Map(),
    groupEngagedRun: new Map(),
    groupNames: new Map(),
  }
  const { groupBuf, groupInterjects, groupSaid, groupRefs, groupEngaged, groupEngagedRun, groupNames } =
    groups
  const ENGAGE_MS = 3 * 60_000
  const { refreshFriends, isFriend, membersOf, userName } = createDirectory(botOf, log)

  const legacyScope = !scope || isLegacyScope(scope.platform, scope.botId)
  const scopeDir = legacyScope ? [] : ['bots', `${scope.platform}-${scope.botId}`.replace(/[^\w.-]/g, '_')]
  const localMedia = hooks?.media ? undefined : createMediaScope(
    () => botOf()?.status === 'online' ? String(botOf().selfId || '') || null : null,
    log, [...scopeDir, 'primary-media'])
  let previousMedia: AccountMedia | undefined
  function clearGroupMedia() {
    for (const cache of Object.values(groups)) cache.clear()
    sentIds.clear()
  }
  function currentMedia(): AccountMedia | undefined {
    const next = disposed ? undefined : hooks?.media ? hooks.media() : localMedia.current()
    if (next && next !== previousMedia) {
      next.signal.addEventListener('abort', clearGroupMedia, { once: true })
    }
    previousMedia = next
    return next
  }
  const pauses = new Set<() => void>()
  const sendChain = new Map() // chatId → 串行发送链：中间段和最后一段排同一条队列，保证发出顺序和生成顺序一致

  function chainSend(chatId, run, label) {
    const start = () => {
      try {
        return Promise.resolve(run())
      } catch (error) {
        return Promise.reject(error)
      }
    }
    const prev = sendChain.get(chatId)

    const next = (prev ? prev.then(start, start) : start()).catch((error) => log.warn(label, error.message))
    sendChain.set(chatId, next)
    const done = () => {
      if (sendChain.get(chatId) === next) sendChain.delete(chatId)
    }
    next.then(done, done)
    return next
  }
  const faces = createFaces({ bot: botOf, log })
  const { maybeReact } = createReact({ getConfig, log, botOf, faces, mood })
  const noticesFor = new Map() // chatId → [一句话]  下次交给她时带上的群事件（撤回、禁言、进群……）
  const saidElsewhere = new Map() // chatId → [{ at, text }]  别处安排她在这里发的话，下次这个聊天交给她时补进去
  const proactiveLogAt = new Map() // chatId → 已从流水补进过一次的最大时间戳（重启后回捞用，避免同一批重复注入）
  const { outputSources, outputScope, sourcesFor, cleaningFor } = createDeliverySources(
    () => getConfig().ownerQQ,
    (chatId) => hooks?.secrets?.({ chatId }) ?? [],
    (message) => log.warn(message),
  )

  let disposed = false
  const isDisposed = () => disposed
  const disposedError = () => Object.assign(new Error('Aurabot 插件已卸载'), { code: 'AURABOT_DISPOSED' })
  const assertActive = () => {
    if (disposed) throw disposedError()
  }

  const turnGuard = createTurnState({ getConfig, log, map, assertActive })
  const { busy, running, groupChatAllowed, checkTurn, isBusy } = turnGuard

  const { setOutboundGuard, wantsOutbound, passOutbound, settleOutbound } = createOutboundGuard({ log })

  function pause(ms) {
    if (disposed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        pauses.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      pauses.add(done)
    })
  }

  const sentIds = new Set()
  const stats = createStats({ file: dataDir(...scopeDir, 'stats.json'), log })
  const { conversationArchive, activity, chatLog, forgetChatLog, noteTurnActivity, closeLogs } = createTimeline({
    getConfig,
    log,
    store,
    hooks,
    saidElsewhere,
    proactiveLogAt,
    cleaningFor,
  })
  const { logChat, noteSaid, noteProactive, chatLogDays, deleteChatLog, chatLogOf, proactiveFromChatLog } =
    chatLog
  const notices = createNoticeHandler({
    getConfig,
    bot: botOf,
    allowed: (ev) => {
      const account = botOf()
      const owner = isOwner(getConfig(), ev.userId, { platform: account?.platform, botId: account?.id })
      return owner || checkAllowed(getConfig(), { kind: ev.type, userId: String(ev.userId), groupId: ev.type === 'group' ? String(ev.channelId) : '', platform: account?.platform, botId: account?.id }).allowed
    },
    userName,
    log,
    isDisposed,
    sentIds,
    faces,
    noticeText,
    logChat,
    noticesFor,
  })

  const lastPoker = new Map() // chatId → 最近戳她的人（她戳回去用）
  const lastSpeaker = new Map()

  const outbound = createOutbound({
    getConfig,
    log,
    bot: botOf,
    outbox,
    stickers,
    tts,
    hooks,
    isDisposed,
    bump: stats.bump,
    pnow,
    sentIds,
    outputScope,
    outputSources,
    currentPromptSources,
    groupEngaged,
    groupEngagedRun,
    groupInterjects,
    groupChatAllowed,
    cleaningFor,
    membersOf,
    faces,
    wantsOutbound,
    passOutbound,
    settleOutbound,
    noteProactive,
    pause,
    lastPoker,
    lastSpeaker,
  })
  const {
    targetOf,
    sendSegments,
    sendText,
    sendVoice,
    pokeBack,
    sendVoiceFile,
    sendFile,
    sendSticker,
    localImageBlocked,
    sendImage,
    silenceTurn,
    checkSendableFile,
    flushOutbox,
  } = outbound

  const bindings = createSessionBindings({
    log,
    getConfig,
    random,
    outbound,
    cleaningFor,
    assertActive,
    buildTools,
    hooks,
    toolsGeneration,
    turnState,
    turnGuard,
    isDisposed,
    contextProviders,
    sourcesFor,
    outputSources,
  })
  const {
    mount,
    remountAll,
    mounted,
    applyGroupGate,
    clearSlowNotices,
    slowNoticeSent,
    dispose: disposeMounts,
  } = bindings
  const sessions = createSessionManager({
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
  })
  const {
    agentFor,
    ensureWorkspace,
    chatCooldown,
    systemSessionCooldown,
    targetModel,
    health: sessionHealth,
    isCreating,
    dispose: disposeSessions,
  } = sessions

  const deliverMod = createDeliver({
    getConfig,
    log,
    hooks,
    stickers,
    groupRefs,
    groupSaid,
    groupEngaged,
    ENGAGE_MS,
    saidElsewhere,
    askModel,
    outputScope,
    outputSources,
    currentPromptSources,
    groupChatAllowed,
    cleaningFor,
    random,
    mood,
    silenceTurn,
    guardOutgoing,
    parseReply,
    hasSuspectTagShape,
    tidyPunctuation,
    cleanOutboundSegments,
    itemsToLine,
    bubbleDelay,
    pause,
    sendText,
    sendVoice,
    sendSticker,
    pokeBack,
    localImageBlocked,
    sendImage,
    sendFile,
    logChat,
    onActivity,
    noteTurnActivity,
    isDisposed,
  })
  const { deliver, setOutboundEngineResolver } = deliverMod

  const media = createMessageMedia({
    currentMedia,
    getConfig,
    log,
    bot: botOf,
    store,
    groups,
    turnGuard,
    faces,
    activity,
    sentIds,
    assertActive,
    asr,
  })
  const {
    recentMediaOf,
    groupName,
    referenceImage,
    repliedToBot,
    transcribe,
    localTranscribe,
    fitForModel,
    groupPrompt,
  } = media
  const { onGroupFile, onPoke } = createGroupEvents({
    isDisposed,
    getConfig,
    getSelfId: () => activity.selfId,
    bot: botOf,
    userName,
    hooks,
    lastPoker,
    ignoredGroupMember,
    groupResponseMode,
    onMessage: (event) => onMessage(event),
    log,
  })
  const { enqueue, release } = createTurnQueue({
    getConfig,
    log,
    isDisposed,
    turnGuard,
    groups,
    stickerHint,
    stats,
    groupPrompt,
    lastSpeaker,
    pushToSession: (chat, content, senderId, options) => pushToSession(chat, content, senderId, options),
  })

  const typing = createTyping({ isDisposed, getConfig, bot: botOf })
  const { startTyping, stopTyping } = typing

  const {
    chatOfSession,
    findSession,
    turnHasOwner,
    turnSenders,
    turnSendersAllOwner,
    turnDirectFromOwner,
    personaOf,
    hubBusy,
    isOwnedSession,
  } = createSessionQuery({
    getConfig,
    isOwner,
    sessionKey,
    turnState,
    sessionToChat,
    sessionPersona,
    mounted,
    busy,
    isBusy,
    running,
    systemStarting,
    map,
    personaDataRoots,
  })

  const { capture, simulateTurn } = createCapture({ captureStore, simulationStore, turnState, sessionKey })

  const { pushToSession, clearSeed } = createTurnSubmission({
    getConfig,
    log,
    dsh,
    bot: botOf,
    activity,
    targetOf,
    assertActive,
    store,
    turnGuard,
    agentFor,
    turnState,
    memory: {
      sourcesFor,
      conversationArchive,
      noticesFor,
      saidElsewhere,
      proactiveFromChatLog,
      proactiveLogAt,
      outputSources,
    },
    hooks,
    release,
    startTyping,
    applyGroupGate,
    turnSendersAllOwner,
  })
  const { resetChat, resetPersonChat, resetSessions } = createSessionReset({
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
    currentMedia,
    groupBuf,
  })
  const background = createBackgroundTurns({
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
  })
  const directTurns = createDirectTurns({
    getConfig,
    log,
    assertActive,
    turnGuard,
    outbound,
    sessions,
    store,
    release,
    pushToSession,
    isMuted,
    transcribe,
    fitForModel,
    onMemoryCommand,
    logChat,
    activity,
    onActivity,
  })
  const { onSessionEvent } = createTurnEvents({
    isDisposed,
    selfId: () => activity.selfId,
    sessionToChat,
    sessionTarget,
    store,
    findSession,
    turnState,
    getConfig,
    log,
    chainSend,
    deliver,
    slowNoticeSent,
    clearSlowNotices,
    turnGuard,
    stopTyping,
    mounted,
    release,
    conversationArchive,
    sendChain,
  })

  const { onMessage } = createIncomingMessages({
    getConfig,
    log,
    isDisposed,
    store,
    activity,
    groups,
    turnGuard,
    policy: {
      onCommand,
      onMemoryCommand,
      isMuted,
      dislikes,
      random,
      onActivity,
      hooks,
      maybeReact,
      mood,
      memoryScore,
    },
    media: { ...media, faces, stickers, currentMedia },
    conversation: { stats, logChat, refreshFriends, repliedToBot, sendSegments },
    enqueue,
  })

  const subagent = createSubagent({
    dsh,
    getConfig,
    agentFor,
    assertActive,
    capabilitiesOf,
    log,
    getLastOwnerChatAt: () => activity.lastOwnerChatAt,
  })
  const { subagentFor, runSubagentTurn } = subagent

  function dispose() {
    if (disposed) return
    disposed = true

    stats.save(true)

    subagent.reset()
    turnGuard.dispose()
    typing.stopAll()
    for (const done of [...pauses]) done()
    background.dispose(disposedError())
    directTurns.dispose()
    disposeMounts()
    sessionToChat.clear()
    turnState.clear()
    outputSources.clear()
    disposeSessions()
    previousMedia?.signal.removeEventListener('abort', clearGroupMedia)
    localMedia?.dispose()
    clearGroupMedia()
    previousMedia = undefined

    closeLogs()
  }

  return {
    dispose,

    cleanOutbound: (chatId, text) => cleanOutboundText(String(text ?? ''), cleaningFor(chatId)),

    remountAll,
    ensureDebugSession: background.ensureDebugSession,
    debugSay: background.debugSay,
    modelFor: targetModel,

    recentMedia: recentMediaOf,
    recentImages: (id: string) => recentMediaOf(id),
    stickerElement: (id: string, index: number) => currentMedia()?.stickers.of(id, index),
    referenceImage,
    recentFiles: (chatId) => currentMedia()?.files.get(chatId) || [],
    stickerOf: (chatId, index) => currentMedia()?.stickers.of(chatId, index) ?? null,
    capture,
    simulateTurn,
    onMessage,
    onSessionEvent,

    maybeReact,
    deliver,
    sendText,

    setOutboundGuard,

    setOutboundEngineResolver,
    sendVoice,
    sendVoiceFile,
    sendFile,
    sendSticker,
    sendImage,
    checkSendableFile,
    sendSegments,
    flushOutbox,

    noteProactive,
    pushToSession,
    runTurnInChat: directTurns.runTurnInChat,
    receiveOwnerMessage: directTurns.receiveOwnerMessage,
    runSystemTurn: background.runSystemTurn,
    systemSessionCooldown,
    chatCooldown,
    sessionHealth,
    runSubagentTurn,
    subagentFor,
    turnSendersAllOwner,
    turnDirectFromOwner,

    turnRunning: (chatId) => running.has(String(chatId || '')),

    markSlowNotice: (sessionId) => {
      if (sessionId) slowNoticeSent.add(sessionKey(sessionId))
    },
    onNotice: (ev) => ev.action === 'poke' ? onPoke(ev) : ev.action === 'file' ? onGroupFile(ev) : notices.onNotice(ev),
    turnHasOwner,
    turnSenders,
    resetChat,
    resetPersonChat,
    memoryResetAt,
    filterHistory,
    recallQuote(chatId: string, messageId: string) {
      media.quotes.recall(chatId, messageId)
      if (isGroupRoom(chatId)) {
        for (const row of groupBuf.get(groupOf(chatId)) || []) if (row.replyId === messageId) row.quote = null
      }
    },
    joinTopic: (gid) => groupEngaged.set(String(gid), Date.now() + ENGAGE_MS),
    leaveTopic: (gid) => groupEngaged.delete(String(gid)),
    chatOfSession,
    personaOf,
    busy: hubBusy,
    isOwnedSession,
    resetSessions,
    lastTextOf: (sessionId) => turnState.get(sessionKey(sessionId))?.lastText || '',
    prevTextOf: (sessionId) => turnState.get(sessionKey(sessionId))?.prevText || '',
    recentMessagesOf: (chatId, limit = 32) =>
      getConfig().conversationContext?.enabled === true ? conversationArchive().recent(chatId, limit) : [],
    speakersOf: (sessionId) => turnState.get(sessionKey(sessionId))?.speakers || [],
    logChat,
    chatLogRevision: () => chatLog.revision(),
    refreshFriends,
    isFriend: (id) => isFriend(String(id)),
    localTranscribe,
    ensureWorkspace,
    chatLogOf,
    forgetChatLog,
    noteSaid,
    chatLogDays,
    deleteChatLog,
    sessions: () => map().chats,
    groupName,
    stats: () => ({ ...stats.value }),
    get lastChatAt() {
      return activity.lastChatAt
    },
    get lastOwnerChatAt() {
      return activity.lastOwnerChatAt
    },
    lastPrivateAt: (qq) => activity.lastPrivateAt.get(String(qq)) || 0,

    saidElsewhereOf: (chatId) => (saidElsewhere.get(String(chatId)) || []).map((x) => x.text),

    proactiveHistoryOf: (chatId) => proactiveFromChatLog(String(chatId)).map((x) => x.text),
    get lastBotToOwner() {
      return activity.lastBotToOwner
    },
    get selfId() {
      return activity.selfId
    },
    groupNames,
  }
}
