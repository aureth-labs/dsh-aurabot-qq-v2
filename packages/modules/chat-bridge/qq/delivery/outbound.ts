import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanOutboundText, cleanOutboundSegments, capOutboundSegments, stripAcpLeak } from '../../../../../src/chat/reply/index.ts'
import { textToElements, stripFaceTags, splitSpeakable } from '../../../../../src/chat/reply/format/speech.ts'
import { expandMentions, hasMention } from '../format/mentions.ts'
import { activeCapture, failStore, workspaceDirOf } from '../context/context.ts'
import type { OutputScope } from '../context/context.ts'
import { dataDir } from '../../../../../src/core/store/index.ts'
import { fetchImage } from '../../../../../src/core/net/index.ts'
import { groupOf, isGroupRoom, roomOf, userOf } from '../../../../../src/core/bot/room.ts'
import { reallySent } from '../../../../../src/core/message/receipt.ts'
import { h } from '../../../../../src/core/message/element/element.ts'
import { acknowledged } from '../../../../../src/core/bot/send-events.ts'
import { isDefiniteFailure } from '../../../../../src/core/bot/delivery.ts'

type SendOptions = Record<string, any>
type SendSegmentsOptions = SendOptions
type SendTextOptions = SendOptions
type SendVoiceOptions = SendOptions
type SendImageOptions = SendOptions
type DeliverOptions = SendOptions

export interface OutboundDeps {
  [key: string]: any
}

export function createOutbound(deps: OutboundDeps) {
  const {
    getConfig, log, bot: botOf, outbox, stickers, tts, hooks, isDisposed, bump, pnow, sentIds,
    outputScope, outputSources, currentPromptSources, groupEngaged, groupEngagedRun, groupInterjects,
    groupChatAllowed, cleaningFor, membersOf, faces, wantsOutbound, passOutbound, settleOutbound,
    noteProactive, pause, lastPoker, lastSpeaker,
  } = deps

  function targetOf(chatId) {
    const room = roomOf(chatId)
    return room && (room.kind === 'group' || room.kind === 'private') ? { kind: room.kind, id: room.id } : null
  }

  const text = (content) => ({ type: 'text', attrs: { content: String(content ?? '') } })
  const partText = (part) => String(part?.attrs?.content ?? '')

  function transmit(tgt, message, timeoutMs) {
    const bot = botOf()
    if (!bot) throw Object.assign(new Error('机器人不在线'), { code: 'AURABOT_DELIVERY', outcome: 'rejected' })
    const options = timeoutMs ? { timeoutMs } : undefined
    return tgt.kind === 'group' ? bot.sendMessage(tgt.id, message, options) : bot.sendPrivateMessage(tgt.id, message, options)
  }

  function recordDeliveryTypes(chatId, message, queued = false) {
    const scope = outputScope.getStore()
    if (scope?.chatId !== chatId) return
    const types = queued ? scope.queuedTypes : scope.sentTypes
    for (const segment of message) types?.add(segment.type)
  }

  function reportDelivery(chatId, result, scope, isCurrent) {
    if (!scope || !hooks?.delivery || isDisposed() || result?.queued) return
    try {
      if (!isCurrent || isCurrent()) hooks.delivery(chatId, result?.message_id, scope)
    } catch (error) {
      log.debug?.('发送回执通知失败')
    }
  }

  function stripAcpSegments (message) {
    const out = []
    for (const part of message) {
      if (part.type !== 'text') { out.push(part); continue }
      const value = stripAcpLeak(partText(part))
      if (value) out.push(text(value))
    }
    return out
  }

  async function sendSegments(chatId, message, note, opts : SendSegmentsOptions = {}) {
    const { force = false, isCurrent = null, throwOnError = false, timeoutMs, quiet = false, queueKind = 'reply', queueTtlMs, sensitive = false } = opts
    if (isDisposed()) return null
    const replyCurrent = () => outputScope.getStore()?.chatId !== chatId || !outputScope.getStore()?.incomingReply || groupChatAllowed(chatId)
    if (!replyCurrent()) return null
    let verdict = opts.outboundVerdict || null
    if (wantsOutbound(opts)) {
      verdict = passOutbound({ chatId, note, sourceModule: opts.sourceModule, enginePolicy: opts.enginePolicy, cause: opts.cause, itemId: opts.itemId, kind: 'segments' })
      if (verdict.action === 'deny') {
        log.info(`出站被策略拦下（${verdict.reason || 'deny'}）→ ${chatId}：${opts.sourceModule || opts.enginePolicy || ''} [${note || ''}]`)
        return null
      }
      opts = { ...opts, sourceModule: undefined, enginePolicy: undefined, cause: undefined, itemId: undefined }
    }
    const cfg = getConfig()
    const tgt = targetOf(chatId)
    if (!tgt) return settleOutboundFailed(verdict)
    const cleaning = cleaningFor(chatId)
    message = cleanOutboundSegments(message, cleaning)
    if (!message.length) return settleOutboundFailed(verdict)
    if (!sensitive && hooks?.send) {
      try {
        const next = await hooks.send(message, { chatId, note, force })
        if (next === null) {
          log.info(`扩展模块拦下了 → ${chatId}：${note}`)
          return settleOutboundFailed(verdict)
        }
        if (Array.isArray(next)) message = next
      } catch (error) {
        log.warn('扩展模块改写发送内容出错：', sensitive ? '敏感命令回执' : error.message)
      }
    }
    // 钩子可能重新写入工具标记；最终网关出口仍使用同一份清洗。
    message = cleanOutboundSegments(message, cleaning)
    // 第三道保险：ACP 协议标记在真实出口再剥一次（幂等）。
    // cleanOutboundText 已经剥过一遍，这里存在的意义是——扩展模块的 send 钩子可能往正文里
    // **重新写回**标记（钩子排在清洗之后），以及补发/重试路径会复用已清洗过的 message。
    // 剥完为空就当场判失败，绝不发一条只有标记的脏消息。
    if (cfg.chat?.acpSanitize?.enabled !== false) {
      message = stripAcpSegments(message)
      if (!message.length) return settleOutboundFailed(verdict)
    }
    const capped = capOutboundSegments(message)
    if (capped.trimmed) {
      const kept = capped.message.filter((part) => part.type === 'text').reduce((n, part) => n + partText(part).length, 0)
      log.warn(`出站正文超长，已截断 → ${chatId}：${capped.total} 字 → ${kept} 字`)
      message = capped.message
    }
    if (!message.length || isDisposed() || !replyCurrent() || (isCurrent && !isCurrent())) return settleOutboundFailed(verdict)
    const cap = activeCapture()
    if (cap) {
      cap.push({ chatId, note, message })
      recordDeliveryTypes(chatId, message)
      if (outputScope.getStore()?.chatId === chatId) outputScope.getStore().sent++
      settleOutbound(verdict, 'sent')
      return { message_id: 'sim-' + cap.length }
    }
    if (!force && !cfg.enabled) {
      log.info(`总开关关着，没发 → ${chatId}：${note}`)
      return settleOutboundFailed(verdict)
    }
    const deliveryScope = !sensitive && !cfg.debug
      ? hooks?.deliveryScope?.(chatId, pnow(), cfg.botQQ)
      : null
    try {
      const r: any = await transmit(tgt, message, timeoutMs)
      if (r?.cancelled || r?.ok === false) return settleOutboundFailed(verdict)
      const sentId = r?.message_id ?? r?.id ?? (Array.isArray(r) ? r.find((x) => x?.message_id ?? x?.id)?.message_id : undefined)
      if (sentId !== undefined) {
        sentIds.add(String(sentId))
        if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value)
      }
      bump('sent')
      recordDeliveryTypes(chatId, message)
      if (outputScope.getStore()?.chatId === chatId) outputScope.getStore().sent++
      settleOutbound(verdict, 'sent')
      if (opts.proactive) noteProactive(chatId, message, opts)
      reportDelivery(chatId, r, deliveryScope, isCurrent)
      return r
    } catch (error) {
      if (!sensitive && outbox && isDefiniteFailure(error)) {
        const q = outbox.add({
          message, chatId, note, kind: queueKind, ttlMs: queueTtlMs, deliveryScope,
          proactive: opts.proactive ? String(opts.proactiveCause || 'proactive') : '',
          incomingReply: outputScope.getStore()?.chatId === chatId && Boolean(outputScope.getStore()?.incomingReply),
        })
        if (q.ok) {
          log.warn(`发到 ${chatId} 时网关还没就绪，已排队补发：${note || error.message}`)
          recordDeliveryTypes(chatId, message, true)
          return { queued: true, queuedId: q.id }
        }
        log.warn(`发到 ${chatId} 失败，且无法入队（${q.message}）：`, error.message)
      }
      bump('errors')
      const detail = sensitive ? '敏感命令回执发送失败' : error.message
      log.warn(`发到 ${chatId} 失败：`, detail)
      settleOutbound(verdict, isDefiniteFailure(error) ? 'failed' : 'uncertain')
      if (throwOnError) throw error
      if (!quiet) failStore.getStore()?.push(detail)
      return null
    }
  }

  function settleOutboundFailed(verdict) {
    settleOutbound(verdict, 'failed')
    return null
  }

  const quote = (replyId) => (replyId && botOf()?.supports('quote') !== false ? [{ type: 'quote', attrs: { id: String(replyId) } }] : [])

  const mention = (userId, parts = []) => (userId && !parts.some((part) => part.type === 'at' && String(part.attrs?.id) === String(userId)) ? [{ type: 'at', attrs: { id: String(userId) } }, text(' ')] : [])

  async function sendText(chatId, body, replyId, missed, userId, opts : SendTextOptions = {}) {
    let verdict = opts && opts.outboundVerdict ? opts.outboundVerdict : null
    if (wantsOutbound(opts)) {
      verdict = passOutbound({ chatId, text: body, sourceModule: opts.sourceModule, enginePolicy: opts.enginePolicy, cause: opts.cause, itemId: opts.itemId, kind: 'text' })
      if (verdict.action === 'deny') {
        log.info(`出站被策略拦下（${verdict.reason || 'deny'}）→ ${chatId}：${opts.sourceModule || opts.enginePolicy || ''}`)
        return null
      }
      opts = { ...opts, sourceModule: undefined, enginePolicy: undefined, cause: undefined, itemId: undefined, outboundVerdict: undefined }
    }
    body = cleanOutboundText(body, cleaningFor(chatId))
    if (!body.trim()) return settleOutboundFailed(verdict)
    const useFaces = getConfig().stickers.faces && botOf()?.supports('face') !== false
    let parts = useFaces ? textToElements(body, faces.idOf) : [text(stripFaceTags(body))]
    if (isGroupRoom(chatId) && hasMention(body)) parts = expandMentions(parts, await membersOf(groupOf(chatId)), missed)
    if (!parts.length || (parts.length === 1 && parts[0].type === 'text' && !partText(parts[0]).trim())) return settleOutboundFailed(verdict)
    return sendSegments(chatId, [...quote(replyId), ...mention(userId, parts), ...parts], (replyId ? '[引用] ' : '') + body.slice(0, 60), verdict ? { ...opts, outboundVerdict: verdict } : opts)
  }

  async function sendVoice(chatId, body, replyId, userId, opts : SendVoiceOptions = {}) {
    body = cleanOutboundText(body, cleaningFor(chatId))
    if (!body.trim()) return false
    if (botOf()?.supports('voice') === false) return Boolean(await sendText(chatId, body, replyId, undefined, userId))
    let b64, engine, extras
    try {
      const split = splitSpeakable(body)
      extras = split.extras
      if (!split.spoken) throw new Error('这条语音里只有表情/符号，没有能念的字')
      const voice = await tts.speak(split.spoken)
      engine = voice.engine
      b64 = readFileSync(voice.file).toString('base64')
    } catch (error) {
      log.warn('语音没合成出来，改发文字：', error.message)
      await sendText(chatId, body, replyId, undefined, userId)
      return false
    }
    if (replyId || userId) log.debug(`语音条单独发，不带引用和 @：${chatId}`)
    try {
      const r = await sendSegments(chatId, [voicePart(b64)], `[语音·${engine}] ${body.slice(0, 40)}`, { throwOnError: true, timeoutMs: FILE_TIMEOUT_MS })
      if (r || !getConfig().enabled) {
        bump('voice')
        if (extras && getConfig().voice.emojiSeparate !== false) {
          try {
            if (getConfig().enabled && !opts.simulate) await pause(1200)
            const sent = await sendText(chatId, extras, undefined, undefined, undefined, { quiet: true })
            log.debug(sent ? `语音后面补发了一条表情：${chatId}` : '表情没补发出去（不影响语音条）')
          } catch (error) {
            log.debug('表情没补发出去：', error.message)
          }
        }
        return true
      }
      const message = '语音没有发送'
      log.warn(message)
      failStore.getStore()?.push(message)
      return false
    } catch (error) {
      if (isDefiniteFailure(error)) {
        log.warn('语音没发出去，改发文字：', error.message)
        await sendText(chatId, body, replyId, undefined, userId)
      } else {
        log.warn('语音发送结果不确定，不再改发文字：', error.message)
        failStore.getStore()?.push(error.message)
      }
      return false
    }
  }

  async function pokeBack(chatId, userId?: string) {
    const cfg = getConfig()
    const group = groupOf(chatId)
    const target = userId || (group ? lastPoker.get(chatId) || lastSpeaker.get(chatId) : userOf(chatId))
    if (!target) return
    if (!cfg.enabled) return log.info(`总开关关着（没真戳）→ ${chatId}：戳了戳 ${target}`)
    try {
      const bot = botOf()
      if (!bot?.supports('poke')) return
      const content = h.poke(target)
      const receipt = await (group ? bot.sendMessage(group, content) : bot.sendPrivateMessage(userOf(chatId), content))
      if (!acknowledged(receipt)) return
      recordDeliveryTypes(chatId, [{ type: 'poke' }])
      log.info(`${chatId}：她戳了戳 ${target}`)
    } catch (error) {
      log.debug('戳一戳失败：', error.message)
    }
  }

  async function sendVoiceFile(chatId, file, note) {
    if (isDisposed()) return null
    const b64 = readFileSync(file).toString('base64')
    const r = await sendSegments(chatId, [voicePart(b64)], note || '[语音]')
    if (r || !getConfig().enabled) bump('voice')
    if (!r && getConfig().enabled) throw new Error('网关没接受这条语音')
    return r
  }

  const voicePart = (b64) => ({ type: 'voice', attrs: { url: 'base64://' + b64 } })
  const FILE_TIMEOUT_MS = 120_000
  const FILE_BASE64_MAX = 30 * 1024 * 1024
  const isExternalFile = (s) => /^(https?:\/\/|base64:\/\/)/i.test(s)
  const fileLabel = (name, src) => String(name || '').trim() || basename(src.split(/[?#]/)[0]) || '文件'
  const fileRootsOf = (cfg) => [workspaceDirOf(cfg), ...(Array.isArray(cfg?.files?.dirs) ? cfg.files.dirs : [])]
    .filter(Boolean)
    .map((d) => { try { return resolve(String(d)) } catch (error) { return '' } })
    .filter(Boolean)
  const insideRoots = (file, roots) => {
    let p
    try { p = resolve(file) } catch (error) { return false }
    return roots.some((root) => {
      const rel = relative(root, p)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
  }

  function checkSendableFile(cfg, file) {
    const src = String(file ?? '').trim()
    if (!src) throw new Error('要发哪个文件？')
    const external = isExternalFile(src)
    const maxBytes = Math.max(1, Number(cfg.files.maxMB) || 50) * 1024 * 1024
    let size = 0
    if (!external) {
      if (!isAbsolute(src)) throw new Error('要发本机文件得给绝对路径')
      if (!existsSync(src)) throw new Error(`找不到这个文件：${src}`)
      const st = statSync(src)
      if (!st.isFile()) throw new Error(`这不是文件：${src}`)
      size = st.size
      const roots = fileRootsOf(cfg)
      if (roots.length && !insideRoots(src, roots)) throw new Error('这个文件不在允许发送的目录里（面板「聊天」页 → 发文件 可以加目录）')
      if (size > maxBytes) throw new Error(`文件太大（${(size / 1024 / 1024).toFixed(1)} MB），上限 ${Math.round(maxBytes / 1024 / 1024)} MB`)
    }
    return { src, external, size, maxBytes }
  }

  async function sendFile(chatId, file, name) {
    if (isDisposed()) return null
    const cfg = getConfig()
    const tgt = targetOf(chatId)
    if (!tgt) return null
    if (!cfg.files?.enabled) throw new Error('发文件没打开（面板「聊天」页 → 发文件），打开后才能发')
    if (botOf()?.supports('file') === false) throw new Error('这个平台不支持发文件')
    const { src, external, size, maxBytes } = checkSendableFile(cfg, file)
    const label = cleanOutboundText(fileLabel(name, src), cleaningFor(chatId)).trim() || '文件'
    const cap = activeCapture()
    if (cap) {
      cap.push({ chatId, note: `[文件] ${label}`, message: [{ type: 'file', attrs: { url: src, name: label } }] })
      return { message_id: 'sim-' + cap.length }
    }
    if (!cfg.enabled) { log.info(`总开关关着，没发 → ${chatId}：[文件] ${label}`); return null }
    const srcLabel = external ? (src.startsWith('base64://') ? 'base64' : '外部地址') : size < 1024 ? size + ' B' : Math.round(size / 1024) + ' KB'
    const url = external ? src : pathToFileURL(src).href
    const upload = (target) => transmit(tgt, [{ type: 'file', attrs: { url: target, name: label } }], FILE_TIMEOUT_MS)
    try {
      const r = await upload(url)
      if (isDisposed()) return null
      bump('sent')
      log.info(`${chatId}：发文件「${label}」（${srcLabel}）`)
      return r
    } catch (error) {
      if (isDisposed()) return null
      const canRetryBase64 = isDefiniteFailure(error) && !external && size <= Math.min(FILE_BASE64_MAX, maxBytes)
      if (!canRetryBase64) {
        bump('errors')
        log.warn(`${chatId}：发文件「${label}」失败${isDefiniteFailure(error) ? '' : '，发送结果不确定，不再重发'}：`, error.message)
        throw new Error(`发文件失败：${error.message}`)
      }
      try {
        const r = await upload('base64://' + readFileSync(src).toString('base64'))
        if (isDisposed()) return null
        bump('sent')
        log.info(`${chatId}：发文件「${label}」（对端读不到本机路径，改走 base64）`)
        return r
      } catch (error2) {
        if (isDisposed()) return null
        bump('errors')
        log.warn(`${chatId}：发文件「${label}」失败：`, error2.message || error.message)
        throw new Error(`发文件失败：${error2.message || error.message}`)
      }
    }
  }

  async function sendSticker(chatId, query, replyId?, userId?) {
    if (!getConfig().stickers.enabled) {
      log.debug(`表情包关着，「${typeof query === 'object' ? query?.name || '' : query}」不发`)
      return false
    }
    const item = query && typeof query === 'object' ? query : stickers.match(query)
    if (!item) {
      log.debug(`没找到「${query}」这张表情，跳过`)
      return false
    }
    const element = stickers.elementFor(item)
    if (!element) return false
    const sender = botOf(), self = sender?.selfId
    const isCurrent = () => !isDisposed() && sender === botOf() && self === sender?.selfId
    const receipt = await sendSegments(chatId, [...quote(replyId), ...mention(userId), element], `[表情] ${item.name || item.md5.slice(0, 8)}`, { isCurrent })
    if (!isCurrent() || !reallySent(receipt)) return false
    stickers.markUsed?.(item.md5)
    bump('stickers')
    return true
  }

  function localImageBlocked(chatId, src) {
    const cfg = getConfig()
    if (chatId === `private:${cfg.ownerQQ}`) return false
    const s = String(src ?? '').trim()
    if (!isAbsolute(s) && !/^file:/i.test(s)) return false
    try {
      return !insideRoots(/^file:/i.test(s) ? fileURLToPath(s) : s, [...fileRootsOf(cfg), dataDir()])
    } catch (error) { return true }
  }

  async function sendImage(chatId, src, replyId, userId, opts : SendImageOptions = {}) {
    if (isDisposed()) return null
    const s = String(src ?? '').trim()
    const head = [...quote(replyId), ...mention(userId)]
    const local = isAbsolute(s) ? s : /^file:\/\//i.test(s) ? s : ''
    if (local && getConfig().files?.imageByPath !== false) {
      const file = local.startsWith('file://') ? local : pathToFileURL(local).href
      try {
        const r = await sendSegments(chatId, [...head, { type: 'image', attrs: { url: file } }], `[图片·路径] ${local.slice(-40)}`, { throwOnError: true, ...opts })
        if (r) {
          log.debug(`${chatId}：按路径发图「${local.slice(-40)}」`)
          return r
        }
        return null
      } catch (error) {
        if (!isDefiniteFailure(error)) {
          log.warn(`${chatId}：按路径发图失败，发送结果不确定，不再重发：`, error.message)
          if (opts.strict) throw new Error(`图片可能已经发出去了，但网关没确认：${error.message}`)
          return null
        }
        log.debug(`${chatId}：按路径发不出去，改用 base64：`, error.message)
      }
    }
    try {
      const buf = await fetchImage(s, { maxBytes: (getConfig().files?.maxMB ?? 50) * 1048576 })
      return sendSegments(chatId, [...head, { type: 'image', attrs: { url: 'base64://' + buf.toString('base64') } }], `[图片] ${s.slice(-40)}`, opts)
    } catch (error) {
      log.warn('图片发不出去：', error.message)
      return null
    }
  }

  function silenceTurn(chatId, reason = '她选择不说话') {
    log.info(`${chatId}：${reason}`)
    if (isGroupRoom(chatId)) {
      const gid = groupOf(chatId)
      groupEngaged.delete(gid)
      groupEngagedRun.delete(gid)
      groupInterjects.set(gid, [...(groupInterjects.get(gid) || []), Date.now()].slice(-60))
    }
    return { silent: true }
  }

  async function flushOutbox(maySend, onFlushed) {
    if (!outbox || botOf()?.status !== 'online') return { sent: 0, dropped: 0, left: 0 }
    return outbox.flush((item) => {
      const tgt = targetOf(item.chatId)
      if (!tgt) throw Object.assign(new Error('补发目标无效'), { uncertain: true })
      return transmit(tgt, item.message, 0)
    }, maySend, onFlushed)
  }

  return {
    targetOf, recordDeliveryTypes, reportDelivery, stripAcpSegments, sendSegments, settleOutboundFailed,
    quote, mention, sendText, sendVoice, pokeBack, sendVoiceFile, sendFile, sendSticker,
    localImageBlocked, sendImage, silenceTurn, checkSendableFile, flushOutbox,
  }
}
