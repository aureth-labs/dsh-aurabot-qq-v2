import { createHash } from 'node:crypto'
import type { Element } from '../../../src/types/core/element.ts'
import type { SessionLike } from '../../../src/types/core/session.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { mediaLimits } from '../../../src/core/message/media/limits.ts'
import { readSticker, stickerService, type StickerSource } from '../../../src/core/message/media/sticker.ts'
import { defineTool, int, str } from '../../../src/tools/index.ts'
import { createStickerStore } from './store.ts'

interface Candidate { element: Element; at: number; userId: string }
interface Source { capture(): StickerSource | undefined }
const ttl = 30 * 60000
const scopeKey = (bot: BotLike) => JSON.stringify([bot.platform, bot.id, bot.selfId])
const flagged = (el: Element) => String(el.attrs.sticker) === 'true'
const roomKey = (type: string, id: string) => JSON.stringify([type, id])

export function installStickerRooms(ctx: PluginContext) {
  type Store = ReturnType<typeof createStickerStore>
  type Account = { store: Store; bot: BotLike; rooms: Map<string, Candidate[]> }
  const accounts = new Map<string, Account>()
  let active = true
  const config = () => ctx.root.config
  function allowed(bot: BotLike) {
    return active && bot.selfId && bot.status === 'online' && ctx.bots.get(bot.id, bot.platform) === bot &&
      (config().enabled || bot.platform === 'sandbox') && !config().debug && config().stickers.enabled
  }
  const source = (bot: BotLike) => ctx.get<Source>(stickerService(bot.platform, bot.id))?.capture()
  function drop(key: string, entry: Account) {
    entry.store.dispose()
    entry.rooms.clear()
    accounts.delete(key)
  }
  function account(bot: BotLike) {
    const key = scopeKey(bot)
    const known = accounts.get(key)
    if (known?.bot === bot) return known
    for (const [id, entry] of accounts) if (entry.bot.platform === bot.platform && entry.bot.id === bot.id) drop(id, entry)
    const self = bot.selfId
    const store = createStickerStore({ dsh: ctx.harness, generate: ctx.ask, getConfig: config, log: ctx.logger,
      directory: ctx.dataDir('accounts', createHash('sha256').update(key).digest('hex')),
      source: () => allowed(bot) && bot.selfId === self ? source(bot) : undefined })
    const entry: Account = { store, bot, rooms: new Map() }
    accounts.set(key, entry)
    return entry
  }
  ctx.effect(() => { active = false; for (const [key, entry] of accounts) drop(key, entry) })

  ctx.on('bot/offline', (bot: BotLike) => {
    for (const [key, entry] of accounts) if (entry.bot === bot) drop(key, entry)
  })

  ctx.on('message', async (session: SessionLike) => {
    const bot = ctx.bots.get(session.bot.id, session.platform)
    if (!bot || !allowed(bot) || session.userId === bot.selfId || ('parent' in session && session.parent)) return
    const primary = ctx.get<{ platform: string; botId: string }>('primary-sticker-source')
    if (primary?.botId === bot.id && primary.platform === bot.platform) return
    const limits = mediaLimits(config().media)
    const cfg = config().stickers
    if (!limits.receiveImages || !cfg.collect || !(session.isPrivate ? cfg.fromPrivate : cfg.fromGroups)) return
    const images = session.elements.filter(el => el.type === 'image').slice(0, limits.maxImages)
    if (!images.length) return
    const entry = account(bot)
    const identity = scopeKey(bot)
    const key = roomKey(session.type, session.target.id)
    const current = () => Boolean(allowed(bot) && scopeKey(bot) === identity && accounts.get(identity) === entry)
    const now = Date.now()
    const recent = (entry.rooms.get(key) ?? []).filter(row => now - row.at < ttl)
    const auto: Element[] = []
    for (const element of images) {
      const url = String(element.attrs.url ?? '')
      if (url.length > limits.maxImageMB * 1048576 * 1.34 + 128) continue
      recent.push({ element, userId: session.userId, at: now })
      if (flagged(element) && cfg.collectMode === 'auto') auto.push(element)
    }
    entry.rooms.delete(key)
    entry.rooms.set(key, recent.slice(-6))
    while (entry.rooms.size > 128) entry.rooms.delete(entry.rooms.keys().next().value)
    let chars = 0
    for (const [id, rows] of [...entry.rooms].reverse()) {
      const size = rows.reduce((total, row) => total + String(row.element.attrs.url ?? '').length + String(row.element.attrs.file ?? '').length, 0)
      if (chars + size > 24 * 1048576 || !rows.some(row => now - row.at < ttl)) entry.rooms.delete(id)
      else chars += size
    }
    for (const element of auto) {
      if (!current()) return
      await entry.store.collect(element, key, current)
    }
  })

  ctx.tool(({ target, chat, primaryChat }) => {
    if (!target || primaryChat || chat.kind === 'system') return []
    const bot = ctx.bots.get(target.botId, target.platform)
    if (!bot || !allowed(bot) || !bot.supports('image')) return []
    const entry = account(bot)
    const identity = scopeKey(bot)
    const current = () => Boolean(allowed(bot) && scopeKey(bot) === identity && accounts.get(identity) === entry)
    const owner = () => ctx.isOwner(chat.userId, bot.platform, bot.id)
    const unavailable = { ok: false, message: '当前会话无法使用表情库' }
    return [
      defineTool({ name: 'sticker_send', description: '从本账号表情库选择一张表情发到当前聊天。', properties: { name: str('名字或情绪标签') }, required: ['name'],
        async execute({ name }) {
          if (!current()) return unavailable
          const item = entry.store.match(String(name || ''))
          const el = item && entry.store.elementFor(item)
          if (!el) return { ok: false, message: '没有匹配的表情' }
          const sent = ctx.text.sent(await ctx.sendTo(target, el))
          if (sent && current()) entry.store.markUsed(item.md5)
          return { ok: sent }
        } }),
      defineTool({ name: 'sticker_list', description: '查看表情数量；主人可以查看表情名字与标签。', properties: {},
        execute() {
          if (!current()) return unavailable
          const { items } = entry.store.library()
          return { ok: true, count: items.length, ...(owner() && { items: items.slice(-60).map(({ name, tags }) => ({ name, tags })) }) }
        } }),
      defineTool({ name: 'sticker_collect', description: '收藏本次聊天中最近出现的贴纸。主人可明确要求保存普通图片。', properties: {
        index: int('从最近一张起，第几张。默认 1'), name: str('表情名字'), photo: { type: 'boolean', description: '主人要求保存普通图片时开启' },
      }, async execute({ index, name, photo }) {
        const permitted = () => current() && config().stickers.collect && (target.type === 'private' ? config().stickers.fromPrivate : config().stickers.fromGroups) &&
          mediaLimits(config().media).receiveImages && ((!photo && config().stickers.collectMode !== 'owner') || owner())
        if (!permitted()) return unavailable
        const rows = (entry.rooms.get(roomKey(target.type, target.id)) ?? []).filter(row => Date.now() - row.at < ttl && (photo || flagged(row.element)))
        const n = Number(index ?? 1)
        const candidate = Number.isInteger(n) && n > 0 ? rows.at(-n) : undefined
        if (!candidate) return { ok: false, message: '这次聊天中没有可收藏的图片' }
        const bytes = await readSticker(candidate.element, mediaLimits(config().media).maxImageMB * 1048576, source(bot))
        if (!permitted()) return unavailable
        const result = await entry.store.addFromBuffer(bytes, { name: String(name ?? '').slice(0, 12), from: 'tool', element: candidate.element })
        return { ok: result.ok, existed: result.existed }
      } }),
    ]
  })
}
