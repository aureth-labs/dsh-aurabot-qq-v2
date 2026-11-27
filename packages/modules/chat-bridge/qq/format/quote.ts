import { parseInbound } from '../events/parse.ts'
import { roomOf } from '../../../../../src/core/bot/room.ts'
import { QUOTE_FORWARD_MAX_CHARS } from '../context/context.ts'

export function createQuoteResolver({ currentMedia, bot, log, selfId, faceName, historyVisible, imagesOf }) {
  const QUOTE_CACHE_MAX = 200
  const usable = (el) => [el?.attrs?.url, el?.attrs?.file].some((x) => typeof x === 'string'
    && (/^https?:\/\//i.test(x) || x.startsWith('base64://') || x.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(x)))
  const needsHistory = (parsed) => [...parsed.images, ...parsed.stickers].some((el) => !usable(el))

  async function fromHistory(account, room, id, current) {
    const attempts = /^-?\d+$/.test(id) ? [{ next: id, limit: 5 }, { limit: 30 }] : [{ limit: 30 }]
    for (const query of attempts) {
      if (!current()) return null
      try {
        const list = await account.getMessageList(room.id, { channelType: room.kind, ...query })
        const hit = list.find((m) => String(m?.id ?? '') === id)
        if (hit) return hit
      } catch (error) {
        log.debug(`引用消息历史也拉不到（${id}）：`, error.message)
      }
    }
    return null
  }

  const parse = (account, room, message) => parseInbound({
    bot: { platform: account.platform, id: account.id, selfId: account.selfId },
    type: room.kind === 'private' ? 'private' : 'group',
    channelId: room.id,
    userId: String(message.userId ?? ''),
    userName: message.userName,
    elements: message.elements || [],
  }, faceName)

  async function quotedInfo(replyId, ctx = null) {
    const id = String(replyId || '')
    const quoteCache = currentMedia()?.quotes
    if (!id || !quoteCache) return null
    const chatId = ctx?.chatId || ''
    const room = roomOf(chatId)
    if (!room || ctx?.quoteDeleted) return null
    const key = `${chatId}|${id}`
    if (quoteCache.has(key)) {
      const cached = quoteCache.get(key)
      if (cached.deleted || !historyVisible(chatId, cached.uid, cached.time)) return null
      cached.at = Date.now()
      quoteCache.delete(key)
      quoteCache.set(key, cached)
      return cached
    }
    const current = () => currentMedia()?.quotes === quoteCache
    const out = { ok: false, who: '', uid: '', text: '', images: [], stickers: [], records: 0, isBot: false, at: 0, chatId, time: 0 }
    const account = bot()
    try {
      if (!account) throw new Error('没有可用的 bot')
      let message = await account.getMessage(room.id, id).catch(() => null)
      if (!current()) return null
      if (!message || String(message.id ?? '') !== id) message = await fromHistory(account, room, id, current)
      if (!message || !current()) return null
      out.time = Number(message.createdAt) || 0
      out.uid = String(message.userId ?? '')
      if (out.time && !historyVisible(chatId, out.uid, out.time)) return null
      out.who = String(message.userName || out.uid || '某人')
      let parsed = parse(account, room, message)
      if (needsHistory(parsed)) {
        const hit = await fromHistory(account, room, id, current)
        if (!current()) return null
        if (hit) {
          out.time ||= Number(hit.createdAt) || 0
          const again = parse(account, room, hit)
          if (!needsHistory(again)) parsed = again
          else { parsed.images = [...parsed.images, ...again.images]; parsed.stickers = [...parsed.stickers, ...again.stickers] }
        }
      }
      const forwarded = (message.elements || []).some((el) => el.type === 'forward' && el.children?.length)
      out.text = String(parsed.text || '').trim().slice(0, forwarded ? QUOTE_FORWARD_MAX_CHARS : 300)
      out.images = parsed.images
      out.stickers = parsed.stickers
      out.records = parsed.records.length
      out.isBot = out.uid === String(selfId() || account.selfId)
      out.ok = true
      out.at = Date.now()
    } catch (error) {
      log.debug(`引用消息没拉到（${id}）：`, error.message)
    }
    if (currentMedia()?.quotes !== quoteCache || quoteCache.get(key)?.deleted || !historyVisible(chatId, out.uid, out.time)) return null
    if (quoteCache.size >= QUOTE_CACHE_MAX) quoteCache.delete(quoteCache.keys().next().value)
    quoteCache.set(key, out)
    return out
  }

  const quoteWho = (q) => (q.isBot ? '你' : `${q.who || q.uid || '某人'}${q.uid ? `(${q.uid})` : ''}`)
  const quoteBody = (q) => {
    const body = String(q.text || '').replace(/\[(图片|表情包)\]/g, '').trim()
    if (body) return body
    if (q.images.length) return '（图片）'
    if (q.records) return '（语音）'
    if (q.stickers.length) return '（表情包）'
    return '（没有文字）'
  }
  const quoteWhen = (q) => {
    const t = Number(q?.time) || 0
    if (!t) return ''
    const d = new Date(t < 1e12 ? t * 1000 : t)
    if (Number.isNaN(d.getTime())) return ''
    const md = `${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2, '0')}时${String(d.getMinutes()).padStart(2, '0')}分`
    return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
  }
  const quoteInline = (q) => {
    if (!q) return ''
    if (!q.ok) return '（引用了某条消息，但内容没读到；如果影响理解，可以如实说没看到，让对方重发或说一下是哪条）'
    const pics = q.images.length && q.stickers.length
      ? `，另有 ${q.images.length} 张图、${q.stickers.length} 个表情包`
      : q.images.length ? `，另有 ${q.images.length} 张图`
      : q.stickers.length ? `，另有 ${q.stickers.length} 个表情包`
      : q.records ? '，一条语音' : ''
    const when = quoteWhen(q)
    return `（引用 ${quoteWho(q)} 的消息${when ? `（${when}）` : ''}：「${quoteBody(q)}」${pics}）`
  }
  async function quoteImages(q, take = 2) {
    if (!q?.ok || take <= 0) return []
    const segs = [...q.images, ...q.stickers].slice(0, take)
    if (!segs.length) return []
    const got = await imagesOf({ stickers: [], images: segs })
    return got.map((x, i) => ({ type: 'image', data: x.data, mediaType: x.mediaType, name: `quote-${q.uid || 'x'}-${i + 1}` }))
  }

  function recall(chatId: string, messageId: string) {
    const quoteCache = currentMedia()?.quotes
    if (!quoteCache) return
    if (quoteCache.size >= QUOTE_CACHE_MAX) quoteCache.delete(quoteCache.keys().next().value)
    quoteCache.set(chatId + '|' + messageId, { deleted: true })
  }
  return { recall, info: quotedInfo, who: quoteWho, body: quoteBody, when: quoteWhen, inline: quoteInline, images: quoteImages }
}
