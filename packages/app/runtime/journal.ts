import { targetKey, type Target } from '../../../src/core/pipeline/target.ts'
import type { ChatLogFacade } from '../../../src/types/plugin/ctx.ts'
import { defaultOneBotId } from '../onebot.ts'

interface JournalRow {
  t: number
  chatId: string
  who: string
  text: string
  uid?: string
  forgottenAt?: number
}

interface DailyLog {
  chatLogOf(day: string): JournalRow[]
  logChat(room: string, who: string, text: string, uid?: string): boolean | void
}

export function journalRoom(target: Target) {
  if (target.platform === 'qq' && target.botId === defaultOneBotId && target.type !== 'channel')
    return target.type + ':' + target.id
  return targetKey(target)
}

export function createPluginJournal(log: DailyLog): ChatLogFacade {
  return {
    read(target, day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('日期格式应为 YYYY-MM-DD')
      const room = journalRoom(target)
      return log.chatLogOf(day).filter(row => row.chatId === room && !row.forgottenAt)
        .map(({ t, who, text, uid }) => ({ target: { ...target }, t, who, text, userId: uid }))
    },
    append(target, who, text, userId) {
      return log.logChat(journalRoom(target), who, text, userId) === true
    },
  }
}
