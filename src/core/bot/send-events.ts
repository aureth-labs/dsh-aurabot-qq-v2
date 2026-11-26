import { AsyncLocalStorage } from 'node:async_hooks'
import type { BotLike } from '../../types/adapter/bot.ts'
import type { Target } from '../../types/core/target.ts'
import type { SessionLike } from '../../types/core/session.ts'
import type { Element } from '../../types/core/element.ts'

export interface SendEvent {
  bot: BotLike
  platform: string
  botId: string
  type: Target['type']
  channelId?: string
  userId?: string
  target: Target
  elements: Element[]
  messageId?: string
}

type SendContext = Pick<SessionLike, 'bot' | 'platform' | 'target' | 'type' | 'channelId' | 'isPrivate'>
const current = new AsyncLocalStorage<SendContext>()
export function withSendTarget<T>(bot: BotLike, target: Target, send: () => T): T {
  return current.run({ bot, platform: target.platform, target, type: target.type,
    channelId: target.type === 'private' ? undefined : target.id, isPrivate: target.type === 'private' }, send)
}
export const withSendSession = <T>(session: SessionLike, send: () => T): T => current.run(session, send)

export function acknowledged(result: unknown): boolean {
  if (result === false || result === null) return false
  if (!result || typeof result !== 'object') return true
  const receipt = result as Record<string, unknown>
  return receipt.ok !== false && !receipt.simulated && !receipt.queued && !receipt.skipped && !receipt.cancelled
}

function messageIds(result: unknown): Array<{ id?: string; channelId?: string }> {
  if (Array.isArray(result)) return result.flatMap(messageIds)
  if (typeof result === 'string' || typeof result === 'number') return [{ id: String(result) }]
  if (!result || typeof result !== 'object') return []
  const receipt = result as { id?: unknown; message_id?: unknown; channel?: { id?: string }; channelId?: string }
  const id = receipt.id ?? receipt.message_id
  return id == null ? [] : [{ id: String(id), channelId: receipt.channel?.id ?? receipt.channelId }]
}

export function createSendEvents(claim: (event: string, data: SendEvent) => Promise<boolean>, emit: (event: string, data: SendEvent) => void) {
  return async function deliver(bot: BotLike, type: Target['type'], id: string, elements: Element[], send: () => Promise<unknown>) {
    const context = current.getStore()
    const same = context?.bot.id === bot.id && context.platform === bot.platform && context.target.id === id &&
      context.isPrivate === (type === 'private')
    const target: Target = { platform: bot.platform, botId: bot.id, id, type: same ? context.type : type }
    const data: SendEvent = { bot, target, platform: bot.platform, botId: bot.id, type: target.type,
      channelId: same ? context.channelId : type === 'private' ? undefined : id,
      userId: type === 'private' ? id : undefined, elements: structuredClone(elements) }
    if (await claim('before-send', { ...data, target: { ...target }, elements: structuredClone(data.elements) })) return { ok: false, cancelled: true }
    const result = await send()
    if (acknowledged(result)) {
      const ids = messageIds(result)
      const emitted = new Set<string>()
      for (const receipt of ids.length ? ids : [{}]) {
        const channelId = receipt.channelId ?? data.channelId
        const key = JSON.stringify([channelId, receipt.id])
        if (emitted.has(key)) continue
        emitted.add(key)
        emit('send', { ...data, channelId, messageId: receipt.id })
      }
    }
    return result
  }
}
