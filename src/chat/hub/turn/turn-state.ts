// 轮次共享状态与守卫：谁在忙、这一轮还作不作数、卡住多久算超时。
// 队列内容本身留在 hub/index.ts，这里只提供状态与判定。

import { sessionKey } from '../context/context.ts'
import { levelFor, presetFor, groupResponseMode } from '../../policy/rules/access.ts'

export interface TurnStateDeps {
  [key: string]: any
}

export function createTurnState(deps: TurnStateDeps) {
  const { getConfig, log, map, assertActive } = deps

  const pending = new Map() // chatId → { chat, texts, images, senders, wantVoice, timer, firstAt, mode, count }
  const busy = new Map() // chatId → 这一轮开始的时间（她正在想 / 正在发）
  const BUSY_MAX_MS = 4 * 60_000 // 卡住保护：超过这么久就当她已经回完了
  const RANK = { engaged: 1, interject: 2, must: 3 }
  const busySessions = new Map() // chatId → 正在计算 / 投递的 sessionKey
  const busyTurns = new Map() // chatId → 本次提交的占位 token
  const running = new Map() // chatId → 仍在模型 / 工具阶段的 sessionKey
  function turnSignature(chatId) {
    const cfg = getConfig()
    const [kind, id] = chatId.split(':')
    const level = levelFor(cfg, { kind, userId: kind === 'private' ? id : '', groupId: kind === 'group' ? id : '' })
    return `${cfg.debug ? 'debug' : 'live'}:${level}:${presetFor(level, cfg)}`
  }
  function isCurrentSession(chatId, key) {
    const cfg = getConfig()
    const cur = map().chats[chatId]
    if (!cur || sessionKey(cur.sessionId) !== key || (cur.mode || 'live') !== (cfg.debug ? 'debug' : 'live')) return false
    const [kind, id] = chatId.split(':')
    if (kind === 'private' || kind === 'group') {
      const chat = { kind, userId: kind === 'private' ? id : '', groupId: kind === 'group' ? id : '' }
      const level = levelFor(cfg, chat)
      if (cur.level !== level || cur.preset !== presetFor(level, cfg)) return false
    }
    return true
  }
  function groupChatAllowed(chatId) {
    return !chatId.startsWith('group:') || groupResponseMode(getConfig(), chatId.slice(6)) === 'chat'
  }
  function checkTurn(chatId, token) {
    assertActive()
    if (token && (!groupChatAllowed(chatId) || busyTurns.get(chatId) !== token || token.signature !== turnSignature(chatId))) {
      throw new Error('会话模式已切换，取消旧轮次提交')
    }
  }
  const isBusy = (chatId) => {
    if (!busy.has(chatId)) return false
    const token = busyTurns.get(chatId)
    if (token && token.signature !== turnSignature(chatId)) return false
    const key = busySessions.get(chatId)
    if (key && !isCurrentSession(chatId, key)) return false
    return (key && running.get(chatId) === key) || Date.now() - busy.get(chatId) < BUSY_MAX_MS
  }
  // 轮次兜底：模型或工具卡住时 turn/end 永远不来，running 一直挂着，后面的私聊消息全被当成 steer 塞进那一轮，
  // 看上去就是「不理人」。超过上限就按 key 比对后强制放开，让下一条消息正常开新一轮。
  const runningTimers = new Map() // chatId → timer
  // 返回兜底时长（毫秒）：0 表示关掉兜底（不设定时器），没配或非法值按默认 30 分钟
  const turnMaxMs = () => {
    const mins = Number(getConfig()?.chat?.turnTimeoutMinutes)
    if (!Number.isFinite(mins)) return 30 * 60_000
    if (mins <= 0) return 0
    return mins * 60_000
  }
  function markRunning(chatId, key?) {
    if (key) running.set(chatId, key)
    const old = runningTimers.get(chatId)
    if (old) { clearTimeout(old); runningTimers.delete(chatId) }
    const limit = turnMaxMs()
    if (!limit) return // 0 = 关掉兜底，不设定时器
    const timer = setTimeout(() => {
      // 只放开卡住的那一轮：running 里已经换成别的 key 就说明新轮次在跑，别误伤
      if (!key || running.get(chatId) !== key) return
      running.delete(chatId)
      runningTimers.delete(chatId)
      log.warn(`${chatId}：这一轮超过 ${Math.round(limit / 60000)} 分钟没结束，强制放开（后面的消息不会再被塞进卡住的轮次）`)
    }, limit)
    timer.unref?.()
    runningTimers.set(chatId, timer)
  }
  function clearRunning(chatId, key?) {
    if (key && running.get(chatId) !== key) return
    running.delete(chatId)
    const timer = runningTimers.get(chatId)
    if (timer) { clearTimeout(timer); runningTimers.delete(chatId) }
  }


  return {
    pending, busy, busySessions, busyTurns, running, runningTimers, BUSY_MAX_MS, RANK,
    turnSignature, isCurrentSession, groupChatAllowed, checkTurn, isBusy, turnMaxMs, markRunning, clearRunning,
  }
}
