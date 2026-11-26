import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Target } from '../../sdk/aurabot.d.ts'

export interface SongDestination {
  target: Target
  room: string
  actor?: string
  persona?: string
  scope?: string
  primary?: boolean
  current(): boolean
  voice(file: string): Promise<boolean>
  text(line: string): Promise<unknown>
}

const formats = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac' }

export function destination(ctx, target: Target, permitted: () => boolean): SongDestination | null {
  const bot = ctx.bots.get(target.botId, target.platform)
  const self = bot?.selfId
  const current = () => Boolean(self && bot.status === 'online' && bot.selfId === self &&
    ctx.bots.get(target.botId, target.platform) === bot && bot.supports('voice') &&
    (ctx.root.config.enabled || target.platform === 'sandbox') && permitted())
  if (!current()) return null
  return {
    target, room: JSON.stringify([target.platform, target.botId, self, target.type, target.id]), current,
    async voice(file) {
      if (!current()) return false
      const mime = formats[extname(file).toLowerCase()]
      if (!mime) throw Error('制作服务返回了不支持的音频格式')
      const fd = await open(file, 'r')
      try {
        const st = await fd.stat()
        if (!st.isFile() || !st.size || st.size > 32 * 1024 * 1024) throw Error('音频文件为空或超过 32 MB')
        const bytes = await fd.readFile()
        if (!current()) return false
        return ctx.text.sent(await ctx.sendTo(target, ctx.h.voice('data:' + mime + ';base64,' + bytes.toString('base64'))))
      } finally { await fd.close() }
    },
    text: line => current() ? ctx.sendTo(target, line) : Promise.resolve(false),
  }
}

export function ownerTargets(ctx): Target[] {
  const targets = new Map<string, Target>()
  for (const bot of ctx.bots.list()) {
    if (bot.status !== 'online' || !bot.supports('voice')) continue
    for (const owner of ctx.root.config.owners || []) {
      if (owner.platform !== bot.platform || (owner.botId && owner.botId !== bot.id)) continue
      const target: Target = { platform: bot.platform, botId: bot.id, type: 'private', id: owner.userId }
      targets.set(JSON.stringify([bot.platform, bot.id, owner.userId]), target)
    }
  }
  return [...targets.values()]
}

export function ownerTarget(ctx, chosen?: Target): Target | undefined {
  const targets = ownerTargets(ctx)
  if (!chosen) return targets.length === 1 ? targets[0] : undefined
  return targets.find(t => t.type === chosen.type && t.id === chosen.id && t.botId === chosen.botId && t.platform === chosen.platform)
}
