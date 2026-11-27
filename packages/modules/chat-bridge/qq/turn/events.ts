import { isGroupRoom } from '../../../../../src/core/bot/room.ts'
import { sessionKey, assistantReplyText, SOURCE_KIND } from '../context/context.ts'
import { recordSessionUsage } from '../../../../../src/core/llm/usage/usage.ts'
import { personaScope } from '../../../../../src/persona/personas.ts'
import {
  reasoningOf,
  everyStepMode as everyStepOn,
  adoptInterim,
  mergeStepText,
  similarText,
  takeInterim,
  rescueFromThinking,
} from './steps.ts'
import { markerApplies, extractMarkedReply, stripMarkers } from '../../../../../src/chat/reply/context/reply-marker.ts'
import { randomUUID } from 'node:crypto'
import { redact } from '../../../../../src/core/support/log/redact.ts'

export function createTurnEvents({
  isDisposed,
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
}) {
  const { pnow, sessionPersona } = store
  const { clearRunning, markRunning } = turnGuard

  function textOf(message) {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()
  }

  function onSessionEvent(session, event) {
    if (isDisposed()) return
    const key = sessionKey(session && session.id)

    const found = sessionToChat.has(key) ? null : findSession(key)
    const chatId = sessionToChat.get(key) || found?.chatId
    if (!chatId || !event) return
    try {
      recordSessionUsage(key, chatId, event, sessionTarget.get(key))
    } catch {}
    return personaScope.run(sessionPersona.get(key) || pnow(), () =>
      onPersonaSessionEvent(key, chatId, event),
    )
  }

  function onPersonaSessionEvent(key, chatId, event) {
    const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
    turnState.set(key, st)
    if (event.type === 'user/message') {
      const src = event.data && event.data.source
      if (src && src.kind === 'user') st.directOwner = true
      const direct = textOf(event.data && event.data.message)
      if (direct) {
        if (st.lastText) st.prevText = st.lastText
        st.lastText = direct.slice(-600)
        st.speakers = [String(getConfig().ownerQQ)]
        st.senders = new Set([String(getConfig().ownerQQ)])
      }
      return
    }
    if (event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.interrupted) return

      const th = reasoningOf(d.message)
      if (th) st.thinking = { turn: d.turn, text: th }
      const hasToolCall = Boolean(
        d.message?.content?.some((b) => b && (b.type === 'tool-call' || b.type === 'tool_use')),
      )
      const raw = assistantReplyText(d.message)
      const toolText = hasToolCall
        ? (d.message?.content || [])
            .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('\n')
            .trim()
        : ''

      st.toolText = toolText

      if (hasToolCall) st.sawToolCall = true

      st.lastTurn = d.turn

      if (everyStepOn(getConfig().chat?.everyStep, st)) {
        st.text = raw || st.text
        st.mergedText = ''
      } else {
        const adopted = adoptInterim(st, { turn: d.turn, step: d.step })
        if (adopted) st.mergedText = mergeStepText(st.mergedText, adopted)
        if (raw) st.mergedText = mergeStepText(st.mergedText, raw)
        st.text = st.mergedText || st.text
      }

      if (raw && !st.suppressDelivery && everyStepOn(getConfig().chat?.everyStep, st)) {
        const dupThreshold = Number(getConfig().chat?.dupSimilarity ?? 0.45)
        const prevSameTurn = st.interimTurn === d.turn ? String(st.interimText || '') : ''
        const repeated = Boolean(prevSameTurn) && similarText(prevSameTurn, raw) >= dupThreshold
        const prev = takeInterim(st, { turn: d.turn, step: d.step, text: raw })
        if (repeated && prev) {
          log.debug(`${chatId}：这一段和上一段重复（相似度 ≥ ${dupThreshold}），不再单发`)
        }
        if (prev && !repeated) {
          log.debug(`${chatId}：分条发出上一段（${prev.length} 字）`)
          const onDelivered = st.onDelivered
          const incomingReply = Boolean(st.turnToken)
          chainSend(
            chatId,
            () => deliver(chatId, prev, { own: true, interim: true, onDelivered, incomingReply }),
            '分条发送出错：',
          )
        }
      }
      return
    }
    if (event.type === 'turn/end') {
      st.sawToolCall = false
      slowNoticeSent.delete(key)
      clearSlowNotices(key)
      const turnToken = st.turnToken
      clearRunning(chatId, key)
      stopTyping(key)
      const d = event.data || {}
      const completed = d.reason && d.reason.kind === 'completed'
      let text = st.lastTurn === d.turn ? st.text : ''
      st.mergedText = '' // 本轮攒下的段落已交给 text，清掉免得带进下一轮
      let fromThinking = false

      if (
        !text &&
        completed &&
        getConfig().chat?.rescueFromThinking &&
        st.thinking &&
        st.thinking.turn === d.turn
      ) {
        const rescued = rescueFromThinking(st.thinking.text)
        if (rescued) {
          text = rescued
          fromThinking = true
          log.info(`${chatId}：整轮没有正文，从思考里捞回一段（${rescued.length} 字）`)
        }
      }

      if (text && completed && markerApplies(getConfig(), chatId)) {
        const marked = extractMarkedReply(text)
        if (marked.found) {
          text = stripMarkers(marked.text)
          fromThinking = false
        } else if (!st.markerRetried) {
          st.markerRetried = true
          const rec = mounted.get(key)
          const agent = rec && rec.agent
          if (agent && typeof agent.followup === 'function') {
            log.info(`${chatId}：输出里没有正文标记，要求重写一次`)
            try {
              markRunning(chatId)
              const msg = {
                id: randomUUID(),
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: '（系统提醒，不是对方说的话）你刚才的输出没有正文标记，这条发不出去。现在重新输出：只写 ⟦REPLY⟧你要说的话⟦/REPLY⟧，标记外面不要有任何内容。',
                  },
                ],
                source: {
                  kind: SOURCE_KIND,
                  speaker: {
                    role: 'system',
                    chat: isGroupRoom(chatId) ? 'group' : 'private',
                  },
                },
              }

              agent.followup(msg).catch((error) => {
                log.warn('重写请求失败：', error.message)
                release(chatId)
              })
            } catch (error) {
              log.warn('重写请求发不出去：', error.message)
              release(chatId)
            }
          } else {
            release(chatId)
          }
          return
        } else {
          log.info(`${chatId}：重写后仍然没有正文标记，这轮不发`)
          text = ''
        }
      }
      st.thinking = null
      st.toolText = ''

      if (
        completed &&
        text &&
        st.archiveNamespace &&
        !st.suppressDelivery &&
        !chatId.startsWith('system:') &&
        getConfig().conversationContext?.enabled === true
      ) {
        try {
          conversationArchive(st.archiveNamespace).append(chatId, {
            role: 'assistant',
            text,
            id: key + ':turn:' + d.turn,
            contextAt: st.archiveContextAt,
            speakerId: getConfig().botQQ || '',
          })
        } catch (error) {
          log.warn('对话记忆保存失败：', error.message)
        }
      }
      if (st.pendingArchiveNamespace) {
        st.archiveNamespace = st.pendingArchiveNamespace
        st.pendingArchiveNamespace = ''
        st.archiveContextAt = st.pendingArchiveContextAt
        st.pendingArchiveContextAt = 0
      }
      const sys = st.system
      const wantVoice = Boolean(st.wantVoice)
      const quoteIds = st.quoteIds || []
      st.quoteIds = st.pendingQuoteIds || []
      st.pendingQuoteIds = []
      const autoReply = st.autoReply
      const onDelivered = st.onDelivered
      st.onDelivered = st.pendingOnDelivered || null
      st.pendingOnDelivered = null
      const suppressDelivery = Boolean(st.suppressDelivery)
      st.suppressDelivery = st.pendingSuppressDelivery || false
      st.pendingSuppressDelivery = false
      const onTurnEnd = st.onTurnEnd
      st.onTurnEnd = st.pendingOnTurnEnd || null
      st.pendingOnTurnEnd = null
      st.autoReply = null
      st.text = ''
      st.markerRetried = false

      st.senders = st.pendingSenders || new Set()
      st.pendingSenders = new Set()
      st.directRequester = st.pendingDirectRequester || null
      st.pendingDirectRequester = null
      st.directOwner = false
      st.system = null
      st.turnToken = null
      st.wantVoice = false
      if (sys) {
        if (completed) sys.resolve(text)
        else sys.reject(new Error('这一轮没正常结束：' + (d.reason?.kind || '?')))
        return
      }
      if (!completed) {
        const detail = String(d.reason?.error?.message || d.reason?.failure?.message || '')
          .replace(/\s+/g, ' ')
          .slice(0, 180)
        log.warn(
          `${chatId} 这一轮没正常结束（${d.reason?.kind || '?'}${detail ? '：' + redact(detail) : ''}），不发`,
        )
        try {
          onTurnEnd?.({ ok: false, error: detail || String(d.reason?.kind || '这一轮没正常结束') })
        } catch (error) {
          log.debug('本轮失败回执出错：', error.message)
        }
        release(chatId, turnToken)
        return
      }
      if (chatId.startsWith('system:')) return // 已超时的后台轮次不能误发到 QQ
      if (!text) {
        try {
          onTurnEnd?.({ ok: true, silent: true, text: '' })
        } catch (error) {
          log.debug('本轮结束回执出错：', error.message)
        }
        return release(chatId, turnToken)
      }

      if (suppressDelivery) {
        try {
          onTurnEnd?.({ ok: true, silent: false, text, result: null, suppressed: true })
        } catch (error) {
          log.debug('本轮结束回执出错：', error.message)
        }
        return release(chatId, turnToken)
      }

      const sendLast = () =>
        deliver(chatId, text, {
          wantVoice,
          autoReply, quoteIds,
          userText: st.lastText || '',
          own: true,
          onDelivered,
          fromThinking,
          incomingReply: Boolean(turnToken),
        })
          .then((result) => {
            try {
              onTurnEnd?.({
                ok: Boolean(result?.silent || (result && !result.failed && result.sent)),
                silent: Boolean(result?.silent),
                error: result?.errors?.[0] || '',
                result,
              })
            } catch (error) {
              log.debug('本轮投递回执出错：', error.message)
            }
          })
          .catch((error) => {
            log.warn('发送出错：', error.message)
            try {
              onTurnEnd?.({ ok: false, error: error.message })
            } catch (e) {
              log.debug('本轮失败回执出错：', e.message)
            }
          })
          .finally(() => release(chatId, turnToken))
      const pending = sendChain.get(chatId)
      if (pending) {
        const chained = pending.then(sendLast, sendLast)
        sendChain.set(chatId, chained)
        const done = () => {
          if (sendChain.get(chatId) === chained) sendChain.delete(chatId)
        }
        chained.then(done, done)
      } else {
        sendLast()
      }
    }
  }

  return { onSessionEvent }
}
