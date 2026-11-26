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
  beforeMessage(bot: BotLike, message: InboundMessage): unknown
  beforeEvent(event: string, payload: unknown, bot: BotLike): void
  respond: LlmHandler
}

export function createTransport({
  getConfig,
  log,
  speak,
  emit,
  beforeMessage,
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
      let quote
      if (getConfig().enabled || bot.platform === 'sandbox') {
        try { quote = await quotes.receive(bot, message) }
        catch (error) { log.warn('引用记录不可用', String(error)) }
      }
      if (closed) return
      const session = inboundSession(bot, message, pipeline, quote)
      if (!session.content.trim() && !session.elements.length) return
      const result = await personaScope.run(personaNow(getConfig()), () => pipeline.dispatch(session))
      if (result.error) log.error('处理消息出错', result.by, result.error)
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
        if (event === 'message-deleted') quotes.recall(bot, payload as MessageDeletion)
        beforeEvent(event, payload, bot)
        emit('adapter/' + event, { platform, botId: bot.id, payload })
      } catch (error) {
        log.warn('适配器事件 ' + event + ' 处理出错', String(error))
      }
    },
    wrapBot: (bot) =>
      wrapAdapterBot(bot, {
        allowed: () => Boolean(getConfig().enabled) || bot.platform === 'sandbox',
        log: (message) => log.info(message),
        speak,
      }),
  })
  return { botRegistry, adapterRegistry, pipeline, dispatchInbound, closeQuoteHistory() { closed = true; quotes.close() } }
}
