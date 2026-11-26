// 主动贴表情：看到消息就可能贴一个，跟「回不回复」无关——她可以只窥屏、不出声。
// 概率跟 stickers.autoChance 同源（reactChance 留空即完全跟随），同样吃心情系数；
// 每个会话每小时有上限（reactMaxPerHour），免得热闹群里变成刷屏。

const REACT_POOL = ['呲牙', '偷笑', '调皮', '赞', '爱心', '笑哭', '捂脸', '玫瑰']

export function createReact({ getConfig, log, onebot, faces, mood }: { getConfig: () => any; log: any; onebot: any; faces: any; mood: () => any }) {
  const reactStamps = new Map<string, number[]>()

  async function maybeReact(msg: any) {
    try {
      const cfg = getConfig()
      // 贴表情也是对外动作，必须和发消息走同一套闸：总开关关掉不做。
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
      // NapCat 只按位数猜类型：四位以上编号会被当码点送出去，QQ 收下但不渲染，直接不贴。
      if (String(id).length > 3) { log.debug?.(`跳过「${name}」（${id}）：编号超过三位，贴出去会是空白`); return }
      await onebot.call('set_msg_emoji_like', { message_id: String(msg.messageId), emoji_id: String(id), set: true }, { timeoutMs: 10000 })
      recent.push(ts)
      reactStamps.set(msg.chatId, recent)
      log.info(`${msg.chatId}：给这条消息贴了个「${name}」（${id}）`)
    } catch (error: any) {
      log.debug?.('贴表情失败：', error?.message || error)
    }
  }

  return { maybeReact }
}
