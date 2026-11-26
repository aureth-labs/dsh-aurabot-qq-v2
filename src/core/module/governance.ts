// 模块调用的出站治理：谁在替哪个模块说话、能不能发、发出去算不算数。

import { acknowledged } from '../bot/send-events.ts'
import { PERSONA_MEMORY_MODULE } from './privileged.ts'

// 日志兜底：出站治理的日志是「锦上添花」，绝不能因为它把发送链路炸了。
// 全等级 NOOP + safeLog：log 缺失 / 某个等级不是函数 / 日志器自己抛错，都只当没记上。
export const NOOP_LOG = { debug() {}, info() {}, warn() {}, error() {} }

export function safeLog(level, log, ...args) {
  const l = log || NOOP_LOG
  const fn = typeof l?.[level] === 'function' ? l[level] : NOOP_LOG[level]
  try { fn(...args) } catch {}
}

/** 取宿主注入的出站服务；没有或者面不对就当没注入。 */
export function outboundOf(core) {
  const svc = core && core.outbound
  return svc && typeof svc.admit === 'function' ? svc : null
}

/** 模块包装层用的日志口（core.logger 由宿主注入；没有就静默）。 */
export function outboundLogOf(core) {
  try {
    const l = core && core.logger
    return l && typeof l.child === 'function' ? l.child('出站策略') : NOOP_LOG
  } catch (error) {
    return NOOP_LOG
  }
}

/**
 * 模块发送的第一道判定。返回 { allow, verdict }。
 * 判定口径与 hub 门闸完全一致（同一个 svc.admit），只是身份由宿主绑定、模块伪造不了。
 * 治理故障按放行处理：策略源的问题不该把模块的正常发送全卡死（与 hub 门闸同一口径）。
 */
export function admitModuleCall(core, id, ask, log) {
  const svc = outboundOf(core)
  if (!svc) return { allow: true, verdict: null }
  try {
    const verdict = svc.admit({
      to: ask.chatId,
      moduleId: id,
      origin: 'module',
      cause: ask.cause || null,
      itemId: ask.itemId || null,
      at: Date.now(),
      // 模块快捷发送没有排队执行器：broker 档也不排进账本，直接按判定结果走
      allowDefer: false,
    })
    const action = verdict && verdict.action
    // defer 只会在 broker 档出现，没有排队执行器时按 deny 处理（宁可不发，也不越过预算）
    const allow = action === 'allow'
    if (!allow) safeLog('warn', log, `模块「${id}」这次主动发送被策略拦下（${(verdict && verdict.reason) || action || 'deny'}）`)
    return { allow, verdict: verdict || null }
  } catch (error) {
    safeLog('warn', log, `出站判定出错，模块「${id}」这条按放行处理：`, error && error.message)
    return { allow: true, verdict: null }
  }
}

/** 结算一次模块发送的预占：发出去记 sent，没发出去 / 抛错记 failed（退款口径交给策略源自定）。 */
export function settleModuleCall(core, verdict, outcome, log) {
  const svc = outboundOf(core)
  if (!svc || typeof svc.commit !== 'function' || !verdict || !verdict.reserveId) return
  try {
    svc.commit(verdict.reserveId, { deliveryId: verdict.deliveryId, outcome })
  } catch (error) {
    safeLog('warn', log, `出站结算失败（${outcome}）：`, error && error.message)
  }
}

export function governedSend(core, id, ask, run, log) {
  const svc = outboundOf(core)
  if (!svc) return run({ sourceModule: id })
  // 「回合内提示」直发（2026-11-18 生图画前提示重复回归）。
  //
  // 只在**调用方显式声明**这条发送是回合内提示时才放行：她回合里的画前/进度提示是对话的一部分，
  // 走代发决断要等一轮模型，慢工具兜底（1.5s）会先把同一句发出去 → 同一句话发两遍。
  //
  // 为什么必须显式声明、不能按 `hub.turnRunning(chatId)` 一刀切：那等于在**任意模块**的回合窗口内
  // 把外发闸门整体旁路——抖音日报这类「模块主动找主人」的发送只要撞上回合就会绕过代发决断。
  // 闸门的语义是「谁在说」，不是「什么时候说」，所以判定依据只能是发送侧的意图声明。
  //
  // 声明方式（三重条件，缺一不可）：
  //   1. 调用方带 `turnNotice`（scoped hub 发送方法的第 6 个参数，或模块快捷 API 的 opts）；
  //   2. 该模块在 TURN_NOTICE_MODULES 白名单里（宿主侧把关，模块自己写不算）；
  //   3. 此刻这个聊天确实有回合在跑（防止回合结束后有人借标记绕过）。
  const declaresNotice = Boolean(ask?.turnNotice) && TURN_NOTICE_MODULES.has(id)
  const inTurn = declaresNotice && typeof core.hub?.turnRunning === 'function'
    && ask?.chatId && core.hub.turnRunning(ask.chatId)
  if (inTurn) {
    safeLog('info', log, `模块「${id}」这条发送声明为回合内提示（画前/进度），直发不经代发决断`)
    return run({ sourceModule: id, outboundDone: true })
  }
  // broker 档无可审文本（图片/文件/语音/消息段）发主人私聊：识别不了就直发，不进门闸
  if (unreviewableBrokerSend(core, ask)) {
    safeLog('info', log, `模块「${id}」这条主动发送没有可审文本（图片/文件等），按「识别不了就直发」口径直接发出`)
    return run({ sourceModule: id, outboundDone: true })
  }
  const gate = admitModuleCall(core, id, ask, log)
  if (!gate.allow) return null
  // broker 档的纯文本私聊主人：交给宿主代发（引擎决断 + 宿主投递 + 会话记录）
  const verdict = gate.verdict
  const delegate = brokerDelegable(core, verdict, ask)
  if (delegate) {
    // 代发是异步的（引擎决断要走一轮模型），返回 Promise：
    // 发出去了 → { message_id }，引擎决断不发 / 投递失败 → null（旧调用口语义不变）
    return delegateToHost(core, id, ask, verdict, delegate, log)
  }
  const done = (value) => {
    settleModuleCall(core, gate.verdict, acknowledged(value) ? 'sent' : 'failed', log)
    return value
  }
  let r
  try {
    r = run({ sourceModule: id, outboundDone: true })
  } catch (error) {
    settleModuleCall(core, gate.verdict, 'failed', log)
    throw error
  }
  if (r && typeof r.then === 'function') {
    return r.then(done, (error) => {
      settleModuleCall(core, gate.verdict, 'failed', log)
      throw error
    })
  }
  return done(r)
}

/**
 * 这次发送里有没有能拿给引擎过目的文本。
 * 图片 / 文件 / 语音 / 纯消息段的 ask 不带文本（或只有空白），策略源识别不了它们的内容。
 */
export function reviewableTextOf(ask) {
  const text = ask && ask.text !== undefined ? String(ask.text) : ''
  return text.trim()
}

/**
 * 该不该按「识别不了就直发」口径跳过门闸直接发？
 * 条件：broker 档 + 发往治理范围（主人私聊）+ 这次发送没有可审文本。
 * 纯文本仍走门闸 + 代发决断；gate / pass 档与非 owner 目标行为一律不变。
 * tier 从服务 status() 读（deny 的 verdict 不带 tier），读不到就按不适用处理。
 */
export function unreviewableBrokerSend(core, ask) {
  const svc = outboundOf(core)
  if (!svc) return false
  if (reviewableTextOf(ask)) return false
  const to = String((ask && ask.chatId) || '')
  if (typeof svc.isGoverned !== 'function' || !svc.isGoverned(to)) return false
  try {
    const tier = typeof svc.status === 'function' ? svc.status().tier : null
    return tier === 'broker'
  } catch {
    return false
  }
}

/**
 * 这条模块发送该不该改交宿主代发？
 * 条件：broker 档 + admit 放行 + 发往主人私聊 + 有纯文本 + 宿主服务开了 submit。
 * 图片/文件/语音/群消息一律不走（代发决断只针对「一句话」，其余附件的语义不同）。
 */
export function brokerDelegable(core, verdict, ask) {
  const svc = outboundOf(core)
  if (!svc || typeof svc.submit !== 'function') return null
  if (!verdict || verdict.action !== 'allow' || verdict.tier !== 'broker') return null
  const text = ask && ask.text !== undefined ? String(ask.text) : ''
  if (!text.trim()) return null
  const to = String((ask && ask.chatId) || '')
  // 只代发「主动私聊主人」；群聊、朋友私聊均按原路径。
  // 治理范围由服务自己判（它的 getConfig 里有 ownerQQ），模块层不必依赖 core.getConfig。
  const governed = typeof svc.isGoverned === 'function' ? svc.isGoverned(to) : false
  if (!governed) return null
  return svc
}

/**
 * 改交宿主代发：条目进账本、由宿主投递器（host.js 的 send）完成
 * 「审查预占 → 目的引擎（代发决断）会话 → hub.deliver 投递 → 结算」全过程。
 * 返回值语义与旧调用口保持一致：真发出去 → 真值（模块据此 `if (sent)` 判断）；
 * 引擎决断不发 / 投递失败 → null（旧调用方认得的失败值）。
 * 旧预占由宿主投递器内部的 reserveReview 接管，这里先把它释放掉，避免额度被重复占用。
 */
async function delegateToHost(core, id, ask, verdict, svc, log) {
  // 门闸已经放行并预占了额度，但代发路径不用这份预占（宿主内部走 review 预占）——
  // 立刻释放，保证「代发不占引擎说话额度」。
  if (verdict && verdict.reserveId && typeof svc.release === 'function') {
    try { svc.release(verdict.reserveId, { reason: 'delegated-to-host' }) } catch {}
  }
  try {
    const r = await svc.submit(
      { moduleId: id, itemId: ask.itemId || '', to: String(ask.chatId), channel: 'qq', text: String(ask.text ?? ''), at: Date.now() },
      { hostDelegate: true },
    )
    const state = r && typeof r === 'object' ? String(r.state || '') : ''
    if (state === 'sent') return { message_id: 'delegated-' + r.deliveryId }
    if (state === 'pending' || state === 'queued') return { queued: true, deliveryId: r.deliveryId }
    safeLog('warn', log, `模块「${id}」这条代发没发出去（${state || 'unknown'}）`)
    return null
  } catch (error) {
    safeLog('warn', log, `模块「${id}」代发出错：`, error && error.message)
    return null
  }
}

/**
 * scopedHub 上这 6 个函数要过治理（CONTRACT §5）。
 * 其余名字照旧直接转发：hub 的内部入口（stats / sessions / chatOfSession……）与发送无关。
 */
export const GOVERNED_HUB_METHODS = new Set(['sendText', 'sendSegments', 'sendImage', 'sendFile', 'sendVoiceFile', 'deliver'])

/**
 * 允许声明「回合内提示」的模块（宿主侧白名单，模块自己声明不到）。
 *
 * 只有这类模块的发送才**可能**在回合内直发：它们发的是「我这就去做」的进度提示，
 * 与正在进行的回合是同一件事，走代发决断反而会被慢工具兜底抢先、导致同一句发两遍。
 * 其余模块（抖音日报、RSS、主动私聊等）无论何时都照旧走代发决断——闸门管的是「谁在说」。
 */
export const TURN_NOTICE_MODULES = new Set(['imagegen'])

/**
 * 按方法名把一次 scopedHub 调用翻译成「治理问题 + 真正执行」。
 * 返回 null 表示这个方法不走治理（按原样转发）。
 *
 * 说明：每个分支的 ask 只取发送目标与文本，**身份一律由宿主绑定的 id 决定**，
 * 模块即使在自己参数里塞 moduleId / sourceModule 也覆盖不了（防止冒充别的模块）。
 */
export function governScopedCall(core, id, name, args, log) {
  const [chatId, a, b, c] = args
  // 回合内提示的声明：模块只能在 opts 里写 `turnNotice: true`（第 6 个参数对 sendText、第 4 个对
  // sendSegments、第 5 个对 sendImage……统一从「最后一个对象参数」里取）。是否真的放行由
  // governedSend 结合 TURN_NOTICE_MODULES 与 turnRunning 三重判定，模块单方面声明无效。
  const optsOf = (...idxs) => { for (const i of idxs) { const v = args[i]; if (v && typeof v === 'object') return v } return null }
  const turnNotice = (opts) => Boolean(opts && opts.turnNotice === true)
  switch (name) {
    case 'sendText':
      // sendText(chatId, text, replyId, missed, userId, opts)
      return governedSend(core, id, { chatId, text: a, turnNotice: turnNotice(optsOf(5)) }, (extra) => {
        const last = args[5]
        const opts = last && typeof last === 'object' ? { ...last, ...extra } : extra
        return core.hub.sendText(chatId, a, args[2], args[3], args[4], opts)
      }, log)
    case 'sendSegments':
      // sendSegments(chatId, segments, note, opts)
      return governedSend(core, id, { chatId, text: '', turnNotice: turnNotice(optsOf(3)) }, (extra) => {
        const last = args[3]
        const opts = last && typeof last === 'object' ? { ...last, ...extra } : extra
        return core.hub.sendSegments(chatId, a, b, opts)
      }, log)
    case 'sendImage':
      // sendImage(chatId, src, replyId, userId, opts)
      return governedSend(core, id, { chatId, turnNotice: turnNotice(optsOf(4)) }, (extra) => {
        const last = args[4]
        const opts = last && typeof last === 'object' ? { ...last, ...extra } : extra
        return core.hub.sendImage(chatId, a, args[2], args[3], opts)
      }, log)
    case 'sendFile':
      // sendFile(chatId, file, name)
      return governedSend(core, id, { chatId }, () => core.hub.sendFile(chatId, a, b), log)
    case 'sendVoiceFile':
      // sendVoiceFile(chatId, file, note)
      return governedSend(core, id, { chatId }, () => core.hub.sendVoiceFile(chatId, a, b), log)
    case 'deliver': {
      // deliver(chatId, text, opts)：第三个参数是 b，不能丢掉 voice / enginePolicy 等发送选项
      const opts = b && typeof b === 'object' ? b : {}
      if (opts.enginePolicy) return core.hub.deliver(chatId, a, opts)
      return governedSend(core, id, { chatId, text: a, turnNotice: turnNotice(opts) }, (extra) => core.hub.deliver(chatId, a, { ...opts, ...extra }), log)
    }
    default:
      return null
  }
}

/**
 * 给单个模块的 core：hub 下发「白名单副本」，原始委派入口不下发、也不可经原型链摸回（三审 #177）。
 * - scopedHub：平面对象，只转发 hub 的函数/取值器（跳过原始 runSubagentTurn / subagentFor），
 *   再补一个固定模块 id 的 runSubagentTurn；原型就是 Object.prototype，没有可逃逸的入口。
 * - 6 个发送函数额外过一层出站治理（moduleId 由宿主绑定，模块伪造不了；未注入服务时完全惰性）。
 * - scopedCore：Proxy 转发 core 的其余属性（bridge / modules 后挂的也可见），
 *   但 getPrototypeOf 掐成 null —— Object.getPrototypeOf(api.core).hub 也绕不回去。
 */
export function scopeCoreForModule(core, id, setCoreConfig, compat = null) {
  if (!core || !core.hub || typeof core.hub.subagentFor !== 'function') {
    return setCoreConfig ? { ...core, setConfig: setCoreConfig } : core || {}
  }
  const obLog = outboundLogOf(core)
  const scopedHub = {}
  for (const name of Object.getOwnPropertyNames(core.hub)) {
    if (name === 'runSubagentTurn' || name === 'subagentFor') continue
    const d = Object.getOwnPropertyDescriptor(core.hub, name)
    if (!d) continue
    if (typeof d.get === 'function') {
      Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, get: () => core.hub[name] })
    } else if (typeof d.value === 'function') {
      const fn = d.value
      // 发送类入口走治理：拦下返回 null，放行才真的调 hub（旧真值语义不变）
      if (GOVERNED_HUB_METHODS.has(name)) {
        Object.defineProperty(scopedHub, name, {
          enumerable: true, configurable: true,
          value: (...args) => governScopedCall(core, id, name, args, obLog),
        })
      } else {
        Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, value: (...args) => fn.apply(core.hub, args) })
      }
    } else {
      Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, get: () => core.hub[name], set: (v) => { core.hub[name] = v } })
    }
  }
  Object.defineProperty(scopedHub, 'runSubagentTurn', {
    enumerable: true, configurable: true,
    value: (name, title, prompt, opts = {}) => core.hub.subagentFor(id)(name, title, prompt, opts),
  })
  return new Proxy(core, {
    get(target, key, recv) {
      if (key === 'hub') return scopedHub
      if (key === 'setConfig' && setCoreConfig) return setCoreConfig
      if (key === 'personaMemoryBridge') return id === PERSONA_MEMORY_MODULE ? compat?.personaMemoryBridge : undefined
      // 出站治理服务不下发给模块：模块能拿到原始 svc 就能自己填 moduleId 冒充别人，
      // 也会绕过 api.proactive 的身份绑定。模块只能走 api.proactive（见 makeApi）。
      if (key === 'outbound') return undefined
      return Reflect.get(target, key, recv)
    },
    getPrototypeOf() { return null }, // 摸原型拿回原始 hub 的路也堵死（三审 #177）
  })
}
