import { isDeepStrictEqual } from 'node:util'
import { h, isElement, normalize, toText } from '../../../src/core/message/element/element.ts'
import type { createSendEvents } from '../../../src/core/bot/send-events.ts'
import { platformNotice } from '../../../src/core/pipeline/notice.ts'
import { dataDir, ensureDir } from '../../../src/core/store/index.ts'
import { createQuoteHistory, type MessageDeletion } from '../../../src/core/pipeline/quotes.ts'
import { AdapterRegistry } from '../../../src/core/bot/adapter/registry.ts'
import { wrapAdapterBot } from '../../../src/core/bot/instance/bot.ts'
import { BotRegistry } from '../../../src/core/bot/instance/registry.ts'
import { Pipeline } from '../../../src/core/pipeline/index.ts'
import { inboundSession } from '../../../src/core/pipeline/session.ts'
import { personaNow, personaScope } from '../../../src/persona/personas.ts'
import type { InboundMessage } from '../../../src/types/adapter/adapter.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import type { LlmHandler } from '../../../src/types/plugin/pipeline.ts'
import type { AurabotConfig } from '../../../src/core/config/shape/defaults.ts'
import type { AreaLogger } from '../../../src/core/support/log/logger.ts'

interface TransportOptions {
  getConfig(): AurabotConfig
  log: AreaLogger
  speak(text: string): Promise<string>
  emit(event: string, payload: unknown): void
  hasListeners(event: string): boolean
  emitAsync(event: string, data: unknown): Promise<void>
  sendEvents: ReturnType<typeof createSendEvents>
  beforeMessage(bot: BotLike, message: InboundMessage): unknown
  beforeEvent(event: string, payload: unknown, bot: BotLike): void
  respond: LlmHandler
}

export function createTransport({
  getConfig,
  log,
  speak,
  emit,
  beforeMessage, hasListeners, emitAsync, sendEvents,
  beforeEvent,
  respond,
}: TransportOptions) {
  let closed = false
  const quotes = createQuoteHistory(() => { ensureDir(dataDir()); return dataDir('quotes.db') })
  const config = getConfig()
  const pipeline = new Pipeline({
    commandPrefixes: config.commandPrefixes ?? [null, '/'],
    middlewareAfterCommand: config.middlewareAfterCommand,
    onError: ({ stage, error }) => log.warn('管线 ' + stage + ' 出错', String(error)),
  })
  pipeline.onLlm(respond)

  async function dispatchInbound(bot: BotLike, message: InboundMessage) {
    try {
      emit('adapter/message', { ...message, platform: bot.platform, botId: bot.id })
      let reparsed = false
      if (hasListeners('before-parse')) {
        const elements = message.elements ?? (message.content ? [h.text(message.content)] : [])
        const draft = { platform: bot.platform, botId: bot.id, type: message.type, channelId: message.channelId,
          guildId: message.guildId, userId: message.userId, elements: structuredClone(elements) }
        await emitAsync('before-parse', draft)
        if (Array.isArray(draft.elements) && draft.elements.every(isElement) && !isDeepStrictEqual(elements, draft.elements)) {
          const parsed = normalize(draft.elements)
          message = { ...message, elements: parsed, content: toText(parsed) }
          reparsed = true
        }
      }
      let quote
      if (getConfig().enabled || bot.platform === 'sandbox') {
        try { quote = await quotes.receive(bot, message) }
        catch (error) { log.warn('引用记录不可用', String(error)) }
      }
      if (closed) return
      const session = inboundSession(bot, message, pipeline, quote)
      if (!session.content.trim() && !session.elements.length) return
      session.reparsed = reparsed
      const result = await personaScope.run(personaNow(getConfig()), async () => {
        if (hasListeners('message')) await emitAsync('message', session)
        if (!closed) return pipeline.dispatch(session)
      })
      if (result?.error) log.error('处理消息出错', result.by, result.error)
      return result
    } catch (error) {
      log.error('处理消息出错', String(error))
      return { handled: false, by: null, error: String(error) }
    }
  }

  const botRegistry = new BotRegistry()
  const adapterRegistry = new AdapterRegistry({
    bots: botRegistry,
    log: (message) => log.info(message),
    speak,
    onMessage(bot, message) {
      if (!beforeMessage(bot, message)) return dispatchInbound(bot, message)
    },
    onEvent(platform, event, payload, bot) {
      try {
        const notice = platformNotice(event, payload, bot)
        const detail = event === 'message-deleted' && notice?.channelId && notice.messageId
          ? { type: notice.type, channelId: notice.channelId, messageId: notice.messageId, raw: payload } : payload
        if (event === 'message-deleted') quotes.recall(bot, detail as MessageDeletion)
        beforeEvent(event, detail, bot)
        if (notice) emit(event, notice)
        emit('adapter/' + event, { platform, botId: bot.id, payload: detail })
      } catch (error) {
        log.warn('适配器事件 ' + event + ' 处理出错', String(error))
      }
    },
    wrapBot: (bot) =>
      wrapAdapterBot(bot, {
        events: sendEvents,
        allowed: () => Boolean(getConfig().enabled) || bot.platform === 'sandbox',
        log: (message) => log.info(message),
        speak,
      }),
  })
  return { botRegistry, adapterRegistry, pipeline, dispatchInbound, closeQuoteHistory() { closed = true; quotes.close() } }
}
