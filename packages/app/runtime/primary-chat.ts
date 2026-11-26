import { createHub } from '../../modules/chat-bridge/qq/index.ts'
import { commandList, parseCommand, runCommand } from '../../modules/commands/dispatch.ts'
import {
  canUseDelegatedCommand,
  delegatedCommandKey,
} from '../../../src/chat/policy/rules/delegation.ts'
import { defaultModel, modelReasoning } from '../../../src/core/llm/index.ts'
import { defaultOneBotId } from '../onebot.ts'

export function createPrimaryChat({
  local,
  ctx,
  getConfig,
  setConfig,
  logger,
  onebot,
  outbox,
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
    const target = id ? { platform: 'qq', botId: defaultOneBotId, type: chat.kind, id: String(id) } : undefined
    return { ...where, target, primaryChat: true }
  }
  const hub = createHub({
    localApi: local,
    dsh: ctx,
    getConfig,
    log: logger.child('chat'),
    onebot,
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
      message: (msg) => modules().claim('onebot/message', msg),
      reply: (text, info) => modules().filter('reply', text, info),
      secrets: () => [],
      deniedTools: () => deniedTools(),
      groupDecide: (decision, info) => modules().filter('group/decide', decision, info),
      prompt: (content, info) => modules().filter('prompt', content, primaryContext(info)),
      items: (items, info) => modules().filter('reply/items', items, info),
      send: (message, info) => modules().filter('onebot/before-send', message, info),
      model: (sel, chat) => {
        const { target } = primaryContext({ chat })
        const self = onebot.bot?.selfId
        const choice = target && self && modules().services.get('llm')?.config?.model.get(target, self)
        return modules().filterSync('model', choice || sel, chat)
      },
      poke: (ev) => modules().claim('poke', ev),
      journal: (row) => modules()?.emit('chat/log', row),
      deliveryScope: (chatId, personaId, botQQ) =>
        onebot.verified && onebot.login.uin === botQQ
          ? personaMemoryRuntime.captureDelivery(chatId, personaId, botQQ)
          : null,
      delivery: personaMemoryRuntime.confirmDelivery,
    },
  })
  return hub
}
