import { isOwnerRoom, ownerId } from '../../../../../src/core/config/owners.ts'
import { type RunTurnInChatOptions, type ReceiveOwnerMessageOptions } from './options.ts'
import { checkAllowed } from '../../../../../src/chat/policy/rules/access.ts'
import { mimeOf } from '../../../../../src/core/message/media/inspect.ts'

export function createDirectTurns({
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
}) {
  const { isBusy, running, turnSignature, busyTurns, busySessions, clearRunning, busy } = turnGuard
  const { agentFor } = sessions
  const { map } = store
  const { targetOf } = outbound
  const activeTurns = new Set<() => void>()

  async function runTurnInChat(
    chatId,
    prompt,
    {
      noTools = false,
      timeoutMs = 120_000,
      userText = '',
      kind = 'proactive',
      suppressDelivery = false,
    }: RunTurnInChatOptions = {},
  ) {
    assertActive()
    const id = String(chatId || '')
    const tgt = targetOf(id)

    if (!tgt || tgt.kind !== 'private') return { ok: false, reason: 'unsupported-chat' }

    if (isBusy(id) || running.has(id)) return { ok: false, reason: 'busy' }
    const cfg = getConfig()
    const chat = {
      chatId: id,
      kind: 'private',
      userId: tgt.id,
      groupId: '',
      nickname: cfg.ownerName || '主人',
    }

    const { agent } = await agentFor(chat)
    assertActive()

    if (isBusy(id) || running.has(id)) return { ok: false, reason: 'busy' }
    let gateOff = null

    if (noTools) {
      try {
        gateOff = agent.ctx.tools.restrict({ allow: [] })
      } catch (error) {
        log.warn(`本轮收工具失败（${id}）：`, error.message)
        return { ok: false, reason: 'tools-unavailable' }
      }
    }
    const releaseGate = () => {
      if (!gateOff) return
      try {
        gateOff()
      } catch (error) {
        log.debug(`恢复工具失败（${id}）：`, error.message)
      }
      gateOff = null
    }

    let timer = null
    let finished = false
    const ended = Promise.withResolvers<{
      ok: boolean
      reason?: string
      silent?: boolean
      sent?: string
      raw?: string
      error?: string
    }>()
    let turnToken = null
    const settle = (value, error?: Error) => {
      if (finished) return
      finished = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      activeTurns.delete(cancel)
      releaseGate()
      if (error) ended.reject(error)
      else ended.resolve(value)
    }
    const cancel = () => settle({ ok: false, reason: 'disposed' })
    activeTurns.add(cancel)
    timer = setTimeout(
      () => {
        settle({ ok: false, reason: 'timeout' })
        if (turnToken) release(id, turnToken)
      },
      Math.max(5000, Number(timeoutMs) || 120_000),
    )
    timer.unref?.()

    turnToken = { signature: turnSignature(id) }
    busyTurns.set(id, turnToken)
    busySessions.delete(id)
    clearRunning(id)
    busy.set(id, Date.now())
    void pushToSession(chat, [{ type: 'text', text: String(prompt) }], '', {
      queryText: userText || '',
      turnToken,
      suppressDelivery,

      onTurnEnd: (r) => {
        if (suppressDelivery) {
          if (r?.ok === false) return settle({ ok: false, reason: 'generation-failed', error: r.error })
          return settle({ ok: true, silent: !String(r?.text || ''), raw: String(r?.text || '') })
        }

        const error = String(r?.error || '')
        const sent = String(r?.result?.sent || '')
        if (error) return settle({ ok: false, reason: 'send-failed', error, sent })
        settle({ ok: true, silent: !sent, sent })
      },
    }).catch((error) => {
      release(id, turnToken)
      settle(undefined, error)
    })
    return ended.promise
  }

  async function receiveOwnerMessage(
    chatId,
    {
      text = '',
      image,
      wav,
      via = 'external',
      originId,
      assertAuthorized = () => {},
    }: ReceiveOwnerMessageOptions = {},
  ) {
    const owner = String(ownerId(getConfig()) || '')
    const validate = () => {
      assertActive()
      assertAuthorized()
      const cfg = getConfig()
      if (!cfg.enabled || !owner || String(ownerId(cfg) || '') !== owner)
        throw Object.assign(new Error('请先启用 Aurabot 并配置主人身份'), { status: 503, code: 'not_ready' })
      const match = /^(private|group):(\d+)$/.exec(String(chatId))
      if (!map().chats[chatId]?.sessionId || !match)
        throw Object.assign(new Error('会话不存在'), { status: 404, code: 'chat_not_found' })
      const chat = {
        chatId,
        kind: match[1],
        userId: match[1] === 'private' ? match[2] : owner,
        groupId: match[1] === 'group' ? match[2] : '',
        nickname: cfg.ownerName || '主人',
      }
      if (!checkAllowed(cfg, chat).allowed || isMuted?.(chatId))
        throw Object.assign(new Error('这个聊天未开放或已暂停'), { status: 403, code: 'chat_disabled' })
      return chat
    }
    let chat = validate()
    const source = String(via || 'external')
      .replace(/[\r\n【】]/g, '')
      .slice(0, 40)
    if (wav) text = await transcribe({ records: [{ data: {} }], messageId: '' }, wav)
    const content: any[] = [
      {
        type: 'text',
        text: `【${chat.kind === 'group' ? '群聊' : '私聊'} · ${source}】${chat.nickname}(${owner})：${text || '[图片]'}`,
      },
    ]
    if (image) {
      const bytes = await fitForModel(image)
      content.push({
        type: 'image',
        data: bytes.toString('base64'),
        mediaType: mimeOf(bytes),
        name: 'external-image',
      })
    }
    chat = validate()
    if (isOwnerRoom(getConfig(), chatId) && onMemoryCommand) {
      try {
        onMemoryCommand(chat, text)
      } catch (error) {
        log.warn('处理记忆请求失败：', error.message)
      }
    }
    logChat(chatId, chat.nickname, text || '[图片]', owner, { via: source, originId })
    activity.lastChatAt = Date.now()
    if (isOwnerRoom(getConfig(), chatId)) {
      activity.lastOwnerChatAt = activity.lastChatAt
      activity.lastPrivateAt.set(owner, activity.lastChatAt)
    }
    onActivity?.({
      kind: 'in',
      chatId,
      userId: owner,
      nickname: chat.nickname,
      text,
      direct: true,
      owner: true,
    })
    await pushToSession(chat, content, owner, {
      queryText: text || '[图片]',
      steer: running.has(chatId),
      assertAuthorized: validate,
    })
    return { ok: true }
  }

  return {
    runTurnInChat,
    receiveOwnerMessage,
    dispose: () => {
      for (const cancel of activeTurns) cancel()
    },
  }
}
