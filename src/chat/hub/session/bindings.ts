import { type MountedRec, sessionKey } from '../context/context.ts'
import { parseReply } from '../../reply/index.ts'
import { preserveReplyStickers } from '../../policy/rules/sticker.ts'
import { markerApplies, markerInstruction } from '../../reply/context/reply-marker.ts'
import { codeFenceInstruction } from '../../inbound/hooks/guard.ts'
import { cleanText } from '../../../core/support/util/text.ts'
import { currentPromptSources } from '../../../security/leak-guard.ts'

export function createSessionBindings({
  log,
  getConfig,
  random,
  outbound,
  cleaningFor,
  assertActive,
  buildTools,
  hooks,
  toolsGeneration,
  turnState,
  turnGuard,
  isDisposed,
  contextProviders,
  sourcesFor,
  outputSources,
}) {
  const { running, groupChatAllowed } = turnGuard
  const { sendText, sendSticker } = outbound

  const mounted = new Map<string, MountedRec>()

  const GROUP_GUEST_SAFE = [
    /^ask_user_question$/,
    /^present$/,
    /^skill$/,
    /^todo_write$/,
    /^recall_memory$/,
    /^unlag_refresh$/,
    /^mcp_probe$/,
    /^list_mcp_resource/,
    /^read_mcp_resource$/,
    /^web_search$/,
    /^mcp__Akasha/,
  ]

  const groupGates = new Map()

  function knownGlobalNames(agent) {
    try {
      const off = agent.ctx.tools.restrict({ deny: ['aurabot__probe__'] })
      if (typeof off === 'function') off()
      return null
    } catch (error) {
      const m = /known global tools?\s*[:：]\s*([^]*)$/.exec(String((error && error.message) || ''))
      if (!m) return null
      return m[1]
        .split(',')
        .map((n) => n.trim().replace(/^"|"$/g, ''))
        .filter((n) => n && n !== '(none)')
    }
  }

  function restrictGuest(agent) {
    const known = knownGlobalNames(agent)

    const allow = known ? known.filter((name) => GROUP_GUEST_SAFE.some((re) => re.test(name))) : []
    return agent.ctx.tools.restrict({ allow })
  }

  function applyGroupGate(key, allow) {
    const g = groupGates.get(key)
    if (!g) return
    try {
      if (allow) {
        if (g.off) {
          g.off()
          g.off = null
          log.info(`${key.slice(-8)}：本机工具放开（这一轮是主人）`)
        }
      } else if (!g.off) {
        g.off = restrictGuest(g.agent)
        log.info(`${key.slice(-8)}：本机工具收起（这一轮不是主人）`)
      }
    } catch (error) {
      log.warn('群聊工具闸切换失败：', error.message)
    }
  }

  const mounts = new Set<MountedRec>()

  const toolDisposers = new Map()

  const slowNoticeSent = new Set()

  const slowTimers = new Map<NodeJS.Timeout, string>()

  function clearSlowNotices(key?: string) {
    for (const [timer, sid] of slowTimers) {
      if (key !== undefined && sid !== key) continue
      clearTimeout(timer)
      slowTimers.delete(timer)
    }
  }

  function unmount(rec) {
    mounts.delete(rec)
    for (const [k, g] of groupGates) {
      if (g.agent !== rec.agent) continue
      try {
        if (typeof g.off === 'function') g.off()
      } catch (error) {}
      groupGates.delete(k)
    }
    for (const off of rec.offs.splice(0).reverse()) {
      try {
        if (typeof off === 'function') off()
      } catch (error) {
        log.warn('注销会话挂载失败：', error.message)
      }
    }
  }

  async function sendSlowNotice(chatId, text, isCurrent) {
    const parsed = parseReply(text, cleaningFor(chatId))
    if (parsed.silent) return
    const cfg = getConfig()
    const items =
      cfg.stickers.limitTagged &&
      parsed.items.some((i) => i.kind === 'sticker') &&
      !(cfg.stickers.keywordExemption && preserveReplyStickers(parsed.items)) &&
      random() >= cfg.stickers.autoChance
        ? parsed.items.filter((i) => i.kind !== 'sticker')
        : parsed.items
    for (const item of items) {
      if (!isCurrent()) return
      if (item.kind === 'text') {
        await sendText(chatId, item.value, undefined, [], undefined, { isCurrent })
      } else if (item.kind === 'sticker') {
        await sendSticker(chatId, item.value)
      }
    }
  }

  function mount(agent, chat, level) {
    assertActive()
    const sid = sessionKey(agent.session?.id ?? agent.id)
    const tools =
      level !== 'chat' && typeof buildTools === 'function' ? buildTools({ chat, level, sessionId: sid }) : []
    const denied = (() => {
      try {
        return hooks?.deniedTools?.() || []
      } catch (error) {
        return []
      }
    })()

    let gen = 0
    try {
      gen = typeof toolsGeneration === 'function' ? Number(toolsGeneration()) || 0 : 0
    } catch (error) {
      gen = 0
    }
    const toolsKey =
      tools
        .map((t) => t.name)
        .sort()
        .join(',') +
      '|' +
      denied.join(',') +
      '|gen:' +
      gen
    const prev = mounted.get(sid)

    if (prev && prev.agent === agent && prev.chatId === chat.chatId && prev.toolsKey === toolsKey) return
    if (prev) unmount(prev)
    const offs = []

    if (denied.length) {
      try {
        offs.push(agent.ctx.tools.restrict({ deny: denied }))
      } catch (error) {
        log.debug('屏蔽联动工具：', error.message)
      }
    }
    {
      for (const tool of tools) {
        try {
          let reg = tool
          if (tool.slow) {
            const { slow, ...base } = tool
            const fixedNotice = typeof slow === 'string' ? slow : ''
            reg = {
              ...base,
              async execute(args, exec) {
                let fired = false
                const incomingReply = Boolean(turnState.get(sid)?.turnToken)
                const isCurrent = () =>
                  !isDisposed() &&
                  running.has(chat.chatId) &&
                  (!incomingReply || groupChatAllowed(chat.chatId))
                const timer = setTimeout(() => {
                  slowTimers.delete(timer)
                  if (fired) return
                  fired = true
                  if (!isCurrent()) return
                  if (slowNoticeSent.has(sid)) return
                  const state = turnState.get(sid)
                  const said = fixedNotice || String(state?.toolText || state?.text || '').trim()
                  if (!said) return
                  slowNoticeSent.add(sid)
                  if (!fixedNotice && state) {
                    state.toolText = ''
                    state.text = ''
                  } // 已经提前发了，turn/end 不再重复
                  sendSlowNotice(chat.chatId, said, isCurrent).catch((error) =>
                    log.debug('慢工具提示没发出去：', error.message),
                  )
                }, 1500)
                slowTimers.set(timer, sid)
                timer.unref?.()
                try {
                  return await tool.execute(args, exec)
                } finally {
                  clearTimeout(timer)
                  slowTimers.delete(timer)
                }
              },
            }
          }

          const dkey = sid + '|' + tool.name
          const stale = toolDisposers.get(dkey)
          if (stale) {
            try {
              stale()
            } catch (error) {}
            toolDisposers.delete(dkey)
          }
          const off = agent.ctx.tools.register(reg)
          toolDisposers.set(dkey, off)
          offs.push(() => {
            toolDisposers.delete(dkey)
            try {
              off()
            } catch (error) {}
          })
        } catch (error) {
          log.warn(`工具 ${tool.name} 挂不上：`, error.message)
        }
      }
    }
    try {
      offs.push(
        agent.ctx.systemPrompt.context({
          name: 'aurabot-context',
          order: 905,
          text: () => {
            const parts = []

            try {
              if (markerApplies(getConfig(), chat && chat.chatId)) parts.push(markerInstruction())

              if (getConfig().chat?.thinkingGuard?.enabled !== false) parts.push(codeFenceInstruction())
            } catch (error) {}
            for (const p of contextProviders || []) {
              try {
                const t = p({ chat, sessionId: sid })
                if (t) parts.push(t)
              } catch (error) {}
            }
            const text = cleanText(parts.join('\n\n'))
            const active = currentPromptSources()
            const sources = active?.chatId === chat.chatId ? active : sourcesFor(chat.chatId)
            sources.context = text
            outputSources.set(chat.chatId, sources)
            return text
          },
        }),
      )
    } catch (error) {
      log.debug('挂上下文失败：', error.message)
    }
    if (chat.kind === 'group' && level === 'group-full') {
      groupGates.set(sid, { agent, off: null })
      applyGroupGate(sid, false)
    }
    const rec = { agent, chat, level, chatId: chat.chatId, offs, toolsKey }
    mounted.set(sid, rec)
    mounts.add(rec)
  }

  function remountAll(reason = '') {
    if (isDisposed()) return 0
    let n = 0
    for (const rec of [...mounts]) {
      if (!rec || !rec.agent || !rec.chat) continue
      try {
        mount(rec.agent, rec.chat, rec.level)
        n++
      } catch (error) {
        log.warn('重挂工具失败：', error.message)
      }
    }
    if (n && reason) log.info(`重新挂了 ${n} 个会话的工具（${reason}）`)
    return n
  }
  function dispose() {
    clearSlowNotices()
    slowNoticeSent.clear()
    for (const record of [...mounts]) unmount(record)
    mounted.clear()
    toolDisposers.clear()
  }
  return { mount, unmount, remountAll, mounted, applyGroupGate, clearSlowNotices, slowNoticeSent, dispose }
}
