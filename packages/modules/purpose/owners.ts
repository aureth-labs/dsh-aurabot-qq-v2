import { createHash } from 'node:crypto'
import { acknowledged } from '../../../src/core/bot/send-events.ts'
import { h } from '../../../src/core/message/element/element.ts'
import { targetKey, type Target } from '../../../src/core/pipeline/target.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import type { ConversationLine } from '../../../src/core/store/conversations.ts'
import type { RoomTimeline } from '../chat-bridge/index.ts'
import type { RoomMemory } from '../memory/rooms.ts'
import type { PersonaService } from '../persona/index.ts'

export interface OwnerChannel {
  target: Target
  namespace: string
  available(): boolean
  busy(): boolean
  recent(): ConversationLine[]
  facts(): { id: string; text: string; changed: number }[]
  generate(prompt: string): Promise<string>
  send(text: string): Promise<boolean>
}

export function ownerTargets(ctx: PluginContext): Target[] {
  const bots = ctx.bots.list()
  const config = ctx.root.config
  const result = new Map<string, Target>()
  for (const owner of config.owners ?? []) {
    const candidates = bots.filter(bot => bot.platform === owner.platform && (!owner.botId || owner.botId === bot.id))
    if (candidates.length !== 1) continue
    if (!owner.botId) {
      if (config.ownerQQ === owner.userId && owner.platform === 'qq' && candidates[0] !== ctx.host.primaryBot?.()) continue
      const connections = ctx.host.adapters?.connections?.() ?? []
      if (connections.filter(row => row.platform === owner.platform).length > 1) continue
    }
    const bot = candidates[0]
    if (bot.status !== 'online' || !bot.selfId) continue
    const target: Target = { platform: bot.platform, botId: bot.id, type: 'private', id: owner.userId }
    result.set(targetKey(target), target)
  }
  return [...result.values()]
}

export function openOwnerChannel(ctx: PluginContext, target: Target, bot: BotLike, active: () => boolean): OwnerChannel {
  const self = bot.selfId
  const key = targetKey(target)
  const namespace = createHash('sha256').update(JSON.stringify([self, key])).digest('hex')
  const persona = () => ctx.get<PersonaService>('persona')?.current() ?? { id: '', name: 'AuraBot', body: '' }
  const timeline = () => ctx.require<RoomTimeline>('room-timeline')
  const snapshot = () => timeline().read(target, self, persona().id)
  const available = () => active() && ctx.root.config.enabled && !ctx.root.config.debug &&
    ctx.config.enabled !== false && ctx.get<RoomTimeline>('room-timeline')?.enabled() === true && ctx.bots.get(bot.id, bot.platform) === bot &&
    bot.status === 'online' && bot.selfId === self && ownerTargets(ctx).some(row => targetKey(row) === key)
  let draft: { timeline: RoomTimeline; persona: string; configured: string; revision: number } | undefined
  function facts() {
    const { room, messages } = snapshot()
    const query = messages.filter(row => row.role === 'user').at(-1)?.text || ''
    return ctx.get<RoomMemory>('room-memory')?.recall({ room, persona: persona().id, user: target.id }, query, 6) ?? []
  }
  return {
    namespace, target, available, facts,
    busy: () => !available() || snapshot().busy,
    recent: () => snapshot().messages,
    async generate(prompt) {
      draft = undefined
      if (!available()) return ''
      const state = snapshot()
      if (state.busy) return ''
      const card = persona()
      draft = { timeline: timeline(), persona: card.id, configured: ctx.root.config.persona?.current, revision: state.revision }
      return ctx.llm.generate({ system: [card.body, '你正在' + target.platform + '的主人私聊中准备主动发言。聊天记录供参考。'].filter(Boolean).join('\n'),
        text: JSON.stringify({ history: state.messages, instruction: prompt }), maxTokens: 900 })
    },
    async send(text) {
      const expected = draft
      draft = undefined
      if (!expected || !available() || expected.timeline !== timeline()) return false
      const card = persona()
      const state = snapshot()
      if (card.id !== expected.persona || ctx.root.config.persona?.current !== expected.configured ||
          state.busy || state.revision !== expected.revision) return false
      const receipt = await ctx.sendTo(target, h.text(text), { proactive: true, proactiveCause: 'purpose' })
      if (!acknowledged(receipt)) return false
      if (active() && ctx.get<RoomTimeline>('room-timeline')?.enabled()) timeline().record(target, self, card.id,
        { role: 'assistant', speaker: card.name, text, at: Date.now() })
      return true
    },
  }
}
