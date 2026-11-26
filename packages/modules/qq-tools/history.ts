import type { BotLike, Message } from '../../../src/types/adapter/bot.ts'
import type { Target } from '../../../src/types/core/target.ts'

export async function readHistory(bot: BotLike, target: Target, limit: number, before: string, visible?: (rows: Message[]) => Message[]) {
  const rows = await bot.getMessageList(target.id, {
    channelType: target.type,
    limit: before ? limit + 1 : limit,
    next: before || undefined,
  })
  const messages = (visible ? visible(rows) : rows).filter(row => row.id !== before).slice(-limit)
  if (!messages.length) return { ok: true, message: '没翻到聊天记录' }
  const lines = messages.map(row => {
    const who = row.userId === bot.selfId ? '你' : row.userName || row.userId
    const time = row.createdAt ? new Date(row.createdAt).toTimeString().slice(0, 5) : ''
    return `${time} ${who}：${(row.content || '（图片/表情）').slice(0, 150)}`
  })
  const oldest = messages[0].id
  return { ok: true, oldest_message_id: oldest, message: [...lines, '最早消息 ID：' + oldest].join('\n') }
}
