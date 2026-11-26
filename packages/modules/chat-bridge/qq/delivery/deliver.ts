// 一条回复的落地：清洗、污染闸、拆条、语音/表情概率、逐条发送、回执与流水。
// 发送原语在 outbound.ts；这里只决定「发什么、怎么拆、哪些真发出去了」。

import { cleanOutboundText, cleanOutboundSegments, parseReply, itemsToLine, tidyPunctuation, hasSuspectTagShape, bubbleDelay } from '../../../../../src/chat/reply/index.ts'
import { preserveReplyStickers } from '../../../../../src/chat/policy/rules/sticker.ts'
import { guardOutgoing } from '../../../../../src/chat/inbound/hooks/guard.ts'
import { failStore } from '../context/context.ts'

/** 一条回复的调用参数：字段名固定，值由调用方传。 */
type SendOptions = Record<string, any>
type DeliverOptions = SendOptions
type DeliverTurnOptions = SendOptions

export interface DeliverDeps {
  [key: string]: any
}

export function createDeliver(deps: DeliverDeps) {
  const {
    getConfig, log, hooks, stickers, groupRefs, groupSaid, groupEngaged, ENGAGE_MS, saidElsewhere, askModel,
    outputScope, outputSources, currentPromptSources, groupChatAllowed,
    cleaningFor, random, mood, silenceTurn, guardOutgoing, parseReply, hasSuspectTagShape, tidyPunctuation,
    cleanOutboundSegments, itemsToLine, bubbleDelay, pause, sendText, sendVoice, sendSticker, pokeBack,
    localImageBlocked, sendImage, sendFile, logChat, onActivity, noteTurnActivity, isDisposed,
  } = deps

  // ---------- ACP 模型兜底（默认关，chat.acpSanitize.modelFallback 打开才用） ----------
  //
  // 只解决「正则已经尽力、但文本里还留着标签/属性形状」的少量情况，不做全量改写。
  // 硬约束（任何一条不满足就不改、直接用正则结果）：
  //   · 同一聊天有冷却窗（ACP_ASK_COOLDOWN_MS），一轮里的多条分段不会各问一次；
  //   · 文本长度 ≤ cfg.chat.acpSanitize.modelMaxChars；
  //   · 有超时（modelTimeoutMs），超时/抛错/宿主没接 askModel → 退回正则结果；
  //   · 模型结果必须通过 looksClean：不含标签属性形状，且保留了原文的主要字符
  //     （防止模型顺手把正常语气也重组了——这是「伤语气」风险的工程化消解）。

  /** 每个聊天上一次为 ACP 净化问模型的时间戳：限流用（一条回复的几个分段不该各问一次）。 */
  const acpAskedAt = new Map()
  /** 同一个聊天多久内不再重复问模型（毫秒）。一轮里的分条发送都落在这个窗口内。 */
  const ACP_ASK_COOLDOWN_MS = 5000

  /** 把标签/属性串挖掉后还剩多少「实数」字符，用来判断模型是否保留了原文内容。 */
  function acpSolidChars (s) {
    return String(s || '')
      .replace(/<[^<>]*>/g, '')
      .replace(/"[^"]*"/g, '')
      .replace(/[\s\p{P}\p{S}]/gu, '')
  }

  /** 模型结果验收：不能更脏，且必须留住原文至少 60% 的实字。 */
  function looksClean (before, after) {
    const a = String(after || '').trim()
    if (!a) return false
    if (hasSuspectTagShape(a)) return false
    const want = acpSolidChars(before)
    if (!want) return true
    const got = acpSolidChars(a)
    if (!got) return false
    // 逐字符比对：模型可能把整句重写，只保留「出现在原文里」的那些字来算重合度。
    let hit = 0
    const pool = new Map()
    for (const ch of want) pool.set(ch, (pool.get(ch) || 0) + 1)
    for (const ch of got) {
      const left = pool.get(ch) || 0
      if (left > 0) { hit++; pool.set(ch, left - 1) }
    }
    return hit / want.length >= 0.6
  }

  /** 带超时的模型净化；任何异常都返回 null（调用方据此保留正则结果）。 */
  async function acpModelFallback (chatId, text, cfg, beforeClean = text) {
    const conf = cfg.chat.acpSanitize
    const limit = Math.max(100, Number(conf.modelMaxChars) || 800)
    if (String(beforeClean).length > limit) return text
    if (typeof askModel !== 'function') return text
    // 限流（每聊天一个冷却窗）：一轮可能分多条发送，不能每条都问一次模型。
    const now = Date.now()
    if (now - (acpAskedAt.get(chatId) || 0) < ACP_ASK_COOLDOWN_MS) return text
    acpAskedAt.set(chatId, now)
    if (acpAskedAt.size > 200) acpAskedAt.clear()
    const timeoutMs = Math.max(500, Number(conf.modelTimeoutMs) || 4000)
    let timer
    try {
      // 超时后那个 call 可能还在跑并最终 reject：先挂一个空 catch，避免变成 unhandled rejection。
      const call = Promise.resolve(askModel({
        cfg,
        module: 'acp-sanitize',
        usageTask: 'acp-sanitize',
        maxTokens: 400,
        temperature: 0,
        system: '你是文本净化器。用户会给你一段聊天回复，其中可能混入了传输协议标签（形如 <acp tokens="86" type="text" time="…">m01990</acp>）'
          + '或它们的残片（="text" time="…">>、6-11-22 17:26:55">）。\n'
          + '把这类标签、属性串、编号全部删掉，**其余内容一个字都不要改**：不改语气、不改措辞、不增删语义、不解释。\n'
          + '删完如果什么都不剩，只输出 [沉默]。只输出净化后的正文本身。',
        text: String(beforeClean),
      }))
      call.catch(() => {})
      const out = await Promise.race([
        call,
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
      ])
      if (out === null || out === undefined) {
        log.debug(`${chatId}：ACP 模型兜底超时，用正则结果`)
        return text
      }
      const cleaned = String(out).trim()
      // 验收对齐的是「正则已经产出的结果」：模型改成别的语气/别的意思都要丢掉。
      if (cleaned === '[沉默]' || !looksClean(text, cleaned)) {
        log.debug(`${chatId}：ACP 模型兜底结果不合格，用正则结果`)
        return text
      }
      log.info(`${chatId}：ACP 模型兜底生效`)
      return cleaned
    } catch (error) {
      log.debug(`${chatId}：ACP 模型兜底出错，用正则结果：`, error && error.message)
      return text
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // 拼语音正文时把非末段的收尾标点收掉再拼，避免 ``。`` + `，` 生成双标点；
  // 不在这里整段 tidy，否则会把代码示例里的字面量一起改掉。
  function joinSpoken(parts) {
    const list = (parts || []).map((v) => String(v || '').trim()).filter(Boolean)
    if (list.length <= 1) return list[0] || ''
    // 段间插入逗号后再统一收双标点：代码段里的「x。」只去掉 join 出来的逗号，
    // 不会像逐段剪尾那样把代码自己的句号剪掉。
    return tidyPunctuation(list.join('，'))
  }

  async function deliverTurn(chatId, text, opts : DeliverTurnOptions = {}) {
    if (isDisposed()) return
    const cfg = getConfig()
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (text.trim() && hooks?.reply) {
      try {
        const next = await hooks.reply(text, { chatId, userText: opts.userText || '' })
        if (next === null) return log.info(`${chatId}：扩展模块拦下了这次回复`)
        if (typeof next === 'string') text = next
      } catch (error) {
        log.warn('扩展模块改写回复出错：', error.message)
      }
    }
    if (isDisposed()) return
    // 记下清洗前的样子：模型兜底要判断的是「原本有没有可疑标签残渣」，
    // 而不是「清洗后还剩没剩」——正则剥干净之后，条件就永远不成立了。
    const beforeClean = text
    text = cleanOutboundText(text, { ...cleaningFor(chatId), onPromptDecision: (allow) => { outputScope.getStore().allowPromptEcho = allow } })
    // ACP 模型兜底（默认关）：清洗前有标签/属性残渣时，再问一次模型确认它真的干净了。
    // 三道保险：① 只在 chat.acpSanitize.modelFallback 打开时才走；② 每个聊天有冷却窗，不会每条都问；
    // ③ 失败/超时/模型输出更脏，一律退回上面的正则结果 —— 绝不因此卡住或丢掉这条回复。
    if (cfg.chat?.acpSanitize?.modelFallback === true && beforeClean.trim() && hasSuspectTagShape(beforeClean)) {
      text = await acpModelFallback(chatId, text, cfg, beforeClean)
    }
    // 出站污染闸：模型偶尔会把思考直接写进正文（英文判断 + 中文真话），或者思考塌缩成复读。
    // 这里切掉思考前缀、拦住退化内容；拦下就当她这轮没说话，宁可沉默也不发半句思考。
    if (cfg.chat?.thinkingGuard?.enabled !== false) {
      const guarded = guardOutgoing(text, { source: opts.fromThinking ? 'reasoning' : (opts.interim ? 'interim' : 'message') })
      if (!guarded.ok) {
        // 带上被拦原文的前 80 字：blank / thinking-only 这类判定看不出拦了什么，排查时只能靠它。
        log.info(`${chatId}：这条没发出去（${guarded.reason}）：${String(text || '').replace(/\s+/g, ' ').slice(0, 80)}`)
        if (!opts.interim) silenceTurn(chatId)
        return
      }
      text = guarded.text
    }
    const r = parseReply(text, { ...cleaningFor(chatId), voice: opts.voice === true })
    if (r.silent) return silenceTurn(chatId)
    let items = r.items
    // 分条发出的中间段（chat.everyStep）：只发她当时说的原话，不做语音转换、不补表情、不按概率改形态，
    // 免得一段闲聊被拆成语音条和表情乱入。标签、markdown 图片照旧解析，表情仍受显式开启的概率限制。
    const interim = Boolean(opts.interim)
    // 一段回复只抽一次：模型标签、自动补图与 items 钩子共用结果，拒绝后不能再补一张。
    // 新开关默认关，保留旧的「标签直发、自动补图受心情影响」行为。
    let stickerAllowed, stickersFiltered = false
    const allowReplySticker = () => (stickerAllowed ??= random() < cfg.stickers.autoChance * (cfg.stickers.limitTagged ? 1 : mood().sticker))
    const limitReplyStickers = (list) => {
      if (!cfg.stickers.limitTagged || !list.some((i) => i.kind === 'sticker')
        || (cfg.stickers.keywordExemption && preserveReplyStickers(list)) || allowReplySticker()) return list
      stickersFiltered = true
      return list.filter((i) => i.kind !== 'sticker')
    }
    // 含代码块的回复不走自动语音：代码字面量不能被语音兜底/自动语音的重拼改坏。
    const hasCodeBlock = /```|~~~/.test(text)
    // 对方明确要语音、她却只打了字：整段改成语音发（模型偶尔会忘，这里兜底）
    if (!interim && !hasCodeBlock && opts.wantVoice && cfg.voice.enabled && !items.some((i) => i.kind === 'voice')) {
      const spoken = joinSpoken(items.filter((i) => i.kind === 'text').map((i) => i.value))
      if (spoken && spoken.length <= 300) items = [{ kind: 'voice', value: spoken }, ...items.filter((i) => i.kind !== 'text')]
    }
    // 短回复按概率整条变语音
    const texts = items.filter((i) => i.kind === 'text')
    if (!interim && !hasCodeBlock && cfg.voice.enabled && items.length === texts.length && texts.length > 0) {
      const all = joinSpoken(texts.map((t) => t.value))
      if (all.length <= cfg.voice.autoMaxChars && Math.random() < cfg.voice.autoChance * mood().voice) items = [{ kind: 'voice', value: all }]
    }
    items = limitReplyStickers(items)
    const inGroup = chatId.startsWith('group:')
    // 群里别刷屏：一段最多 3 条。超了不静默截断——整段并成一条发出去，条数照样不涨
    if (inGroup && items.length > 3) {
      const mergedText = items.filter((i) => i.kind === 'text').map((i) => i.value.trim()).filter(Boolean).join('\n')
      if (mergedText) {
        items = [{ kind: 'text', value: mergedText }, ...items.filter((i) => i.kind !== 'text')]
        log.debug(`[chat] ${chatId}：拆多条会超群聊 3 条上限，这一段并成 1 条发（${mergedText.length} 字）`)
      }
      if (items.length > 3) items = items.slice(0, 3)
    }
    // 按概率补一张表情（群里已经有两条以上就不补了）
    if (!interim && cfg.stickers.enabled && !items.some((i) => i.kind === 'sticker') && !(inGroup && items.length >= 2) && allowReplySticker()) {
      const pick = stickers.pickForReply(texts.map((t) => t.value).join(' '))
      if (pick) items.push({ kind: 'sticker', value: pick })
    }
    const beforeHook = new Set(items)
    const beforeValues = new Map(items.map((it) => [it, (it.kind === 'text' || it.kind === 'voice') ? it.value : undefined]))
    if (hooks?.items) {
      try {
        const next = await hooks.items(items, { chatId, text, userText: opts.userText || '' })
        if (next === null) return log.info(`${chatId}：扩展模块拦下了这次回复`)
        if (Array.isArray(next)) items = next
      } catch (error) {
        log.warn('扩展模块改写回复出错：', error.message)
      }
    }
    items = limitReplyStickers(items)
    // 模块通过 items 钩子追加或原地改写过的文字也走同一份标点清洗；原有气泡已在 parseReply 里处理过。
    items = items.map((it) => {
      if (it.kind !== 'text' && it.kind !== 'voice') return it
      const changed = !beforeHook.has(it) || beforeValues.get(it) !== it.value
      return changed ? { ...it, value: tidyPunctuation(it.value) } : it
    })
    // 钩子改写后仍走同一个清洗，保留每条的语音/引用元数据。
    items = cleanOutboundSegments(items.map((item) => ({
      type: ['text', 'voice'].includes(item.kind) ? 'text' : item.kind,
      data: { text: item.value }, item,
    })), { ...cleaningFor(chatId), allowPromptEcho: false, onPromptDecision: (allow) => { outputScope.getStore().allowPromptEcho = allow } })
      .map((seg) => seg.type === 'text' ? { ...seg.item, value: seg.data.text } : seg.item)
    if (!items.length) return silenceTurn(chatId, stickersFiltered ? '本轮表情被概率过滤，没有消息可发' : '回复清理后为空，没有消息可发')
    // 一段只有一个人明确 @ / 引用她时，第一条回复引用并 @ 那个人；多人同时叫她不猜。
    // 模型明确选了引用编号时尊重它，不再自动引用另一条。
    const refs = inGroup ? groupRefs.get(chatId.slice(6)) || {} : {}
    const explicit = items.some((item) => item.replyTo)
    const firstSendable = items.findIndex((item) => item.kind === 'text' || item.kind === 'voice' || item.kind === 'image' || item.kind === 'file' || (item.kind === 'sticker' && cfg.stickers.enabled && Boolean(item.value && typeof item.value === 'object' ? item.value : stickers.match(item.value))))
    const missedAt = [] // 写了 @ 却没对上群里人的名字
    const failures = []
    const interacted = new Set()
    const sentTexts = [] // 实际成功发出的文字/语音正文：桥接与返回值只认这些，没发出去的话不能算说过
    // 实际发出去的条目（#349）：流水只能记这些。以前这里用的是「打算发的全部 items」，
    // 网关在中间断掉时后半截其实没发出去，流水却把全文记成「她说过的话」，
    // 事后既查不出哪段丢了，读 saidElsewhere / lastBotToOwner 的路径也会以为话说完了。
    const sentItems = []
    await failStore.run(failures, async () => {
      for (let i = 0; i < items.length; i++) {
        if (isDisposed()) return
        const it = items[i]
        const selected = it.replyTo ? refs[it.replyTo] : (!explicit && i === firstSendable ? opts.autoReply : null)
        const replyId = selected?.mid
        // 她自己引用了 @ 她的人就照常 @；自动回复只有一个人说话时才有（#160）
        const userId = selected && (selected.direct || opts.autoReply?.uid === selected.uid) ? selected.uid : undefined
        if (it.replyTo && !replyId) log.debug(`${chatId}：引用的编号 ${it.replyTo} 对不上，正常发`)
        // 这条真发出去没有，看 outputScope 的 sent 计数有没有涨（sendSegments 只在真发/捕获时计数；
        // dry-run 与总开关关闭都不涨 → sentTexts 为空，她没说出口的话不能算说过）。#211 review 二轮。
        const sentBefore = outputScope.getStore().sent
        if (it.kind === 'text') await sendText(chatId, it.value, replyId, missedAt, userId)
        else if (it.kind === 'voice') {
          const asVoice = cfg.voice.enabled
          if (asVoice) await sendVoice(chatId, it.value, replyId, userId, opts)
          else await sendText(chatId, it.value, replyId, missedAt, userId)
          // 手机客户端渲染媒体比文字慢，紧跟着发配文会被压到语音条上面。语音发完先停一下再发下一条（#546）。
          const next = items[i + 1]
          if (asVoice && !opts.simulate && next && (next.kind === 'text' || next.kind === 'image' || next.kind === 'sticker')) await pause(1200)
        } else if (it.kind === 'sticker') await sendSticker(chatId, it.value, replyId, userId)
        // `<file>路径</file>`：平台能发文件就发文件；发文件关着/目录不允许时由 sendFile 抛出原因，按发送失败记。
        else if (it.kind === 'file') await sendFile(chatId, it.value, it.name)
        else if (it.kind === 'poke') { if (!opts.simulate) await pokeBack(chatId) }
        else if (it.kind === 'image') {
          if (localImageBlocked(chatId, it.value)) log.warn(`${chatId}：回复里的本机图片不在允许的目录里，没发`)
          else await sendImage(chatId, it.value, replyId, userId)
        }
        if (outputScope.getStore().sent > sentBefore) {
          if (selected?.uid) interacted.add(String(selected.uid))
          if ((it.kind === 'text' || it.kind === 'voice') && String(it.value || '').trim()) sentTexts.push(it.value)
          sentItems.push(it)
        }
        if (i < items.length - 1 && !opts.simulate) await pause(bubbleDelay(items[i + 1].kind === 'text' ? items[i + 1].value : '') * mood().delay)
      }
    })
    if (isDisposed()) return
    if (outputScope.getStore().blocked && !outputScope.getStore().sent) return silenceTurn(chatId)
    if (opts.simulate) return items
    // 一条都没发出去：不记流水，她没说出口的话不能算说过
    const receipt = { sentTypes: [...outputScope.getStore().sentTypes], queuedTypes: [...outputScope.getStore().queuedTypes] }
    if (failures.length && failures.length >= items.filter((i) => i.kind !== 'poke').length) return { missedAt, failed: failures.length, errors: failures, sent: sentTexts.join(' '), ...receipt }
    if (inGroup) {
      const gid = chatId.slice(6)
      const said = (groupSaid.get(gid) || []).filter((t) => Date.now() - t < 3600_000)
      said.push(Date.now())
      groupSaid.set(gid, said)
      groupEngaged.set(gid, Date.now() + ENGAGE_MS) // 在群里说了话 = 加入了话题
    }
    if (sentTexts.length && typeof opts.onDelivered === 'function') {
      try { opts.onDelivered() } catch (error) { log.warn('发送回执处理出错：', error.message) }
    }
    // #349：只把真的发出去的条目记成「她说过的话」。一条都没发出去时上面已经 return，这里不会再写空流水。
    const said = itemsToLine(sentItems, (q) => stickers.match(q))
    if (said) logChat(chatId, 'bot', said, '', { interaction: [...interacted] })
    // 部分失败要留痕：主人只看到「话说了一半」时，至少能在日志里看到少了几段。
    const unattempted = items.length - sentItems.length
    if (failures.length && unattempted > 0) {
      log.warn(`${chatId}：这一轮有 ${unattempted}/${items.length} 段没发出去（${failures[0]}），流水只记了实际发出的 ${sentItems.length} 段`)
    }
    // 不是这个聊天自己那一轮发的（主人在私聊里让她去群里说、扩展模块代发）：记下来，下次这个聊天交给她时告诉她自己说过什么。
    // 只记实际发出去的文本（sentTexts）——她没说出口的话不能算说过（#211 review）。
    if (!opts.own && sentTexts.length) saidElsewhere.set(chatId, [...(saidElsewhere.get(chatId) || []), { at: Date.now(), text: sentTexts.join(' ').slice(0, 300) }].slice(-5))
    // #349：活动时间与「她刚跟主人说过」只认真发出去的条目。
    noteTurnActivity(chatId, sentItems)
    onActivity?.({ kind: 'out', chatId, reply: text, userText: opts.userText || '' })
    return { missedAt, failed: failures.length, errors: failures, sent: sentTexts.join(' '), ...receipt }
  }


  let outboundEngineResolver = null
  /**
   * 注入引擎策略源解析器。传 null 可撤销。
   * @param {((name: string) => object|null)|null} fn
   */
  function setOutboundEngineResolver(fn) {
    outboundEngineResolver = typeof fn === 'function' ? fn : null
    return outboundEngineResolver !== null
  }

  /** 解析 deliver 的 enginePolicy：可以是策略源对象本身，也可以是名字（交给宿主解析）。 */
  function resolveEnginePolicy(spec) {
    if (!spec) return null
    if (typeof spec === 'object') return typeof spec.reserve === 'function' ? spec : null
    if (typeof spec !== 'string' || !outboundEngineResolver) return null
    try {
      const p = outboundEngineResolver(spec)
      return p && typeof p.reserve === 'function' ? p : null
    } catch (error) {
      log.warn('解析引擎策略源出错，这条按未指定策略直发：', error && error.message)
      return null
    }
  }

  /** 一轮回复落地：拆条、语音、表情。 */
  function deliver(chatId, text, opts : DeliverOptions = {}) {
    if (opts.incomingReply && !groupChatAllowed(chatId)) return Promise.resolve({ silent: true })
    const active = currentPromptSources()
    const current = active || outputSources.get(chatId)
    const sources = current && { ...current, system: new Map(current.system), memory: [...current.memory] }
    return outputScope.run({ chatId, sources, incomingReply: Boolean(opts.incomingReply), sent: 0, sentTypes: new Set(), queuedTypes: new Set(), blocked: false, allowPromptEcho: false }, () => deliverWithEnginePolicy(chatId, text, opts))
  }

  /**
   * deliver 的引擎策略分支：
   * - 没指定 enginePolicy（默认）→ 一步不变地走 deliverTurn；
   * - 指定了 → 先 reserve 一份逻辑发言预算：拒绝就当「这轮不说话」返回 undefined（与 silent 同口径，
   *   调用方本来就按真值判断 outcome）；放行则投递后按真实结果 commit（sent / failed / uncertain）。
   */
  async function deliverWithEnginePolicy(chatId, text, opts) {
    const policy = resolveEnginePolicy(opts.enginePolicy)
    if (!policy) return deliverTurn(chatId, text, opts)
    let reserved
    try {
      reserved = policy.reserve({ to: chatId, sourceModule: opts.enginePolicyName || '', itemId: opts.itemId || '', at: Date.now() })
    } catch (error) {
      log.warn('引擎策略源 reserve 抛错，这一轮不发：', error && error.message)
      reserved = { ok: false, reason: 'error' }
    }
    if (!reserved || reserved.ok !== true || !reserved.reserveId) {
      log.info(`${chatId}：引擎策略源没有放行（${(reserved && reserved.reason) || 'unknown'}），这一轮不发`)
      return undefined
    }
    const reserveId = String(reserved.reserveId)
    let outcome = 'failed'
    try {
      const r = await deliverTurn(chatId, text, opts)
      // deliverTurn 的 sent 计数在 outputScope 里：真发出去过才算 sent，否则按 failed 结算（退款口径交给策略源）
      outcome = (outputScope.getStore()?.sent || 0) > 0 ? 'sent' : 'failed'
      return r
    } catch (error) {
      // 抛错 = 结果未知（可能已经发出去了）：按 uncertain 结算，绝不退款重发
      outcome = 'uncertain'
      throw error
    } finally {
      try {
        if (typeof policy.commit === 'function') policy.commit(reserveId, { outcome })
      } catch (error) {
        log.warn(`引擎策略源 commit 失败（${outcome}）：`, error && error.message)
      }
    }
  }



  return {
    deliver, deliverWithEnginePolicy, deliverTurn, setOutboundEngineResolver, resolveEnginePolicy,
  }
}
