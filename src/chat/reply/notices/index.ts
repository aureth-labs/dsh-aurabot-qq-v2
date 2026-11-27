import { roomKey } from '../../../core/bot/room.ts'

type NoticeTextOptions = Partial<Record<'selfId' | 'name' | 'ownMessage' | 'faceName' | 'platform' | 'botId', any>>

export function noticeText(ev, { selfId, platform, botId, name = (id) => String(id), ownMessage = (_id?: unknown) => false, faceName = (_id?: unknown) => undefined as string | undefined } : NoticeTextOptions = {}) {
  if (!ev?.action || !ev.channelId) return null
  const self = String(selfId || '')
  const who = (id) => (String(id) === self ? '你' : name(id))
  const chatId = roomKey({ platform, botId, type: ev.type, id: ev.channelId })
  const say = (text) => ({ chatId, text })
  const op = ev.operatorId
  switch (ev.action) {
    case 'recall':
      if (ev.type === 'private') return say('对方撤回了一条消息')
      if (String(op) === self) return null
      return say(!op || String(op) === String(ev.userId) ? `${who(ev.userId)}撤回了一条消息` : `${who(op)}撤回了${who(ev.userId)}的一条消息`)
    case 'unmute': return say(`${who(op)}解除了${who(ev.userId)}的禁言`)
    case 'mute': return say(`${who(op)}禁言了${who(ev.userId)} ${Math.max(1, Math.round((Number(ev.amount) || 0) / 60))} 分钟`)
    case 'join': return say(`${who(ev.userId)}进群了`)
    case 'leave': return say(`${who(ev.userId)}退群了`)
    case 'kick': return say(`${op && String(op) !== String(ev.userId) ? `${who(op)}把` : ''}${who(ev.userId)}踢出了群`)
    case 'admin-set': return say(`${who(ev.userId)}成了管理员`)
    case 'admin-unset': return say(`${who(ev.userId)}不再是管理员`)
    case 'essence-add': return say(`${who(op)}把${who(ev.userId)}的消息设为精华`)
    case 'essence-remove': return say(`${who(op)}把${who(ev.userId)}的消息移出了精华`)
    case 'rename': return say(`${who(ev.userId)}把群名片改成了「${String(ev.value || '').slice(0, 30)}」`)
    case 'reaction': {
      if (!ownMessage(ev.messageId)) return null
      const list = (ev.faces || []).map((id) => faceName(id) || `表情${id}`)
      return say(`${who(ev.userId)}给你的消息点了表情回应${list.length ? `（${list.join('、')}）` : ''}`)
    }
    case 'friend': return say('你们刚加上好友')
    case 'title': return say(`${who(ev.userId)}的头衔变成了「${String(ev.value || '').slice(0, 30)}」`)
    case 'group-name': return say(`${who(ev.userId)}把群名改成了「${String(ev.value || '').slice(0, 30)}」`)
    default: return null
  }
}
