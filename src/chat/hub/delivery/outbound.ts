// 出站：把消息段 / 文字 / 语音 / 图片 / 表情 / 文件发到平台。
// 门闸判定在逻辑入口，结算在真实出口；这里只管「怎么发出去、发失败了怎么办」。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanOutboundText, cleanOutboundSegments, capOutboundSegments, stripAcpLeak } from '../../reply/index.ts'
import { textToSegments, stripFaceTags, splitSpeakable } from '../../media/face/index.ts'
import { expandMentions, hasMention } from '../../inbound/parse/mentions.ts'
import { activeCapture, failStore, MAX_IMAGE_BYTES, workspaceDirOf } from '../context/context.ts'
import type { OutputScope } from '../context/context.ts'
import { dataDir } from '../../../core/store/index.ts'
import { fetchImage } from '../../../core/net/index.ts'
import { isDefiniteFailure } from '../../../../packages/adapters/qq/onebot-v11/src/client.ts'

/** 出站用到的调用参数：字段名固定，值由调用方传。 */
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
    getConfig, log, onebot, outbox, stickers, tts, hooks, isDisposed, bump, pnow, privateSources, sentIds,
    outputScope, outputSources, currentPromptSources, groupEngaged, groupEngagedRun, groupInterjects,
    groupChatAllowed, cleaningFor, membersOf, faces, wantsOutbound, passOutbound, settleOutbound,
    noteProactive, pause, lastPoker, lastSpeaker,
  } = deps

  // ---------- 发到 QQ ----------
  function targetOf(chatId) {
    const [kind, id] = String(chatId).split(':')
    return kind === 'group' ? { kind: 'group', id } : kind === 'private' ? { kind: 'private', id } : null
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

  // 真实出口的 ACP 标记兜底：只动 text 段，引用/@/媒体段原样保留。
  // 剥完变空的 text 段直接丢掉（不能留一条空气泡）；全空就返回 []，由调用方判失败。
  function stripAcpSegments (message) {
    const out = []
    for (const seg of message) {
      if (seg.type !== 'text') { out.push(seg); continue }
      const text = stripAcpLeak(String(seg.data?.text || ''))
      if (text) out.push({ ...seg, data: { ...seg.data, text } })
    }
    return out
  }

  // quiet：这一条是额外的（比如语音后面补发的表情），失败了不算到这一轮头上（deliver 按 failStore 里的条数判断整条有没有发出去）。
  // queueKind / queueTtlMs：网关短暂不可达时，确定没发出去的消息进入本地补发队列。
  async function sendSegments(chatId, message, note, opts : SendSegmentsOptions = {}) {
    const { force = false, isCurrent = null, throwOnError = false, timeoutMs, quiet = false, queueKind = 'reply', queueTtlMs, sensitive = false } = opts
    if (isDisposed()) return null
    const replyCurrent = () => outputScope.getStore()?.chatId !== chatId || !outputScope.getStore()?.incomingReply || groupChatAllowed(chatId)
    if (!replyCurrent()) return null
    // 出口层第二道保险：模块直接调 scopedHub.sendSegments/sendImage/sendFile/sendFile 时也要过门闸。
    // 只认带 sourceModule（模块发起）或 enginePolicy（引擎路径）的请求；hub 内部发送不带这两个标记，行为不变。
    // outboundVerdict：逻辑入口（sendText / deliver）已经判过了，这里不重复判，但由真实出口处结算。
    let verdict = opts.outboundVerdict || null
    if (wantsOutbound(opts)) {
      verdict = passOutbound({ chatId, note, sourceModule: opts.sourceModule, enginePolicy: opts.enginePolicy, cause: opts.cause, itemId: opts.itemId, kind: 'segments' })
      if (verdict.action === 'deny') {
        log.info(`出站被策略拦下（${verdict.reason || 'deny'}）→ ${chatId}：${opts.sourceModule || opts.enginePolicy || ''} [${note || ''}]`)
        return null
      }
      // 往下走的是真实出口：成功后结算成 sent（失败/异常分支各自结算成 failed）
      opts = { ...opts, sourceModule: undefined, enginePolicy: undefined, cause: undefined, itemId: undefined }
    }
    const cfg = getConfig()
    const tgt = targetOf(chatId)
    // 目标解析不出来（chatId 写了别的形态）：门闸若已放行要结算成 failed，否则预占永远挂着
    if (!tgt) return settleOutboundFailed(verdict)
    const cleaning = cleaningFor(chatId)
    // 转发到其他平台的 send 钩子也只能拿到清洗后的正文。
    message = cleanOutboundSegments(message, cleaning)
    if (!message.length) return settleOutboundFailed(verdict)
    // 扩展模块最后改一次（加签名、过滤敏感词、转发到别处……）；返回 null 就不发
    if (hooks?.send) {
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
    // 熔断：模型失控时别把整段原样交给 OneBot（2026-11-13 08:02 那 48263 字「在吗」）。
    const capped = capOutboundSegments(message)
    if (capped.trimmed) {
      const kept = capped.message.filter((seg) => seg.type === 'text').reduce((n, seg) => n + String(seg.data?.text || '').length, 0)
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
    if (force) {}
    else if (!cfg.enabled) {
      log.info(`总开关关着，没发 → ${chatId}：${note}`)
      return settleOutboundFailed(verdict)
    }
    const action = tgt.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
    const sourceGroupId = tgt.kind === 'private' ? privateSources.get(tgt.id) : ''
    const params = tgt.kind === 'group' ? { group_id: Number(tgt.id), message } : { user_id: Number(tgt.id), ...(sourceGroupId ? { group_id: Number(sourceGroupId) } : {}), message }
    const deliveryScope = !sensitive && !cfg.debug
      ? hooks?.deliveryScope?.(chatId, pnow(), cfg.botQQ)
      : null
    try {
      const r = await onebot.call(action, params, timeoutMs ? { timeoutMs } : undefined)
      if (r && r.message_id !== undefined) {
        sentIds.add(String(r.message_id))
        if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value)
      }
      bump('sent')
      recordDeliveryTypes(chatId, message)
      if (outputScope.getStore()?.chatId === chatId) outputScope.getStore().sent++
      settleOutbound(verdict, 'sent')
      // 主动发出的话（模块/后台会话直接调 sendText）要在目标聊天留痕，不然下次接话会断片。
      // 聊天回合自己的回复不带 proactive（deliver 已经记过），这里一字不动。
      if (opts.proactive) noteProactive(chatId, message, opts)
      reportDelivery(chatId, r, deliveryScope, isCurrent)
      return r
    } catch (error) {
      // 网关预热/短暂不可达：确定没发出去的消息放进补发队列，连上后按 TTL 补发。
      // 超时（uncertain）不入队，避免同一条消息发两次。
      if (!sensitive && outbox && isDefiniteFailure(error)) {
        const q = outbox.add({
          action, params, chatId, note, kind: queueKind, ttlMs: queueTtlMs, deliveryScope,
          // #327：入队时记下「这条是主动发言」，补发成功后由宿主回调补流水，不能因为断线就当没说过。
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
      // 结果不确定（超时 / 断线）时按 uncertain 结算：可能已经发出去了，不能当没发去退款重发
      settleOutbound(verdict, isDefiniteFailure(error) ? 'failed' : 'uncertain')
      if (throwOnError) throw error
      if (!quiet) failStore.getStore()?.push(detail)
      return null
    }
  }

  /** 门闸放行但这一步没发出去：结算成 failed 并把 null 返回给调用方（保持旧真值语义）。 */
  function settleOutboundFailed(verdict) {
    settleOutbound(verdict, 'failed')
    return null
  }

  /** replyId：要引用回复的那条 QQ 消息（可选）。 */
  const quote = (replyId) => (replyId ? [{ type: 'reply', data: { id: String(replyId) } }] : [])

  const mention = (userId, segs = []) => (userId && !segs.some((s) => s.type === 'at' && String(s.data?.qq) === String(userId)) ? [{ type: 'at', data: { qq: String(userId) } }, { type: 'text', data: { text: ' ' } }] : [])

  async function sendText(chatId, text, replyId, missed, userId, opts : SendTextOptions = {}) {
    // 主动发言门闸（只在模块调用路径生效：模块快捷 API / scoped hub 会带 sourceModule）。
    // hub 内部发送（回复、命令回执、语音补表情……）不带 sourceModule，行为与改造前完全一致。
    // 被拦一律返回 null —— 铁律：旧调用口的真值语义不变（设计稿 §1.4）。
    // 这里是**逻辑入口**：判过之后把 verdict 传给 sendSegments（真实出口）去结算，不再重复判定。
    let verdict = opts && opts.outboundVerdict ? opts.outboundVerdict : null
    if (wantsOutbound(opts)) {
      verdict = passOutbound({ chatId, text, sourceModule: opts.sourceModule, enginePolicy: opts.enginePolicy, cause: opts.cause, itemId: opts.itemId, kind: 'text' })
      if (verdict.action === 'deny') {
        log.info(`出站被策略拦下（${verdict.reason || 'deny'}）→ ${chatId}：${opts.sourceModule || opts.enginePolicy || ''}`)
        return null
      }
      // 已经判过了：摘掉标记，只在 opts 里留 verdict 让出口层结算（同一条消息不该扣两份额度）
      opts = { ...opts, sourceModule: undefined, enginePolicy: undefined, cause: undefined, itemId: undefined, outboundVerdict: undefined }
    }
    // 先清洗，避免调用参数或提示词里的 @ / 表情变成真正的消息段。
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (!text.trim()) return settleOutboundFailed(verdict)
    // 文字里的 <face:名字> 换成 QQ 系统表情，和文字在同一条消息里；系统表情关着就去掉标签
    let segs = getConfig().stickers.faces ? textToSegments(text, faces.idOf) : [{ type: 'text', data: { text: stripFaceTags(text) } }]
    // 群里的 @名字 / <at:QQ号> 换成真 @（对方会收到提醒）
    if (chatId.startsWith('group:') && hasMention(text)) segs = expandMentions(segs, await membersOf(chatId.slice(6)), missed)
    if (!segs.length || (segs.length === 1 && segs[0].type === 'text' && !segs[0].data.text.trim())) return settleOutboundFailed(verdict)
    // 真正出去的是 sendSegments：把 verdict 交下去让它按真实结果结算（sent / failed / uncertain）
    return sendSegments(chatId, [...quote(replyId), ...mention(userId, segs), ...segs], (replyId ? '[引用] ' : '') + text.slice(0, 60), verdict ? { ...opts, outboundVerdict: verdict } : opts)
  }

  async function sendVoice(chatId, text, replyId, userId, opts : SendVoiceOptions = {}) {
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (!text.trim()) return false
    let b64, engine, extras
    try {
      // 表情标签 / emoji 不念出来：TTS 只念能说的字（用户反馈：发语音时「呲牙」被读出来）
      const split = splitSpeakable(text)
      extras = split.extras
      if (!split.spoken) throw new Error('这条语音里只有表情/符号，没有能念的字')
      const voice = await tts.speak(split.spoken)
      engine = voice.engine
      b64 = readFileSync(voice.file).toString('base64')
    } catch (error) {
      log.warn('语音没合成出来，改发文字：', error.message)
      await sendText(chatId, text, replyId, undefined, userId)
      return false
    }
    // QQ 客户端不支持「引用 / @ + 语音」同一条消息：语音条一律单独成条（issue #103）。
    if (replyId || userId) log.debug(`语音条不能带引用/@（QQ 限制），单独发：${chatId}`)
    try {
      const r = await sendSegments(chatId, [{ type: 'record', data: { file: 'base64://' + b64 } }], `[语音·${engine}] ${text.slice(0, 40)}`, { throwOnError: true, timeoutMs: FILE_TIMEOUT_MS })
      if (r || !getConfig().enabled) {
        bump('voice')
        // 表情不念出来，但要补上：语音条发完再单独发一条文字里的表情（用户反馈：希望表情和语音分开发）
        if (extras && getConfig().voice.emojiSeparate !== false) {
          // 补发是额外的一条：失败只记日志，不算这一轮发失败（不然语音明明发出去了也会被当成没发）
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
        await sendText(chatId, text, replyId, undefined, userId)
      } else {
        log.warn('语音发送结果不确定，不再改发文字：', error.message)
        failStore.getStore()?.push(error.message)
      }
      return false
    }
  }

  /**
   * 戳回去：私聊戳对方，群里戳最近戳她的人（没人戳过就戳这一段最后说话的人）。
   *
   * 这条**不走出站门闸**（主动发言策略），是有意的：
   * - 它是「回应型」动作——别人先戳了她，她才戳回去，不是主动搭话；
   * - 设计稿 §2 非目标明确写了「不拦回应型发言」。
   * 戳一戳也不产生消息、不占发言额度，硬塞进治理只会让「回敬一下」也被拦，反而伤手感。
   */
  async function pokeBack(chatId) {
    const cfg = getConfig()
    const group = chatId.startsWith('group:') ? chatId.slice(6) : ''
    const target = group ? lastPoker.get(chatId) || lastSpeaker.get(chatId) : chatId.slice(8)
    if (!target) return
    if (!cfg.enabled) return log.info(`总开关关着（没真戳）→ ${chatId}：戳了戳 ${target}`)
    try {
      await onebot.call('send_poke', { user_id: Number(target), ...(group ? { group_id: Number(group) } : {}) }, { timeoutMs: 10000 })
      recordDeliveryTypes(chatId, [{ type: 'poke' }])
      log.info(`${chatId}：她戳了戳 ${target}`)
    } catch (error) {
      log.debug('戳一戳失败：', error.message)
    }
  }

  /** 把一个音频文件当语音条发出去（翻唱用）。 */
  async function sendVoiceFile(chatId, file, note) {
    if (isDisposed()) return null
    const b64 = readFileSync(file).toString('base64')
    const r = await sendSegments(chatId, [{ type: 'record', data: { file: 'base64://' + b64 } }], note || '[语音]')
    if (r || !getConfig().enabled) bump('voice')
    if (!r && getConfig().enabled) throw new Error('网关没接受这条语音')
    return r
  }

  // 发文件：网关可能和插件不在同一台机器上（Docker / 远程 OneBot），它看不到本机路径，
  // 所以按本机路径发失败时，小文件会用 base64 再试一次；超时留长一点，别把大文件上传误判成失败。
  // 安全默认（#52）：功能默认关；只允许发 QQ 工作区（她平时写文件的地方）和面板里额外加的目录里的文件；
  // 单个文件有大小上限；只在主人私聊里能触发；发了什么会写进日志。
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

  /** 发文件、发图共用的一套检查：绝对路径、存在、是文件、在允许的目录里、不超过大小上限。 */
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

  /** 把一个文件当文件发到 QQ（OneBot upload_private_file / upload_group_file）。file 可以是本机绝对路径、网址或 base64://。 */
  async function sendFile(chatId, file, name) {
    if (isDisposed()) return null
    const cfg = getConfig()
    const tgt = targetOf(chatId)
    if (!tgt) return null
    if (!cfg.files?.enabled) throw new Error('发文件没打开（面板「聊天」页 → 发文件），打开后才能发')
    const { src, external, size, maxBytes } = checkSendableFile(cfg, file)
    // 文件显示名也会出现在 QQ 文件卡片上：和正文一样过一遍出站清洗，避免工具文字/提示词借文件名露出。
    const label = cleanOutboundText(fileLabel(name, src), cleaningFor(chatId)).trim() || '文件'
    // 模拟测试：只记下来，不真发
    const cap = activeCapture()
    if (cap) {
      cap.push({ chatId, note: `[文件] ${label}`, message: [{ type: 'file', data: { file: src, name: label } }] })
      return { message_id: 'sim-' + cap.length }
    }
    if (!cfg.enabled) { log.info(`总开关关着，没发 → ${chatId}：[文件] ${label}`); return null }
    const action = tgt.kind === 'group' ? 'upload_group_file' : 'upload_private_file'
    const params = tgt.kind === 'group'
      ? { group_id: Number(tgt.id), file: src, name: label }
      : { user_id: Number(tgt.id), file: src, name: label }
    const srcLabel = external ? (src.startsWith('base64://') ? 'base64' : '外部地址') : size < 1024 ? size + ' B' : Math.round(size / 1024) + ' KB'
    try {
      const r = await onebot.call(action, params, { timeoutMs: FILE_TIMEOUT_MS })
      if (isDisposed()) return null
      bump('sent')
      log.info(`${chatId}：发文件「${label}」（${srcLabel}）`)
      return r
    } catch (error) {
      if (isDisposed()) return null
      // 只有明确失败时才回落：超时或断线可能已经发出，再发会重复。
      const canRetryBase64 = isDefiniteFailure(error) && !external && size <= Math.min(FILE_BASE64_MAX, maxBytes)
      if (!canRetryBase64) {
        bump('errors')
        log.warn(`${chatId}：发文件「${label}」失败${isDefiniteFailure(error) ? '' : '，发送结果不确定，不再重发'}：`, error.message)
        throw new Error(`发文件失败：${error.message}`)
      }
      try {
        const b64 = 'base64://' + readFileSync(src).toString('base64')
        const r = await onebot.call(action, { ...params, file: b64 }, { timeoutMs: FILE_TIMEOUT_MS })
        if (isDisposed()) return null
        bump('sent')
        log.info(`${chatId}：发文件「${label}」（网关看不到本机路径，改走 base64）`)
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
    // 面板里把表情包关了：回复里的 <sticker:…>、工具、扩展模块要发的一律不发（#31）
    if (!getConfig().stickers.enabled) {
      log.debug(`表情包关着，「${typeof query === 'object' ? query?.name || '' : query}」不发`)
      return false
    }
    const item = query && typeof query === 'object' ? query : stickers.match(query)
    if (!item) {
      log.debug(`没找到「${query}」这张表情，跳过`)
      return false
    }
    const seg = stickers.segmentFor(item)
    if (!seg) return false
    await sendSegments(chatId, [...quote(replyId), ...mention(userId), seg], `[表情] ${item.name || item.md5.slice(0, 8)}`)
    stickers.markUsed?.(item.md5)
    bump('stickers')
    return true
  }

  /** 她回复里写的本机图片：主人私聊之外只认工作区、允许目录和插件数据目录，防止被人诱导发出电脑上的图。 */
  function localImageBlocked(chatId, src) {
    const cfg = getConfig()
    if (chatId === `private:${cfg.ownerQQ}`) return false
    const s = String(src ?? '').trim()
    if (!isAbsolute(s) && !/^file:/i.test(s)) return false
    try {
      return !insideRoots(/^file:/i.test(s) ? fileURLToPath(s) : s, [...fileRootsOf(cfg), dataDir()])
    } catch (error) { return true }
  }

  /**
   * 发一张图。本地绝对路径（或 file://）先试「路径直发」——网关和 NapCat 在同一台机器/共享挂载时，省掉读盘和
   * base64 膨胀（#169）。只有网关明确拒绝（路径读不到、retcode 非 0）才改用 base64；超时、断线可能已经发出去了，
   * 再发会变成两张，所以不回退。files.imageByPath 关掉就一直是 base64。
   */
  async function sendImage(chatId, src, replyId, userId, opts : SendImageOptions = {}) {
    if (isDisposed()) return null
    const s = String(src ?? '').trim()
    const head = [...quote(replyId), ...mention(userId)]
    const local = isAbsolute(s) ? s : /^file:\/\//i.test(s) ? s : ''
    if (local && getConfig().files?.imageByPath !== false) {
      // Windows 上 'file://' + 'C:\...' 不是合法 URL，网关读不到；pathToFileURL 会给出 file:///C:/... 这种正确形态
      const file = local.startsWith('file://') ? local : pathToFileURL(local).href
      try {
        const r = await sendSegments(chatId, [...head, { type: 'image', data: { file } }], `[图片·路径] ${local.slice(-40)}`, { throwOnError: true, ...opts })
        if (r) {
          log.debug(`${chatId}：按路径发图「${local.slice(-40)}」`)
          return r
        }
        // 总开关关着、试运行、或者扩展模块拦下了：这不是错误，也不该再走 base64 发一遍
        return null
      } catch (error) {
        if (!isDefiniteFailure(error)) {
          log.warn(`${chatId}：按路径发图失败，发送结果不确定，不再重发：`, error.message)
          // 调用方要发别的形态（比如 qq_send_file 想改用 sendFile）时，得知道「可能已经发出去了」，不能接着发第二份
          if (opts.strict) throw new Error(`图片可能已经发出去了，但网关没确认：${error.message}`)
          return null
        }
        log.debug(`${chatId}：按路径发不出去，改用 base64：`, error.message)
      }
    }
    try {
      const buf = await fetchImage(s, { maxBytes: MAX_IMAGE_BYTES })
      return sendSegments(chatId, [...head, { type: 'image', data: { file: 'base64://' + buf.toString('base64') } }], `[图片] ${s.slice(-40)}`, opts)
    } catch (error) {
      log.warn('图片发不出去：', error.message)
      return null
    }
  }

  function silenceTurn(chatId, reason = '她选择不说话') {
    log.info(`${chatId}：${reason}`)
    if (chatId.startsWith('group:')) {
      const gid = chatId.slice(6)
      groupEngaged.delete(gid)
      groupEngagedRun.delete(gid)
      groupInterjects.set(gid, [...(groupInterjects.get(gid) || []), Date.now()].slice(-60))
    }
    return { silent: true }
  }

  return {
    targetOf, recordDeliveryTypes, reportDelivery, stripAcpSegments, sendSegments, settleOutboundFailed,
    quote, mention, sendText, sendVoice, pokeBack, sendVoiceFile, sendFile, sendSticker,
    localImageBlocked, sendImage, silenceTurn, checkSendableFile,
  }
}
