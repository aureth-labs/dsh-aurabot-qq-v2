import type { Element } from '../../../../../src/types/core/element.ts'
import { roomKey } from '../../../../../src/core/bot/room.ts'
import { toText } from '../../../../../src/core/message/element/element.ts'

export interface InboundInput {
  bot: { platform: string; id: string; selfId: string }
  type: 'private' | 'group' | 'channel'
  channelId: string
  userId: string
  userName?: string
  messageId?: string
  elements: Element[]
  timestamp?: number
  quoteDeleted?: boolean
}

export interface ParsedFile { name: string; size: number; id: string; url: string; hash: string; busid: number }

export interface ParsedMessage {
  kind: 'private' | 'group'
  chatId: string
  userId: string
  groupId: string
  nickname: string
  messageId: string
  text: string
  wakeText: string
  mentioned: boolean
  atOthers: boolean
  atTargets: Array<{ qq: string; name: string }>
  replyId: string
  media: Element[]
  images: Element[]
  stickers: Element[]
  records: Element[]
  files: ParsedFile[]
  platform: string
  botId: string
}

export const isSticker = (el: Element) => el.type === 'image' && (el.attrs.sticker === true || el.attrs.sticker === 'true')

export function cardText(raw: unknown) {
  try {
    const card = typeof raw === 'string' ? JSON.parse(raw) : raw as any
    const meta = card?.meta || {}
    if (card?.app === 'com.tencent.map' && meta.Location) {
      const parts = [meta.Location.title, meta.Location.address].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      return `[位置${parts.length ? '：' + parts.join(' ') : ''}]`
    }
    if (card?.app === 'com.tencent.contact.lua' && meta.contact) {
      const id = String(meta.contact.id ?? '').trim()
      return `[联系人${id ? '：' + id : ''}]`
    }
    const item = meta.detail_1 || meta.news || meta.music || Object.values(meta)[0] || {}
    const title = String(item.desc || item.title || card.prompt || '').trim()
    const url = String(item.qqdocurl || item.jumpUrl || item.url || '').split('?')[0]
    const from = String(item.title && item.desc ? item.title : item.tag || '').trim()
    if (!title && !url) return '[卡片消息]'
    return `[分享卡片${from ? '（' + from + '）' : ''}：${title}${url ? ' ' + url : ''}]`
  } catch {
    return '[卡片消息]'
  }
}

export function parseInbound(input: InboundInput, faceName: (id: string) => string | undefined = () => undefined): ParsedMessage {
  const self = String(input.bot.selfId || '')
  const kind = input.type === 'private' ? 'private' : 'group'
  const userId = String(input.userId)
  const groupId = kind === 'group' ? String(input.channelId) : ''
  const texts: string[] = []
  const allAt = new Set<number>()
  const out: ParsedMessage = {
    kind, userId, groupId, platform: input.bot.platform, botId: input.bot.id,
    chatId: roomKey({ platform: input.bot.platform, botId: input.bot.id, type: kind, id: kind === 'group' ? groupId : userId }),
    nickname: String(input.userName || userId), messageId: String(input.messageId ?? ''),
    text: '', wakeText: '', mentioned: false, atOthers: false, atTargets: [], replyId: '',
    media: [], images: [], stickers: [], records: [], files: [],
  }
  const walk = (elements: Element[]) => {
    for (const el of elements) {
      const attrs = el.attrs || {}
      switch (el.type) {
        case 'text': texts.push(String(attrs.content ?? '')); break
        case 'br': texts.push('\n'); break
        case 'at': {
          const id = String(attrs.id ?? '')
          if (id === 'all' || attrs.type === 'all') { allAt.add(texts.length); texts.push('@全体成员 ') }
          else if (self && id === self) out.mentioned = true
          else {
            out.atOthers = true
            out.atTargets.push({ qq: id, name: String(attrs.name || id) })
            texts.push(`@${attrs.name || id} `)
          }
          break
        }
        case 'quote': out.replyId ||= String(attrs.id ?? ''); break
        case 'face': {
          const id = String(attrs.id ?? '')
          const name = faceName(id)
          const label = id === '358' ? '骰子' : id === '359' ? '猜拳' : name || String(attrs.name || '') || '表情'
          texts.push(attrs.resultId != null && String(attrs.resultId) !== '' ? `[${label}：${attrs.resultId}]` : `[${label}]`)
          break
        }
        case 'image':
          out.media.push(el)
          if (isSticker(el)) { out.stickers.push(el); texts.push(String(attrs.alt || '[表情包]')) }
          else { out.images.push(el); texts.push('[图片]') }
          break
        case 'voice': {
          const heard = el.children?.find((child) => child.type === 'translateVoice')
          if (heard) texts.push('[语音] ' + toText(heard))
          else out.records.push(el)
          break
        }
        case 'video': texts.push('[视频]'); break
        case 'file': {
          const name = String(attrs.name || attrs.file || '')
          texts.push(`[文件 ${name}]`)
          out.files.push({ name, size: Number(attrs.size ?? attrs.file_size) || 0, id: String(attrs.id ?? attrs.file_id ?? ''),
            url: String(attrs.url || ''), hash: String(attrs.file_hash || ''), busid: Number(attrs.busid) || 0 })
          break
        }
        case 'flash_file': texts.push(attrs.title ? `[闪传文件：${attrs.title}]` : '[闪传文件]'); break
        case 'json': texts.push(cardText(attrs.data)); break
        case 'xml': texts.push('[卡片消息]'); break
        case 'poke': texts.push('[戳一戳]'); break
        case 'forward':
          if (el.children?.length) walk(el.children.flatMap((child) => child.type === 'message' ? child.children ?? [] : [child]))
          else texts.push('[合并转发]')
          break
        default:
          if (el.children?.length) walk(el.children)
      }
    }
  }
  walk(input.elements || [])
  const tidy = (list: string[]) => list.join('').replace(/\s+\n/g, '\n').trim()
  out.text = tidy(texts)
  out.wakeText = allAt.size ? tidy(texts.filter((_, index) => !allAt.has(index))) : out.text
  return out
}
