import type { BotLike } from '../../../../../src/types/adapter/bot.ts'

const REACT_POOL = ['呲牙', '偷笑', '调皮', '赞', '爱心', '笑哭', '捂脸', '玫瑰']

export function createReact({ getConfig, log, botOf, faces, mood }: { getConfig: () => any; log: any; botOf: () => BotLike | undefined; faces: any; mood: () => any }) {
  const reactStamps = new Map<string, number[]>()

  async function maybeReact(msg: any) {
    try {
      const cfg = getConfig()

      if (cfg.enabled === false) return
      if (cfg.stickers?.enabled === false || cfg.stickers?.react === false) return
      const chance = cfg.stickers?.reactChance ?? 0
      if (!(chance > 0) || !msg.messageId || msg.messageId === '0') return
      if (Math.random() >= chance * mood().sticker) return
      const cap = cfg.stickers?.reactMaxPerHour ?? 10
      const ts = Date.now()
      const recent = (reactStamps.get(msg.chatId) || []).filter((t) => ts - t < 3600_000)
      if (cap <= 0 || recent.length >= cap) { reactStamps.set(msg.chatId, recent); return }
      const name = REACT_POOL[Math.floor(Math.random() * REACT_POOL.length)]
      const id = faces.idOf(name)
      if (!id) return

      if (String(id).length > 3) { log.debug?.(`跳过「${name}」（${id}）：编号超过三位，贴出去会是空白`); return }
      const bot = botOf()
      if (!bot?.supports('reaction')) return
      const channelId = msg.channelId ?? msg.groupId ?? msg.userId ?? String(msg.chatId).replace(/^(group|private):/, '')
      await bot.createReaction(String(channelId), String(msg.messageId), String(id))
      recent.push(ts)
      reactStamps.set(msg.chatId, recent)
      log.info(`${msg.chatId}：给这条消息贴了个「${name}」（${id}）`)
    } catch (error: any) {
      log.debug?.('贴表情失败：', error?.message || error)
    }
  }

  return { maybeReact }
}
