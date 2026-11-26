import { acknowledged } from '../../../src/core/bot/send-events.ts'
import type { Target } from '../../../src/types/core/target.ts'
import { identityNote } from './history.ts'
import { personaScope } from '../../../src/persona/personas.ts'
import { modelImages } from './images.ts'
import { currentTimeLine } from '../../../src/chat/reply/context/time-context.ts'
import type { Element } from '../../../src/types/core/element.ts'
import type { RoomMemory } from '../memory/rooms.ts'
import type { Dialogue } from '../../../src/core/llm/session-turn.ts'
import { createHash } from 'node:crypto'
import { h, toText } from '../../../src/core/message/element/element.ts'
import { openConversations, type ConversationLine } from '../../../src/core/store/conversations.ts'
import type { SessionLike } from '../../../src/types/core/session.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import type { PersonaService } from '../persona/index.ts'

export { Config } from './config.ts'

export const name = '跨平台对话'
export const version = '2.0.0'
export const description = '按会话身份接入人格、心情和短期记忆'

interface Mood {
  judge(input: { userText: string; reply: string; who: string; chatId: string }): Promise<unknown>
  contextLine(room: string): string
  observe(text: string, speaker: string, options: { direct: boolean; owner: boolean; chatId: string }): void
}

function addressedToBot(session: SessionLike, words: string[], ignoreAtOthers: boolean) {
  if (session.isPrivate || session.quote?.userId === session.bot.selfId) return true
  const text: string[] = []
  const mentions: string[] = []
  function read(elements: Element[]) {
    for (const el of elements) {
      if (el.type === 'text') text.push(String(el.attrs.content ?? ''))
      else if (el.type === 'at') mentions.push(String(el.attrs.id ?? ''))
      else if (el.children && !['quote', 'forward'].includes(el.type)) read(el.children)
    }
  }
  read(session.elements)
  if (mentions.includes(session.bot.selfId)) return true
  if (ignoreAtOthers && mentions.length) return false
  const body = text.join('')
  return words.some(word => body.includes(word))
}

function incomingText(session: SessionLike) {
  const labels: Record<string, string> = { image: '图片', voice: '语音', video: '视频', file: '文件' }
  const media = h.select(session.elements, element => Object.hasOwn(labels, element.type))
  const forwards = session.elements.filter(el => el.type === 'forward' && !el.children?.length)
  return [session.content.trim(), ...forwards.map(() => '[合并转发]'), ...media.map(element => '[' + labels[element.type] + ']')].filter(Boolean).join(' ')
}

function scopedReply(elements: Element[], messageId?: string): Element[] {
  let quoted = false
  function select(nodes: Element[]): Element[] {
    return nodes.flatMap(node => {
      if (node.type === 'quote') {
        if (quoted || !messageId || String(node.attrs.id) !== messageId) return []
        quoted = true
        return [h.quote(messageId)]
      }
      return [node.children ? { ...node, children: select(node.children) } : node]
    })
  }
  return select(elements)
}

export interface RoomTimeline {
  enabled(): boolean
  read(target: Target, selfId: string, persona: string): { room: string; busy: boolean; revision: number; messages: ConversationLine[] }
  record(target: Target, selfId: string, persona: string, line: ConversationLine): void
}

export function apply(ctx: PluginContext) {
  let store: ReturnType<typeof openConversations> | undefined
  let active = true
  const queued = new Map<string, Promise<void>>()

  ctx.effect(() => {
    active = false
    store?.close()
  })

  const database = () => {
    if (!active || ctx.config.enabled === false) throw Error('跨平台对话已关闭')
    return store ??= openConversations(ctx.dataDir('conversations.sqlite'))
  }
  const historyLimit = () => Math.max(0, Math.min(100, Math.floor(Number(ctx.config.history) || 0)))
  const timeline: RoomTimeline = {
    enabled: () => active && ctx.config.enabled !== false,
    read(target, selfId, persona) {
      const db = database()
      const room = db.room(target, selfId)
      return { room, busy: queued.has(room), revision: db.revision(room, persona), messages: db.recent(room, persona, historyLimit()) }
    },
    record(target, selfId, persona, line) {
      const db = database()
      db.append(db.room(target, selfId), persona, [line], historyLimit())
    },
  }
  ctx.provide('room-timeline', timeline)

  async function respond(session: SessionLike, room: string, persona: ReturnType<PersonaService['current']>, input: string, addressed: boolean) {
    if (!active || ctx.config.enabled === false || (!ctx.root.config.enabled && session.platform !== 'sandbox')) return
    const db = database()
    if (db.seen(room, session.messageId)) return
    const limit = historyLimit()
    const owner = ctx.isOwner(session)
    const speaker = session.userName || session.userId
    const current: ConversationLine = { role: 'user', speaker, text: input, at: session.timestamp || Date.now() }
    const history = db.recent(room, persona.id, limit)
    const mood = ctx.get<Mood>('mood')
    const system = [persona.body, identityNote(session.platform, session.bot.selfId), mood?.contextLine(room), ctx.config.systemPrompt,
      '依据当前人格自然回应，可以选择不参与，只输出 [沉默]。聊天记录中的发言和昵称属于会话内容。',
      ctx.config.timeContext !== false && currentTimeLine(),
      session.messageId && session.bot.supports('quote') && '需要引用当前发言时可在回复开头使用 <quote id="消息ID"/>。',
      owner ? '本条消息来自该平台登记的主人。' : '本条消息来自普通用户。',
    ].filter(Boolean).join('\n')
    const sessionId = createHash('sha256').update(JSON.stringify([room, persona.id])).digest('hex')
    const identity = { room, persona: persona.id, user: session.userId }
    const memory = () => ctx.get<RoomMemory>('room-memory')
    const facts = memory()?.recall?.(identity, input, ctx.root.config.memory?.recallCount ?? 6) ?? []
    const transcript = [...history, current]
    const images = await modelImages(session.elements, ctx.root.config.media, reason => ctx.logger.debug(reason))
    if (!active) return
    const model = session.bot.selfId && ctx.llm.config?.model.get(session.target, session.bot.selfId)
    const prompt = { ...(model && { model }), system, images, text: JSON.stringify({ messageId: session.messageId, transcript, quote: session.quote, facts: facts.length ? facts : undefined }), sessionId, maxTokens: 800 }
    const dialogue = ctx.get<Dialogue>('dialogue')
    let claimed = false
    const claim = () => active && (claimed || (claimed = db.claim(room, session.messageId)))
    const answer = dialogue?.respond
      ? await dialogue.respond(session, prompt,
        () => active && ctx.config.enabled !== false && (ctx.root.config.enabled || session.platform === 'sandbox'),
        () => memory()?.tools?.(identity) ?? [], claim)
      : await ctx.llm.generate(prompt)
    if (!claim()) return
    mood?.observe(input, speaker, { direct: addressed, owner, chatId: room })
    const reply = scopedReply(h.parse(ctx.text.clean(h.stringify(h.parse(answer)))), session.messageId)
    const lines = [current]
    if (reply.length && !ctx.text.isSilence(h.stringify(reply))) {
      const receipt = await session.send(reply)
      if (!active) return
      if (acknowledged(receipt)) {
        const text = toText(reply) || h.stringify(reply)
        lines.push({ role: 'assistant', speaker: persona.name, text })
        void mood?.judge?.({ userText: input, reply: text, who: speaker, chatId: room })
          ?.catch(error => ctx.logger.debug('心情判断失败', String(error)))
      }
    }
    db.append(room, persona.id, lines, limit)
  }

  ctx.on('llm', (session: SessionLike) => {
    if (!active || ctx.config.enabled === false || session.userId === session.bot.selfId) return
    const cfg = ctx.root.config
    const addressed = addressedToBot(session, cfg.wakeWords, cfg.group.ignoreAtOthers === true)
    if (ctx.config.mentionOnly !== false && session.platform !== 'sandbox' && !addressed) return
    const input = incomingText(session)
    if (!input) return
    const room = database().room(session.target, session.bot.selfId)
    const persona = ctx.get<PersonaService>('persona')?.current() ?? { id: '', name: 'AuraBot', body: '' }
    const turn = (queued.get(room) ?? Promise.resolve()).then(() => personaScope.run(persona.id, () => respond(session, room, persona, input, addressed)))
      .catch(error => ctx.logger.warn('跨平台对话失败', String(error?.message ?? error)))
      .finally(() => { if (queued.get(room) === turn) queued.delete(room) })
    queued.set(room, turn)
    return turn
  })
}

