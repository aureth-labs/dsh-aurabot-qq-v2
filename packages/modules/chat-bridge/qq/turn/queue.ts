import { mediaLimits } from '../../../../../src/core/message/media/limits.ts'
import { type ContentBlock } from '../context/context.ts'
import { isSessionBackoff } from './session-backoff.ts'
import { isOwner } from '../../../../../src/chat/policy/rules/access.ts'

export function createTurnQueue({
  getConfig,
  log,
  isDisposed,
  turnGuard,
  groups,
  stickerHint,
  stats,
  groupPrompt,
  lastSpeaker,
  pushToSession,
}) {
  const {
    groupChatAllowed,
    pending,
    RANK,
    isBusy,
    running,
    busyTurns,
    turnSignature,
    busySessions,
    clearRunning,
    busy,
  } = turnGuard
  const { groupRefs, groupEngagedRun, groupInterjects, groupMusts } = groups

  function enqueue(chat, content, senderId, wantVoice, mode = 'must', extra: { stickerPick?: number; messageId?: string } = {}) {
    if (!groupChatAllowed(chat.chatId)) return
    const m = getConfig().merge
    const p = pending.get(chat.chatId) || {
      chat,
      texts: [],
      images: [],
      senders: new Set(),
      messageIds: new Set<string>(),
      wantVoice: false,
      timer: null,
      firstAt: Date.now(),
      mode,
      count: 0,
    }
    if (extra.messageId && extra.messageId !== '0') p.messageIds.add(extra.messageId)
    p.chat = chat
    p.count++
    if ((RANK[mode] || 3) > (RANK[p.mode] || 3)) p.mode = mode
    for (const c of content) {
      if (c.type === 'text') p.texts.push(c.text)
      else if (c.type === 'image' && p.images.length < mediaLimits(getConfig().media).maxImages) p.images.push(c)
    }
    if (extra.stickerPick) p.stickerPick = (p.stickerPick || 0) + extra.stickerPick
    if (senderId) p.senders.add(String(senderId))
    p.wantVoice = p.wantVoice || wantVoice
    pending.set(chat.chatId, p)
    clearTimeout(p.timer)
    if (!m.enabled) return flush(chat.chatId)

    const group = chat.kind === 'group'
    const wait = (group ? m.groupWaitSec : m.waitSec) * 1000
    const max = (group ? m.groupMaxSec : m.maxSec) * 1000
    const left = Math.max(0, max - (Date.now() - p.firstAt))
    p.timer = setTimeout(() => flush(chat.chatId), Math.min(wait, left))
    p.timer.unref?.()
  }

  function retainSessionMessages(chatId, p, content) {
    if (p.chat.kind === 'group') {
      p.retryContent = content
      p.retryArchiveMessages = p.archiveMessages
      p.retryQuery = p.query
      p.retrySpeakers = p.speakers
      p.retryRefs = groupRefs.get(p.chat.groupId) || {}
      p.images = [] // 已在 retryContent 里，下次只追加新来的图片
    }
    const next = pending.get(chatId)
    if (next) {
      clearTimeout(next.timer)
      p.texts.push(...next.texts)
      p.images = [...p.images, ...next.images].slice(0, mediaLimits(getConfig().media).maxImages)
      for (const id of next.messageIds) p.messageIds.add(id)
      for (const sender of next.senders) p.senders.add(sender)
      p.count += next.count
      p.wantVoice ||= next.wantVoice
      p.stickerPick = (p.stickerPick || 0) + (next.stickerPick || 0)
      if ((RANK[next.mode] || 3) > (RANK[p.mode] || 3)) p.mode = next.mode
    }
    p.waiting = false
    p.timer = null
    pending.set(chatId, p)
  }

  async function flush(chatId) {
    if (isDisposed()) return
    const p = pending.get(chatId)
    if (!p) return
    clearTimeout(p.timer)
    if (!groupChatAllowed(chatId)) {
      pending.delete(chatId)
      return
    }

    const hint = p.stickerPick ? '\n\n' + stickerHint(p.stickerPick) : ''

    if (isBusy(chatId) && p.chat.kind === 'private' && running.has(chatId)) {
      pending.delete(chatId)
      if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起插给她`)
      const content: ContentBlock[] = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
      const query = p.texts.map((t) => t.replace(/^【私聊】[^：]*：/, '')).join('\n')
      const [first, ...rest] = [...p.senders]
      try {
        await pushToSession(p.chat, content, first, {
          wantVoice: p.wantVoice,
          extraSenders: rest,
          queryText: query,
          quoteIds: [...p.messageIds],
          steer: true,
          turnToken: busyTurns.get(chatId),
        })
      } catch (error) {
        if (isSessionBackoff(error)) {
          retainSessionMessages(chatId, p, content)
          return
        }
        stats.bump('errors')
        log.error(`插话进 DSH 失败（${chatId}）：`, error.message)
      }
      return
    }

    if (isBusy(chatId)) {
      p.waiting = true
      return
    }
    pending.delete(chatId)
    if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起交给她`)
    let content
    if (p.chat.kind === 'group') {
      const gid = p.chat.groupId
      groupEngagedRun.set(gid, p.mode === 'engaged' ? (groupEngagedRun.get(gid) || 0) + 1 : 0)
      if (p.mode === 'interject') {
        const arr = (groupInterjects.get(gid) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupInterjects.set(gid, arr)
      }

      if (p.mode === 'must' && ![...p.senders].some((id) => isOwner(getConfig(), id))) {
        const arr = (groupMusts.get(gid) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupMusts.set(gid, arr)
      }
      const refOffset = Math.max(0, ...Object.keys(p.retryRefs || {}).map(Number))
      const gp = await groupPrompt(p.chat, p.mode, Math.max(0, mediaLimits(getConfig().media).maxImages - p.images.length), refOffset)
      if (isDisposed()) return
      if (gp.speakers.length) lastSpeaker.set(chatId, [...p.senders].pop() || gp.speakers.at(-1))
      const freshContent = [{ type: 'text', text: gp.text + hint }, ...p.images, ...(gp.images || [])]

      if (p.retryRefs) groupRefs.set(p.chat.groupId, { ...p.retryRefs, ...groupRefs.get(p.chat.groupId) })
      const retainedIds = new Set((p.retryArchiveMessages || []).map((message) => message.id))
      content = p.retryContent ? [...p.retryContent, ...(gp.freshCount ? freshContent : [])] : freshContent
      p.query = [p.retryQuery, gp.query].filter(Boolean).join('\n')
      p.speakers = [...new Set([...(p.retrySpeakers || []), ...gp.speakers])]
      p.autoReply = gp.autoReply
      p.archiveMessages = [
        ...(p.retryArchiveMessages || []),
        ...gp.archiveMessages.filter((message) => !retainedIds.has(message.id)),
      ]
      p.directRequester = gp.directRequester
    } else {
      content = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
    }
    const turnToken = { signature: turnSignature(chatId) }
    busyTurns.set(chatId, turnToken)
    busySessions.delete(chatId)
    clearRunning(chatId)
    busy.set(chatId, Date.now())
    try {
      const [first, ...rest] = [...p.senders]

      const query = p.query ?? p.texts.map((t) => t.replace(/^【私聊】[^：]*：/, '')).join('\n')
      await pushToSession(p.chat, content, first, {
        wantVoice: p.wantVoice,
        extraSenders: rest,
        queryText: query,
        speakers: p.speakers,
        autoReply: p.autoReply,
        quoteIds: p.chat.kind === 'group'
          ? Object.values<{ mid: string }>(groupRefs.get(p.chat.groupId) || {}).map(row => row.mid)
          : [...p.messageIds],
        turnToken,
        archiveMessages: p.archiveMessages,
        directRequester: p.directRequester,
      })
    } catch (error) {
      if (isSessionBackoff(error)) {
        retainSessionMessages(chatId, p, content)
        busy.delete(chatId)
        clearRunning(chatId)
        return
      }
      release(chatId, turnToken)
      stats.bump('errors')
      log.error(`转进 DSH 失败（${chatId}）：`, error.message)
    }
  }

  function release(chatId, owner?) {
    if (isDisposed()) return
    if (owner && typeof owner === 'object') {
      if (busyTurns.get(chatId) !== owner) return
    } else if (owner && busySessions.get(chatId) !== owner) return
    busy.delete(chatId)
    busySessions.delete(chatId)
    busyTurns.delete(chatId)
    clearRunning(chatId)
    const p = pending.get(chatId)
    if (p && p.waiting) {
      p.waiting = false
      flush(chatId).catch(() => {})
    }
  }

  return { enqueue, release }
}
