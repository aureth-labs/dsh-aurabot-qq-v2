import { createHub } from '../../modules/chat-bridge/qq/index.ts'
import { commandList, parseCommand, runCommand } from '../../modules/commands/dispatch.ts'
import {
  canUseDelegatedCommand,
  delegatedCommandKey,
} from '../../../src/chat/policy/rules/delegation.ts'
import { defaultModel, modelReasoning } from '../../../src/core/llm/index.ts'
import { privateCapabilityAllowed } from '../../../src/chat/policy/rules/access.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import { isLegacyScope, roomKey, roomOf } from '../../../src/core/bot/room.ts'

export function createChatHub({
  bot,
  primary,
  outbox,
  local,
  ctx,
  getConfig,
  setConfig,
  logger,
  onebot,
  stickers,
  tts,
  modules,
  generate,
  use,
  mutes,
  listModels,
  models,
  deniedTools,
  personaMemoryRuntime,
}) {
  const primaryContext = where => {
    const chat = where.chat
    const id = chat?.kind === 'private' ? chat.userId : chat?.kind === 'group' ? chat.groupId : ''
    const account: BotLike = bot()
    const target = id && account ? { platform: account.platform, botId: account.id, type: chat.kind, id: String(id) } : undefined
    return {
      ...where, target, primaryChat: true,
      actors: () => hub.turnSenders(where.sessionId),
      delegated: capability => privateCapabilityAllowed(getConfig(), chat, capability),
    }
  }
  const hub = createHub({
    scope: { platform: bot()?.platform, botId: bot()?.id },
    localApi: local,
    dsh: ctx,
    getConfig,
    log: logger.child('chat'),
    bot,
    outbox,
    stickers,
    tts,
    asr: () => modules()?.services?.get?.('asr') ?? null,
    askModel: generate,
    buildTools: where => modules().buildTools(primaryContext(where)),
    capabilitiesOf: (id) =>
      typeof modules().capabilitiesOf === 'function' ? modules().capabilitiesOf(id) : [],
    contextProviders: [(args) => modules().contextFor(primaryContext(args))],
    onActivity: (a) => modules().emit('activity', a),
    memoryScore: (text) => use('memory')?.topicScore?.(text) ?? 0,
    dislikes: (qq) => use('memory')?.dislikes?.(qq) ?? false,
    onMemoryCommand: (msg, text) => use('memory')?.handleCommand?.(msg, text),
    onCommand: async (msg, markSensitive, ownerStillCurrent) => {
      const commands = modules().commands()
      const cmd = parseCommand(msg.text, commands)
      if (!cmd) return null
      if (!cmd.ext && !use('commands')) return null
      if (!ownerStillCurrent()) {
        const key = delegatedCommandKey(cmd)
        if (!canUseDelegatedCommand(getConfig(), msg, key))
          return '你没有使用这个命令的权限，请联系主人设置。'
        if (key === 'help') {
          const list = commandList(commands).filter((item) =>
            canUseDelegatedCommand(
              getConfig(),
              msg,
              delegatedCommandKey(parseCommand('/' + item.name, commands)),
            ),
          )
          return (
            '你可以使用的命令：\n' +
            list
              .map((item) => {
                const desc = item.name === 'model' ? '查看或切换当前私聊模型' : item.desc
                return `/${item.name}  ${desc}`
              })
              .join('\n')
          )
        }
      }
      if (cmd.ext) {
        if (cmd.ext.sensitive === true && !markSensitive(cmd.name)) return ''
        return String((await cmd.ext.run(cmd.arg, msg)) ?? '')
      }
      if (['permissions', 'groupsettings'].includes(cmd.name) && !markSensitive(cmd.name)) return ''
      return runCommand(cmd, msg, {
        getConfig,
        setConfig,
        mutes,
        hub,
        onebot,
        ownerStillCurrent,
        log: logger,
        mood: use('mood'),
        memory: use('memory'),
        song: use('song'),
        listModels,
        reasoningFor: (provider, model) => modelReasoning(ctx, provider, model, { refresh: true }),
        defaultModel: () => defaultModel(ctx, { model: {} }),
        extraCommands: modules().commands(),
      })
    },
    isMuted: (chatId) => mutes.muted(chatId),
    moodEffects: () => use('mood')?.effects?.() ?? null,
    availableModels: models,
    toolsGeneration: () => (modules() ? modules().generation?.() || 0 : 0),
    hooks: {
      media: primary ? () => modules()?.services.get('primary-chat-media')?.current() : undefined,
      message: (msg) => modules().claim('chat/message', msg),
      reply: (text, info) => modules().filter('reply', text, info),
      secrets: () => [],
      deniedTools: () => deniedTools(),
      groupDecide: (decision, info) => modules().filter('group/decide', decision, info),
      prompt: (content, info) => modules().filter('prompt', content, primaryContext(info)),
      items: (items, info) => modules().filter('reply/items', items, info),
      send: (message, info) => modules().filter('chat/before-send', message, info),
      model: (sel, chat) => {
        const { target } = primaryContext({ chat })
        const self = bot()?.selfId
        const choice = target && self && modules().services.get('llm')?.config?.model.get(target, self)
        return modules().filterSync('model', choice || sel, chat)
      },
      poke: (ev) => modules().claim('poke', ev),
      journal: (row) => modules()?.emit('chat/log', row),
      deliveryScope: (chatId, personaId, botQQ) =>
        primary && onebot.verified && onebot.login.uin === botQQ
          ? personaMemoryRuntime.captureDelivery(chatId, personaId, botQQ)
          : null,
      delivery: personaMemoryRuntime.confirmDelivery,
    },
  })
  return hub
}

const BY_ROOM = new Set([
  'cleanOutbound', 'recentMedia', 'recentImages', 'stickerElement', 'recentFiles', 'stickerOf', 'deliver', 'sendText',
  'sendVoice', 'sendVoiceFile', 'sendFile', 'sendSticker', 'sendImage', 'sendSegments', 'noteProactive', 'runTurnInChat',
  'chatCooldown', 'turnRunning', 'resetChat', 'recentMessagesOf', 'logChat', 'noteSaid', 'saidElsewhereOf', 'proactiveHistoryOf',
  'recallQuote',
])
const BY_SESSION = new Set([
  'turnSendersAllOwner', 'turnDirectFromOwner', 'markSlowNotice', 'turnHasOwner', 'turnSenders', 'chatOfSession', 'personaOf',
  'isOwnedSession', 'lastTextOf', 'prevTextOf', 'speakersOf', 'subagentFor',
])
const BY_CHAT = new Set(['referenceImage', 'pushToSession', 'modelFor'])
const BROADCAST = new Set(['remountAll', 'resetPersonChat', 'resetSessions', 'refreshFriends', 'setOutboundGuard', 'setOutboundEngineResolver'])

export function createChatEngines({ registry, primaryId, create, log }) {
  const hubs = new Map<string, any>()
  const keyOf = (bot: BotLike) => bot.platform + '/' + bot.id
  const primaryBot = () => registry.get(primaryId, 'qq')
  let primary
  function hubFor(bot: BotLike | undefined) {
    if (!bot || (bot.platform === 'qq' && bot.id === primaryId)) return primary
    const key = keyOf(bot)
    let hub = hubs.get(key)
    if (!hub) {
      hub = create(() => registry.get(bot.id, bot.platform), false)
      hubs.set(key, hub)
      log.info(`对话引擎接入 ${bot.platform}/${bot.id}`)
    }
    return hub
  }
  const all = () => [primary, ...hubs.values()]
  function ofRoom(chatId) {
    const room = roomOf(chatId)
    if (!room?.platform || isLegacyScope(room.platform, room.botId)) return primary
    return hubs.get(room.platform + '/' + room.botId) ?? hubFor(registry.get(room.botId, room.platform))
  }
  const ofSession = (sessionId) => all().find(hub => {
    try { return Boolean(hub.chatOfSession(sessionId)) } catch { return false }
  }) ?? primary
  const ofChat = (chat) => ofRoom(typeof chat === 'string' ? chat : chat?.chatId)
  primary = create(primaryBot, true)
  const router = new Proxy(primary, {
    get(target, prop, receiver) {
      const name = String(prop)
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (BY_ROOM.has(name)) return (chatId, ...rest) => ofRoom(chatId)[name](chatId, ...rest)
      if (BY_SESSION.has(name)) return (sessionId, ...rest) => ofSession(sessionId)[name](sessionId, ...rest)
      if (BY_CHAT.has(name)) return (chat, ...rest) => ofChat(chat)[name](chat, ...rest)
      if (BROADCAST.has(name)) return (...args) => { let out; for (const hub of all()) out = hub[name](...args); return out }
      if (name === 'onSessionEvent') return (session, event) => { for (const hub of all()) hub.onSessionEvent(session, event) }
      if (name === 'onMessage') return (session, deleted) => hubFor(session.bot).onMessage(session, deleted)
      if (name === 'onNotice') return (bot, notice) => hubFor(bot).onNotice(notice)
      if (name === 'busy') return () => all().some(hub => hub.busy())
      if (name === 'dispose') return () => { for (const hub of all()) hub.dispose(); hubs.clear() }
      return value.bind(target)
    },
  })
  const day = (offset: number) => {
    const d = new Date(Date.now() - offset * 86400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const timeline = {
    enabled: () => true,
    read(target, selfId, persona) {
      const room = roomKey(target)
      const hub = ofRoom(room)
      const rows = [1, 0].flatMap(n => hub.chatLogOf(day(n), persona || undefined)).filter(row => row.chatId === room && row.text)
      const messages = rows.slice(-40).map(row => ({
        role: row.who === 'bot' || row.uid === selfId ? 'assistant' : 'user', speaker: row.who === 'bot' ? '' : String(row.who || row.uid || ''),
        text: String(row.text), at: Number(row.t) || undefined,
      }))
      return { room, busy: hub.turnRunning(room), revision: hub.chatLogRevision(), messages }
    },
    record(target, selfId, persona, line) {
      const room = roomKey(target)
      ofRoom(room).logChat(room, line.role === 'assistant' ? 'bot' : line.speaker, line.text, line.role === 'assistant' ? selfId : '', { at: line.at })
    },
  }
  return { router, hubFor, ofRoom, timeline, list: () => all() }
}
