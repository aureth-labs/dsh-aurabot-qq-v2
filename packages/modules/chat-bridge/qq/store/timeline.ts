import { isOwnerRoom, ownerId } from '../../../../../src/core/config/owners.ts'
import { isGroupRoom, isPrivateRoom, userOf } from '../../../../../src/core/bot/room.ts'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../../../src/core/store/index.ts'
import { existsSync, readFileSync } from 'node:fs'
import { matchesMemoryKeyword } from '../../../memory/engine/index.ts'
import { createConversationArchive } from '../../recall.ts'
import { createChatLog } from './chatlog.ts'
import { openEvidenceStore } from '../../../../../src/core/store/evidence.ts'
import { createMessageLogScope } from '../../../../../src/core/store/messages.ts'

export function createTimeline({ getConfig, log, store, hooks, saidElsewhere, proactiveLogAt, cleaningFor }) {
  const { isBeforeMemoryReset, memoryCutoffs, chatDir, chatMemoryCutoff } = store

  const logs = createMessageLogScope()
  const archives = new Map<string, ReturnType<typeof createConversationArchive>>()
  let evidence: ReturnType<typeof openEvidenceStore>
  let closed = false

  let forgottenRules = null

  const forgottenFile = () => join(dataDir('conversation-context'), 'forgotten.json')

  function conversationRules() {
    if (forgottenRules === null) {
      const rules = existsSync(forgottenFile()) ? JSON.parse(readFileSync(forgottenFile(), 'utf8')) : []
      if (
        !Array.isArray(rules) ||
        rules.some(
          (r) => !r || typeof r.qq !== 'string' || typeof r.query !== 'string' || !Number.isFinite(r.at),
        )
      )
        throw new Error('Conversation forget rules are corrupt; refusing recall')
      forgottenRules = rules
    }
    return forgottenRules
  }

  const conversationVisible = (chatId, message) =>
    !isBeforeMemoryReset(chatId, message.role === 'user' ? message.speakerId : '', message.at) &&
    !conversationRules().some(
      (r) =>
        (message.contextAt ?? message.at) <= r.at &&
        (chatId === 'private:' + r.qq ||
          (isGroupRoom(chatId) && message.role === 'user' && message.speakerId === r.qq)) &&
        (!r.query || matchesMemoryKeyword(message.text, r.query)),
    )

  const conversationArchive = (namespace = String(getConfig().persona?.current || 'default')) => {
    if (closed) throw Error('Conversation timeline closed')
    if (!archives.has(namespace))
      archives.set(
        namespace,
        createConversationArchive({
          directory: dataDir('conversation-context'),
          namespace,
          store: evidence ??= openEvidenceStore(dataDir('conversation-context')),
          visible: conversationVisible,
          visibleKey: () => conversationRules().length + '|' + JSON.stringify(memoryCutoffs(namespace)),
        }),
      )
    return archives.get(namespace)
  }

  const activity = {
    selfId: '',
    lastChatAt: 0,
    lastOwnerChatAt: 0,
    lastPrivateAt: new Map<string, number>(),
    lastBotToOwner: { at: 0, text: '' },
  }

  const chatLog = createChatLog({
    openLog: logs.open,
    getConfig,
    log,
    hooks,
    saidElsewhere,
    proactiveLogAt,
    isBeforeMemoryReset,
    chatDir,
    chatMemoryCutoff,
    cleaningFor,
  })

  const { logChat, noteSaid, noteProactive, chatLogDays, deleteChatLog, chatLogOf, proactiveFromChatLog } =
    chatLog

  function restoreProactiveFromChatLog() {
    const owner = String(ownerId(getConfig()) || '')
    if (!owner || !/^\d+$/.test(owner)) return
    let ownerAt = 0
    let botAt = 0
    let botText = ''
    for (const day of chatLogDays().slice(-3)) {
      for (const row of chatLogOf(day)) {
        if (!isOwnerRoom(getConfig(), row?.chatId)) continue
        const at = Number(row.t) || 0
        if (!at) continue
        if (row.who === 'bot') {
          if (at > botAt) {
            botAt = at
            botText = String(row.text || '')
          }
        } else if (at > ownerAt) ownerAt = at
      }
    }
    if (ownerAt) {
      activity.lastOwnerChatAt = ownerAt
      activity.lastPrivateAt.set(owner, ownerAt)
    }
    if (botAt) activity.lastBotToOwner = { at: botAt, text: botText }
  }

  function forgetChatLog(qq, query = '') {
    if (existsSync(dataDir('conversation-context'))) {
      const rules = [...conversationRules(), { qq: String(qq), query: String(query), at: Date.now() }]
      writeJson(forgottenFile(), rules)
      forgottenRules = rules
    }
    let marked = 0
    try {
      const store = logs.open(chatDir())
      for (const day of store.days()) {
        marked += store.mutate(day, (row) => {
          const own =
            row.chatId === `private:${qq}` ||
            (isGroupRoom(row.chatId) && String(row.uid || '') === String(qq))
          if (!own || row.forgottenAt || (query && !matchesMemoryKeyword(row.text, query))) return
          return { ...row, forgottenAt: Date.now() }
        })
      }
    } catch (error) {
      log.warn('标记聊天流水失败：', error.message)
    }
    if (marked) chatLog.bumpRevision()
    return marked
  }
  // chatId → 群里最近一段最后说话的人

  function noteTurnActivity(chatId, sentItems) {
    activity.lastChatAt = Date.now()
    if (isPrivateRoom(chatId)) activity.lastPrivateAt.set(userOf(chatId), Date.now())
    if (isOwnerRoom(getConfig(), chatId)) {
      activity.lastBotToOwner = {
        at: Date.now(),
        text: sentItems
          .filter((i) => i.kind === 'text' || i.kind === 'voice')
          .map((i) => i.value)
          .join('\n'),
      }
    }
  }
  restoreProactiveFromChatLog()
  function closeLogs() {
    if (closed) return
    closed = true
    for (const archive of archives.values()) archive.close()
    archives.clear()
    evidence?.close()
    logs.close()
  }
  return { conversationArchive, activity, chatLog, forgetChatLog, noteTurnActivity, closeLogs }
}
