import { botApiStubs } from '../../src/core/bot/index.ts'
import type { AdapterRegistry } from '../../src/core/bot/adapter/registry.ts'
import type { BotLike } from '../../src/types/adapter/bot.ts'
import type { InboundMessage } from '../../src/types/adapter/adapter.ts'
import type { Pipeline, PipelineResult } from '../../src/core/pipeline/index.ts'
import { Session } from '../../src/core/pipeline/session.ts'
import type { createHttp } from './http.ts'
import { defaultOneBotId } from './onebot.ts'

function debugBot(platform: string) {
  const sent: Array<{ method: string; target: string; content: unknown }> = []
  const stub: BotLike = {
    ...botApiStubs(`${platform}:debug`),
    id: `${platform}:debug`,
    platform,
    selfId: 'debug',
    status: 'online',
    supports: () => true,
    async sendMessage(channelId: string, content: unknown) {
      sent.push({ method: 'sendMessage', target: String(channelId), content })
      return { ok: true, message_id: `debug-${sent.length}` }
    },
    async sendPrivateMessage(userId: string, content: unknown) {
      sent.push({ method: 'sendPrivateMessage', target: String(userId), content })
      return { ok: true, message_id: `debug-${sent.length}` }
    },
  }
  return { stub, sent }
}

export function registerDebugRoutes(
  { route, readBody }: Pick<ReturnType<typeof createHttp>, 'route' | 'readBody'>,
  pipeline: Pipeline, adapterRegistry: AdapterRegistry,
  dispatchInbound: (bot: BotLike, message: InboundMessage) => Promise<PipelineResult> | undefined,
) {
  route('/debug/dispatch', async (req) => {
    const b = await readBody(req)
    const text = String(b.text || '')
    if (!text.trim()) return { ok: false, message: 'text 不能为空' }
    const type = b.type === 'private' ? 'private' : 'group'
    const userId = String(b.userId || 'debug')
    const platform = String(b.platform || 'qq')
    const { stub, sent } = debugBot(platform)
    const bot = adapterRegistry.get(String(b.botId || defaultOneBotId), platform) ?? stub
    const session = new Session({
      bot,
      type,
      channelId: type === 'private' ? userId : String(b.chatId || 'debug'),
      userId,
      userName: String(b.userName || '调试'),
      content: text,
      pipeline,
    })
    const result = await pipeline.dispatch(session)
    let value
    try {
      value = result.value === undefined ? null : JSON.parse(JSON.stringify(result.value))
    } catch {
      value = String(result.value)
    }
    return { ok: true, sent, order: pipeline.order(), result: { handled: result.handled, by: result.by, error: result.error ?? null, value } }
  })

  route('/debug/adapter', async (req) => {
    const body = await readBody(req)
    const text = String(body.text || '')
    if (!text.trim()) return { ok: false, message: 'text 不能为空' }
    const platform = String(body.platform || 'satori')
    const { stub, sent } = debugBot(platform)
    const bot = adapterRegistry.get(String(body.botId || ''), platform) ?? stub
    const type = body.type === 'channel' ? 'channel' : body.type === 'private' ? 'private' : 'group'
    const userId = String(body.userId || 'debug-user')
    const result = await dispatchInbound(bot, {
      type,
      channelId: String(body.channelId || (type === 'private' ? userId : 'debug-channel')),
      userId,
      userName: String(body.userName || '调试用户'),
      content: text,
    })
    return {
      ok: true,
      platform,
      order: pipeline.order(),
      bot: { id: bot.id, platform: bot.platform, registered: bot !== stub },
      sent,
      result: result
        ? { handled: result.handled, by: result.by, error: result.error ?? null }
        : { handled: false, by: null, error: null },
    }
  })
}
