import { parseMessageEvent } from '../../inbound/index.ts'
import { QUOTE_FORWARD_MAX_CHARS } from '../context/context.ts'

/** 引用消息解析：QQ 的引用段只有 message_id，正文要再取一次；取不到也留一笔，让她能如实说没看到。 */
export function createQuoteResolver({ onebot, log, getConfig, selfId, faceName, historyVisible, expandForwards, imagesOf }) {
  // QQ 的引用段只有 message_id，正文要用 get_msg 再取一次。取到后把「谁、说了什么、几张图」带上；
  // 取不到也记一笔，让她知道「这条引用没读到」，可以如实说没看到（别装作看见了）。
  const quoteCache = new Map()
  const QUOTE_CACHE_MAX = 200
  /** 表情包/图片段里有没有能直接下载的地址（有些 get_msg 只回了空 url + 裸文件名）。 */
  const quoteSegUsable = (seg) => {
    const d = (seg && seg.data) || {}
    return [d.url, d.file].some((x) => typeof x === 'string'
      && (/^https?:\/\//i.test(x) || x.startsWith('base64://') || x.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(x)))
  }
  const quoteNeedsHistory = (parsed) => [...(parsed.images || []), ...(parsed.stickers || [])].some((seg) => !quoteSegUsable(seg))
  /**
   * get_msg 对「她发出的表情包/图片」可能只回空 url + 裸文件名（下载不了）。
   * 这时退回消息历史（get_friend_msg_history / get_group_msg_history），里面带可用 url。
   */
  async function quoteFromHistory(id, ctx) {
    if (!ctx || (!ctx.userId && !ctx.groupId)) return null
    const group = Boolean(ctx.groupId)
    const action = group ? 'get_group_msg_history' : 'get_friend_msg_history'
    const base = group ? { group_id: Number(ctx.groupId) } : { user_id: Number(ctx.userId) }
    // 先用引用 id 当锚点（能取到更早的消息），拿不到再退回「最近 30 条」
    const anchor = /^-?\d+$/.test(id) ? Number(id) : 0
    const attempts = anchor
      ? [{ ...base, message_id: anchor, count: 5, reverse_order: false }, { ...base, count: 30 }]
      : [{ ...base, count: 30 }]
    for (const params of attempts) {
      try {
        const r = await onebot.call(action, params, { timeoutMs: 8000, retries: 0 })
        const hit = (r?.messages || []).find((m) => String(m?.message_id ?? '') === id || String(m?.real_id ?? '') === id)
        if (hit) return hit
      } catch (error) {
        log.debug(`引用消息历史也拉不到（${id}）：`, error.message)
      }
    }
    return null
  }
  async function quotedInfo(replyId, ctx = null) {
    const id = String(replyId || '')
    if (!id) return null
    const chatId = ctx?.chatId || (ctx?.groupId ? `group:${ctx.groupId}` : ctx?.userId ? `private:${ctx.userId}` : '')
    const key = `${chatId}|${id}`
    if (quoteCache.has(key)) {
      const cached = quoteCache.get(key)
      if (!historyVisible(chatId, cached.uid, cached.time)) return null
      cached.at = Date.now()
      quoteCache.delete(key)
      quoteCache.set(key, cached)
      return cached
    }
    const out = { ok: false, who: '', uid: '', text: '', images: [], stickers: [], records: 0, isBot: false, at: 0, chatId, time: 0 }
    try {
      const m = await onebot.call('get_msg', { message_id: Number(id) || id }, { timeoutMs: 5000, retries: 0 })
      // 被引用那条消息的发生时间（QQ 给的是秒）。引用里要标出来，否则模型拿「今晚/昨天」
      // 去对历史引用时会按当前时间算错（2026-11-04 实测：11-02 的话被当成「今晚」）。
      out.time = Number(m?.time) || 0
      const sender = m?.sender || {}
      out.uid = String(sender.user_id ?? m?.user_id ?? '')
      if (out.time && !historyVisible(chatId, out.uid, out.time)) return null
      out.who = String(sender.card || sender.nickname || out.uid || '某人')
      const kind = ctx?.groupId ? 'group' : 'private'
      let parsed = parseMessageEvent({ message_type: kind, group_id: ctx?.groupId, user_id: out.uid, sender, message: m?.message ?? m?.raw_message ?? '' }, selfId, { faceName: faceName })
      if (quoteNeedsHistory(parsed)) {
        const hit = await quoteFromHistory(id, ctx)
        if (hit) {
          out.time ||= Number(hit?.time) || 0
          const again = parseMessageEvent({ message_type: kind, group_id: ctx?.groupId, user_id: out.uid, sender: hit.sender || sender, message: hit.message ?? '' }, selfId, { faceName: faceName })
          if (!quoteNeedsHistory(again)) parsed = again
          else { parsed.images = [...(parsed.images || []), ...(again.images || [])]; parsed.stickers = [...(parsed.stickers || []), ...(again.stickers || [])] }
        }
      }
      out.text = String(parsed.text || '').trim().slice(0, 300)
      out.images = parsed.images || []
      out.stickers = parsed.stickers || []
      out.records = (parsed.records || []).length
      // 引用的是一条合并转发：把里面的内容也拉出来。默认跟 forward.expandEarly 一起开——
      // 她引用别人消息时能看到正文，但被引用消息里套的转发只是占位符，等于没看到。
      if (parsed.forwards?.length && getConfig().forward?.expandEarly) {
        const tmp = { forwards: parsed.forwards, images: [], stickers: [] }
        const full = await expandForwards(tmp, String(parsed.text || ''), { timeoutMs: 5000 })
        if (full) out.text = full.trim().slice(0, QUOTE_FORWARD_MAX_CHARS)
        out.images = [...(out.images || []), ...tmp.images].slice(0, 4)
        out.stickers = [...(out.stickers || []), ...tmp.stickers].slice(0, 4)
      }
      out.isBot = out.uid === String(selfId() || getConfig().botQQ)
      out.ok = true
      out.at = Date.now()
    } catch (error) {
      log.debug(`引用消息没拉到（${id}）：`, error.message)
    }
    if (!historyVisible(chatId, out.uid, out.time)) return null
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
  /** 被引用那条消息自己的发生时间（绝对时刻，同年省略年份）。
   *  只给引用用：模型拿「今晚/昨天」去对历史引用时，没有这个就只能按当前时间推，会算错。 */
  const quoteWhen = (q) => {
    const t = Number(q?.time) || 0
    if (!t) return ''
    const d = new Date(t < 1e12 ? t * 1000 : t)
    if (Number.isNaN(d.getTime())) return ''
    const md = `${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2, '0')}时${String(d.getMinutes()).padStart(2, '0')}分`
    return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
  }
  /** 引用说明：群聊接在某条消息后面，私聊单独一行。失败时明说没读到，让她可以如实讲。 */
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
  /** 引用里的图片 / 表情包：最多 take 张转成附件；模型看不了图时 pushToSession 会换成文字。 */
  async function quoteImages(q, take = 2) {
    if (!q?.ok || take <= 0) return []
    const segs = [...q.images, ...q.stickers].slice(0, take)
    if (!segs.length) return []
    const got = await imagesOf({ stickers: [], images: segs })
    return got.map((x, i) => ({ type: 'image', data: x.data, mediaType: x.mediaType, name: `quote-${q.uid || 'x'}-${i + 1}` }))
  }

  return { cache: quoteCache, info: quotedInfo, who: quoteWho, body: quoteBody, when: quoteWhen, inline: quoteInline, images: quoteImages }
}
