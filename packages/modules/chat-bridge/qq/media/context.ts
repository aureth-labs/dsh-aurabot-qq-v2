import { createRecentMedia } from '../../../../../src/chat/media/recent.ts'
import { createImageReader } from './images.ts'
import { createQuoteResolver } from '../format/quote.ts'
import { segmentBytes } from '../../../../../src/core/net/index.ts'
import { mediaLimits } from '../../../../../src/core/message/media/limits.ts'
import { GROUP_IMAGE_MAX, GROUP_IMAGE_WINDOW_MS } from '../context/group-media.ts'
import { createGroupPromptBuilder } from '../context/group-prompt.ts'

export function createMessageMedia({
  getConfig,
  log,
  onebot,
  store,
  groups,
  turnGuard,
  faces,
  activity,
  sentIds,
  assertActive,
  asr,
}) {
  const { isBeforeMemoryReset, historyVisible } = store
  const { groupNames, groupBuf, groupRefs, groupEngagedRun } = groups
  const { pending } = turnGuard

  const recentMedia = createRecentMedia({ log })

  const recentMediaOf = (chatId, userId?) =>
    recentMedia.get(chatId, userId).filter((item) => !isBeforeMemoryReset(chatId, item.userId, item.at))

  const { imagesOf, fitForModel, animatedNote } = createImageReader({ onebot, getConfig, log, recentMediaOf })

  const recentFiles = new Map()

  async function groupName(gid) {
    if (groupNames.has(gid)) return groupNames.get(gid)
    try {
      const info = await onebot.bot?.getGuild(String(gid))
      if (info?.name) groupNames.set(gid, info.name)
    } catch (error) {}
    return groupNames.get(gid) || gid
  }

  const quotes = createQuoteResolver({
    onebot,
    log,
    getConfig,
    selfId: () => activity.selfId,
    faceName: faces.nameOf,
    historyVisible,
    imagesOf,
  })

  const { cache: quoteCache, info: quotedInfo, inline: quoteInline, images: quoteImages } = quotes

  async function referenceImage(chat, source = 'last') {
    assertActive()
    let seg
    if (String(source).startsWith('msg:')) {
      const match = /^msg:(-?[1-9]\d*):([1-9]\d*)$/.exec(source)
      const item =
        match &&
        recentMediaOf(chat.chatId).find((x) => x.messageId === match[1] && x.imageIndex === Number(match[2]))
      if (!item)
        throw new Error(
          '这张指定图片已过期、已被缓存淘汰或不在当前聊天中，请重新发送或引用目标原图；不会改用其他图片',
        )
      seg = item.seg
    } else if (source === 'quote') {
      const now = Date.now()
      const q = [...quoteCache.values()].findLast(
        (item) => item.chatId === chat.chatId && item.ok && item.at <= now && now - item.at < 30 * 60_000,
      )
      seg = q?.images.at(-1) || q?.stickers.at(-1)
    } else {
      seg = recentMediaOf(chat.chatId).at(-1)?.seg
    }
    if (!seg)
      throw new Error(
        source === 'quote'
          ? '当前聊天没有可用的引用图片，请引用带图的消息再试'
          : '当前聊天最近半小时没有收到图片，请先发一张图',
      )
    const limits = mediaLimits(getConfig().media)
    if (!limits.receiveImages) throw Error('已关闭接收图片')
    return segmentBytes(seg, onebot, { maxBytes: limits.maxImageMB * 1048576, allowLocal: false })
  }

  async function repliedToBot(replyId, msg) {
    if (!replyId) return false
    if (sentIds.has(replyId)) return true
    const q = await quotedInfo(replyId, msg)
    return Boolean(q && q.ok && q.isBot)
  }

  async function recognize(seg, messageId?, wav?, localOnly = false) {
    const service = asr?.()
    if (!service?.active()) return ''
    const bot = onebot.bot
    const input = wav ? { read: async () => wav }
      : bot && service.resolve(bot.platform, bot.id, { type: 'voice', attrs: { ...seg.data, url: seg.data?.url || seg.data?.file } }, messageId)
    if (!input) return ''
    return (await service.recognize(input, localOnly)).text
  }
  async function transcribe(msg, wav?) {
    if (!msg.records?.length) return ''
    const text = await recognize(msg.records[0], msg.messageId, wav)
    return text ? '[语音] ' + text : '[语音未能识别，内容可能有误]'
  }
  const localTranscribe = seg => recognize(seg, undefined, undefined, true)

  async function addGroupImages(msg, entry = null) {
    const p = pending.get(msg.chatId)
    if (!p || p.images.length >= mediaLimits(getConfig().media).maxImages) return
    try {
      const imgs = await imagesOf(msg)
      for (let i = 0; i < imgs.length && p.images.length < mediaLimits(getConfig().media).maxImages; i++)
        p.images.push({
          type: 'image',
          data: imgs[i].data,
          mediaType: imgs[i].mediaType,
          name: imgs[i].name || `qq-${msg.messageId}-${i + 1}`,
        })
      if (imgs.length && entry) entry.mediaPending = true // 这些图已经进 pending.images，groupPrompt 不用再带
      if (animatedNote(imgs))
        p.images.push({ type: 'text', text: animatedNote(imgs) })
    } catch (error) {}
  }

  async function freshGroupImages(fresh, room, chatId) {
    const take = Math.min(GROUP_IMAGE_MAX, room)
    if (take <= 0) return []
    const out = []
    let got = 0
    const cutoff = Date.now() - GROUP_IMAGE_WINDOW_MS
    for (const x of fresh.slice().reverse()) {
      if (got >= take) break
      if (x.mediaPending || !x.t || x.t < cutoff || (!x.images?.length && !x.stickers?.length)) continue
      try {
        const imgs = await imagesOf({ ...x, chatId })
        for (const img of imgs) {
          if (got >= take) break
          got++
          out.push({
            type: 'image',
            data: img.data,
            mediaType: img.mediaType,
            name: img.name || `qq-${x.mid || 'group'}-${got}`,
          })
        }
        const note = animatedNote(imgs)
        if (note) out.push({ type: 'text', text: note })
      } catch (error) {
        log.debug('群聊图片读取失败：', error.message)
      }
    }
    return out
  }

  const { groupPrompt } = createGroupPromptBuilder({
    groupBuf,
    groupRefs,
    groupEngagedRun,
    groupName,
    platform: () => onebot.bot?.platform,
    getSelfId: () => onebot.bot?.selfId || activity.selfId,
    quotedInfo,
    quoteInline,
    quoteImages,
    freshGroupImages,
  })

  return {
    recentMedia,
    recentMediaOf,
    recentFiles,
    groupName,
    quotes,
    quoteCache,
    referenceImage,
    repliedToBot,
    transcribe,
    localTranscribe,
    addGroupImages,
    imagesOf,
    fitForModel,
    animatedNote,
    groupPrompt,
  }
}
