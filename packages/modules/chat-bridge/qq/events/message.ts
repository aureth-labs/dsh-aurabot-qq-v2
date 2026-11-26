import { mediaLimits } from '../../../../../src/core/message/media/limits.ts'
import { personaScope } from '../../../../../src/persona/personas.ts'
import { fromOneBot } from '../../../../adapters/qq/onebot-v11/src/element.ts'
import { parseMessageEvent } from '../../../../adapters/qq/onebot-v11/src/message/parse.ts'
import { ignoredGroupMember } from '../../../../../src/chat/inbound/filter/member-filter.ts'
import { isOwner, checkAllowed, shouldObserveGroup, groupResponseMode } from '../../../../../src/chat/policy/rules/access.ts'
import { ownerAuthorizationRevision } from '../../../../../src/core/config/index.ts'
import { chatMessageOrigin } from '../turn/receipts.ts'
import { policyFor, decideGroupReply, topicRelevance } from '../../../../../src/chat/policy/rules/group.ts'
import { sleep, type ContentBlock } from '../context/context.ts'
import { clockLabel, wantsVoice } from '../../../../../src/chat/reply/index.ts'

export function createIncomingMessages({
  getConfig,
  log,
  isDisposed,
  store,
  activity,
  groups,
  turnGuard,
  policy,
  media,
  conversation,
  enqueue,
}) {
  const { pnow, isBeforeMemoryReset } = store
  const { groupBuf, groupSaid, groupEngaged, groupEngagedRun, groupInterjects, groupMusts } = groups
  const { pending } = turnGuard
  const {
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
  } = policy
  const {
    faces,
    stickers,
    currentMedia,
    transcribe,
    addGroupImages,
    imagesOf,
    animatedNote,
    quotes,
  } = media
  const { info: quotedInfo, inline: quoteInline, images: quoteImages } = quotes
  const { stats, privateSources, logChat, refreshFriends, repliedToBot, sendSegments } = conversation

  function onMessage(event, quoteDeleted = false) {
    return personaScope.run(pnow(), () => onPersonaMessage(event, quoteDeleted))
  }

  async function onPersonaMessage(event, quoteDeleted: boolean) {
    if (isDisposed()) return
    const account = currentMedia()
    if (!account || (account.selfId && event.self_id && account.selfId !== String(event.self_id))) return
    activity.selfId = String(event.self_id || activity.selfId || getConfig().botQQ)
    const cfg = getConfig()
    const msg = parseMessageEvent(event, activity.selfId, { faceName: faces.nameOf })
    if (msg.userId === activity.selfId) return
    const limits = mediaLimits(cfg.media)
    const incoming = msg.segments.filter(seg => msg.images.includes(seg) || msg.stickers.includes(seg))
    const accepted = new Set(limits.receiveImages ? incoming.slice(0, limits.maxImages) : [])
    msg.images = msg.images.filter(seg => accepted.has(seg))
    msg.stickers = msg.stickers.filter(seg => accepted.has(seg))
    if (ignoredGroupMember(cfg, msg)) return
    const now = Date.now()
    const wasCleared = () => currentMedia() !== account || isBeforeMemoryReset(msg.chatId, msg.userId, now)
    const fromOwner = onCommand && isOwner(cfg, msg.userId)
    const ownerRevision = fromOwner ? ownerAuthorizationRevision(cfg) : ''

    if (isDisposed() || wasCleared()) return
    stats.bump('received')

    let groupEntry = null
    if (msg.kind === 'group') {
      const buf = groupBuf.get(msg.groupId) || []
      const entryText = msg.text || (!cfg.voice.asr && msg.records.length ? '[发来一条语音]' : '')
      groupEntry = {
        t: now,
        uid: msg.userId,
        nick: msg.nickname,
        text: entryText,
        at: msg.mentioned,
        atTargets: msg.atTargets,
        mid: msg.messageId,
        direct: false,
        replyId: msg.replyId,
        ...(quoteDeleted ? { quote: null } : {}),
        images: msg.images,
        stickers: msg.stickers,
        voicePromise: null,
        voiceText: '',
      }
      buf.push(groupEntry)
      while (buf.length > 40) buf.shift()
      groupBuf.set(msg.groupId, buf)
    }

    const allowed = checkAllowed(cfg, msg)
    if (msg.kind === 'private' && (allowed.allowed || event.sub_type === 'friend')) {
      privateSources.delete(msg.userId)
      if (allowed.allowed && msg.sourceGroupId) privateSources.set(msg.userId, msg.sourceGroupId)
      if (privateSources.size > 500) privateSources.delete(privateSources.keys().next().value)
    }

    let stickerPick = 0
    const collectMode = cfg.stickers.collectMode || 'auto'
    if (allowed.allowed && msg.stickers.length && cfg.stickers.collect) {
      const okSrc = msg.kind === 'group' ? cfg.stickers.fromGroups : cfg.stickers.fromPrivate
      if (okSrc) {
        if (collectMode === 'auto') {
          for (const s of msg.stickers)
            stickers
              .collect(fromOneBot([s])[0], msg.chatId, () => currentMedia() === account && !wasCleared())
              .then((r) => {
                if (!r.ok) log.debug('没收这张表情：', r.reason)
              })
              .catch(() => {})
        } else {
          stickerPick = account.stickers.remember(msg.chatId, msg.stickers)

          if (collectMode === 'owner' && !isOwner(cfg, msg.userId)) stickerPick = 0
        }
      }
    }
    if (!allowed.allowed) {
      if (shouldObserveGroup(cfg, msg) && msg.text.trim()) {
        logChat(msg.chatId, msg.nickname, msg.text, msg.userId, {
          at: now,
          images: msg.images,
          mid: msg.messageId,
        })
      }
      log.debug(`忽略 ${msg.chatId}（${allowed.reason}）`)
      return
    }
    await refreshFriends()
    if (isDisposed() || wasCleared()) return

    const quotedBot = msg.kind === 'group' && msg.replyId ? !quoteDeleted && await repliedToBot(msg.replyId, msg) : false
    if (isDisposed() || wasCleared()) return
    const interaction = msg.kind === 'private' || msg.mentioned || quotedBot ? [msg.userId] : []
    const originId = chatMessageOrigin(msg.chatId, msg.messageId, 'in', cfg.botQQ)?.originId
    const logIncoming = (text = msg.text) =>
      logChat(msg.chatId, msg.nickname, text, msg.userId, {
        interaction,
        at: now,
        originId,
        images: msg.images,
        mid: msg.messageId,
      })

    if (msg.files.length) {
      const list = (account.files.get(msg.chatId) || []).concat(
        msg.files.map((f) => ({ ...f, userId: msg.userId, at: now })),
      )
      account.files.set(msg.chatId, list.slice(-8))
    }

    if (msg.stickers.length || msg.images.length) {
      account.images.remember(
        msg.chatId,
        msg.segments
          .filter((seg) => msg.images.includes(seg) || msg.stickers.includes(seg))
          .map((seg, index) => ({
            seg,
            userId: msg.userId,
            sticker: msg.stickers.includes(seg),
            messageId: String(msg.messageId || ''),
            imageIndex: index + 1,
          })),
      )
    }

    if (onCommand && (fromOwner || msg.kind === 'private') && /^\s*[/／]/.test(msg.text)) {
      let sensitiveCommand = ''
      const ownerStillCurrent = () => {
        const current = getConfig()
        return (
          fromOwner && isOwner(current, msg.userId) && ownerAuthorizationRevision(current) === ownerRevision
        )
      }
      try {
        const reply = await onCommand(
          msg,
          (name) => {
            sensitiveCommand = '主人命令 /' + name
            return ownerStillCurrent()
          },
          ownerStillCurrent,
        )
        if (isDisposed() || wasCleared() || (sensitiveCommand && !ownerStillCurrent())) return
        if (reply) {
          log.info(sensitiveCommand || `QQ 命令 ${msg.text.trim().slice(0, 30)} → ${reply.split('\n')[0]}`)
          await sendSegments(
            msg.chatId,
            [{ type: 'text', data: { text: reply } }],
            sensitiveCommand || reply.slice(0, 60),
            {
              force: true,
              sensitive: Boolean(sensitiveCommand),
              isCurrent: sensitiveCommand ? ownerStillCurrent : null,
            },
          )
          return
        }
        if (sensitiveCommand || reply === '') return
      } catch (error) {
        if (isDisposed() || wasCleared() || (sensitiveCommand && !ownerStillCurrent())) return
        const detail = sensitiveCommand || error.message
        log.warn('执行命令出错：', detail)
        const text = '命令没执行成功，请先查看当前状态再决定是否重试；详细原因请主人查看本机日志。'
        await sendSegments(msg.chatId, [{ type: 'text', data: { text } }], '命令出错', {
          force: true,
          sensitive: Boolean(sensitiveCommand),
          isCurrent: sensitiveCommand ? ownerStillCurrent : null,
        })
        return
      }
    }
    if (wasCleared()) return
    if (!getConfig().enabled) {
      log.info(`总开关关着，收到 ${msg.chatId} 的消息但不处理：${msg.text.slice(0, 30)}`)
      return
    }

    if (msg.kind === 'private' && onMemoryCommand) {
      try {
        onMemoryCommand(msg, msg.text)
      } catch (error) {
        log.warn('处理记忆请求失败：', error.message)
      }
    }

    if (isMuted?.(msg.chatId)) {
      log.debug(`${msg.chatId}：主人让她闭嘴中，不回`)
      logIncoming()
      return
    }
    const dislikeChance = Math.max(0, Math.min(1, Number(cfg.memory?.dislikeSilence ?? 0.85) || 0))
    if (
      dislikeChance > 0 &&
      !isOwner(cfg, msg.userId) &&
      dislikes?.(msg.userId) &&
      random() < dislikeChance
    ) {
      logIncoming()
      onActivity?.({
        kind: 'silent',
        chatId: msg.chatId,
        userId: msg.userId,
        text: msg.text,
        nickname: msg.nickname,
      })
      log.debug(`${msg.chatId}：不想搭理，安静看着`)
      return
    }

    if (
      msg.kind === 'group' &&
      groupResponseMode(getConfig(), msg.groupId) === 'chat' &&
      groupEntry &&
      cfg.voice.asr &&
      msg.records.length
    ) {
      groupEntry.voicePromise = transcribe(msg)
        .then((t) => {
          if (t) {
            groupEntry.text = groupEntry.text ? `${groupEntry.text} ${t}` : t
            groupEntry.voiceText = t
          }
          return t
        })
        .catch((error) => {
          log.debug('群语音转写失败：', error.message)
          return ''
        })
    }

    if (hooks?.message) {
      try {
        if (await hooks.message({ ...msg, raw: event })) {
          if (isDisposed() || wasCleared()) return
          logIncoming()
          return
        }
      } catch (error) {
        log.warn('扩展模块处理消息出错：', error.message)
      }
    }
    if (isDisposed() || wasCleared()) return

    if (msg.kind === 'group' && groupResponseMode(getConfig(), msg.groupId) !== 'chat') {
      logIncoming() // 响应模式不改变白名单群原有的文字记忆记录。
      return
    }

    void maybeReact(msg)
    if (isDisposed() || wasCleared()) return

    let mode = 'must'
    if (msg.kind === 'group') {
      const pol0 = policyFor({ ...cfg.group, wakeWords: cfg.wakeWords }, cfg.group.overrides, msg.groupId)

      const pol = { ...pol0, interjectChance: Math.min(1, pol0.interjectChance * mood().chatty) }

      if (groupEntry?.voicePromise) {
        await Promise.race([groupEntry.voicePromise, sleep(2000)])
        if (groupEntry.voiceText) msg.wakeText = groupEntry.voiceText
      }

      const recentTexts = (groupBuf.get(msg.groupId) || [])
        .filter((x) => now - x.t < pol.activeWindowSec * 1000)
        .slice(-6)
        .map((x) => x.text)
      let memScore = 0
      try {
        memScore = typeof memoryScore === 'function' ? memoryScore(recentTexts.join(' ')) : 0
      } catch (error) {}

      const gbuf = groupBuf.get(msg.groupId) || []
      const priorMsg = gbuf.length >= 2 ? gbuf[gbuf.length - 2] : null
      const lastBotAt = (groupSaid.get(msg.groupId) || []).at(-1) || 0
      const decision = decideGroupReply({
        policy: pol,
        relevance: topicRelevance(recentTexts, pol.interests, memScore),
        engagedUntil: groupEngaged.get(msg.groupId) || 0,
        engagedRun: groupEngagedRun.get(msg.groupId) || 0,
        mentioned: msg.mentioned,
        atOthers: cfg.group?.ignoreAtOthers ? msg.atOthers : false,
        atOthersAny: msg.atOthers,
        repliedToBot: quotedBot,
        lastIsBot: Boolean(lastBotAt && (!priorMsg || lastBotAt > priorMsg.t)),
        fromOwner: isOwner(cfg, msg.userId),
        text: msg.wakeText,
        now,
        hour: new Date().getHours(),
        recentTimes: (groupBuf.get(msg.groupId) || []).map((x) => x.t),
        interjectTimes: groupInterjects.get(msg.groupId) || [],
        botReplyTimes: groupSaid.get(msg.groupId) || [],
        mustTimes: groupMusts.get(msg.groupId) || [],
      })
      if (hooks?.groupDecide) {
        try {
          const next = await hooks.groupDecide(decision, { msg, policy: pol, recentTexts, memScore })
          if (next && typeof next === 'object') Object.assign(decision, next)
        } catch (error) {
          log.warn('扩展模块改群聊决定出错：', error.message)
        }
      }
      if (isDisposed() || wasCleared()) return
      if (!decision.reply) {
        log.debug(`群 ${msg.groupId}：不回（${decision.reason}）`)
        logIncoming()

        if (pending.has(msg.chatId)) await addGroupImages(msg, groupEntry)
        return
      }
      groupEntry.direct = Boolean(
        msg.messageId && msg.messageId !== '0' && msg.userId && (msg.mentioned || quotedBot),
      )
      mode = decision.mode
      log.info(`群 ${msg.groupId}：${decision.reason} → 交给她`)
    }

    let text = msg.text
    const voiceText =
      cfg.voice.asr && msg.records.length
        ? groupEntry?.voicePromise
          ? await groupEntry.voicePromise
          : await transcribe(msg)
        : msg.records.length
          ? '[发来一条语音]'
          : ''
    if (isDisposed() || wasCleared()) return
    if (voiceText) text = (text ? text + ' ' : '') + voiceText
    if (voiceText && msg.kind === 'private' && onMemoryCommand) {
      try {
        onMemoryCommand(msg, text)
      } catch (error) {
        log.warn('处理记忆请求失败：', error.message)
      }
    }
    if (voiceText && msg.kind === 'group') {
      const last = (groupBuf.get(msg.groupId) || []).findLast?.((x) => x.uid === msg.userId)
      if (last) last.text = text
    }

    const quoted = msg.kind === 'private' && msg.replyId && !quoteDeleted ? await quotedInfo(msg.replyId, msg) : null
    if (isDisposed() || wasCleared()) return

    const content: ContentBlock[] =
      msg.kind === 'group'
        ? []
        : [
            {
              type: 'text',
              text:
                `【私聊】[${clockLabel(now)}] ${msg.nickname}(${msg.userId})：` +
                (text || '（没有文字）') +
                (msg.messageId && msg.messageId !== '0' ? '\n' + JSON.stringify({ messageId: msg.messageId }) : '') +
                (quoted ? '\n' + quoteInline(quoted) : ''),
            },
          ]
    const imgs = await imagesOf(msg)
    if (isDisposed() || wasCleared()) return
    if (imgs.length && groupEntry) groupEntry.mediaPending = true // 这些图已经进 pending.images，groupPrompt 不用再带
    if (imgs.length) {
      for (let i = 0; i < imgs.length; i++) {
        if (msg.kind === 'group')
          content.push({
            type: 'text',
            text: `【图片 ${i + 1}/${imgs.length}，发送者 ${msg.nickname}(${msg.userId})】`,
          })
        content.push({
          type: 'image',
          data: imgs[i].data,
          mediaType: imgs[i].mediaType,
          name: imgs[i].name || `qq-${msg.userId}-${msg.messageId}-${i + 1}`,
        })
      }
      if (animatedNote(imgs))
        content.push({ type: 'text', text: animatedNote(imgs) })
    }

    if (quoted?.ok && (quoted.images.length || quoted.stickers.length) && imgs.length < limits.maxImages) {
      const qImgs = await quoteImages(quoted, Math.min(2, limits.maxImages - imgs.length))
      for (const c of qImgs) content.push(c)
    }
    if (isDisposed() || wasCleared()) return
    logIncoming(text)
    activity.lastChatAt = now
    if (msg.kind === 'private' && msg.userId === cfg.ownerQQ) activity.lastOwnerChatAt = now
    if (msg.kind === 'private') activity.lastPrivateAt.set(msg.userId, now)
    onActivity?.({
      kind: 'in',
      chatId: msg.chatId,
      userId: msg.userId,
      nickname: msg.nickname,
      text,
      direct: msg.kind === 'private' || msg.mentioned || mode === 'must',
      owner: isOwner(cfg, msg.userId),
    })

    enqueue(
      {
        chatId: msg.chatId,
        kind: msg.kind,
        userId: msg.userId,
        groupId: msg.groupId,
        nickname: msg.nickname,
      },
      content,
      msg.userId,
      wantsVoice(msg.text),
      mode,
      { stickerPick, messageId: msg.messageId },
    )
  }

  return { onMessage }
}
