import { createHash } from 'node:crypto'
import { songSlot } from './local.ts'
import { createSongStudio } from './studio/studio.ts'
import { destination, type SongDestination } from './destination.ts'
import { installSongPanel } from './panel.ts'
import { cleanFailLine, failPrompt } from './feedback.ts'
import { parseSingRequest } from './audio/command.ts'

export { config } from './config.ts'
export { cleanFailLine, failPrompt }
export const name = '翻唱'
export const version = '2.0.0'
export const description = '点歌、制作翻唱并将语音发送到发起会话'
export const tab = 'song'

export function nudgeMoodAfterSong(mood, title, chatId) {
  mood?.nudge?.(8, '唱完了「' + title + '」', chatId)
}

export function apply(ctx) {
  let active = true
  const local = ctx.get('local-scripts')
  if (local) ctx.effect(local.register('song', songSlot))
  function settings() {
    const root = ctx.root.config
    const overrides = root.ext?.song || {}
    const values = ctx.config || {}
    const explicit = Object.keys(overrides).filter(key => Object.hasOwn(values, key))
    return { ...root.song, ...Object.fromEntries(explicit.map(key => [key, values[key]])) }
  }
  const studio = createSongStudio({
    getConfig: () => ({ song: settings() }), log: ctx.logger, workDir: ctx.dataDir('songs'),
    local, renderer: () => ctx.get('song-renderer'),
    async say({ destination: delivery, chatId, title, why }) {
      if (!delivery.current()) return
      const key = 'fail:' + createHash('sha256').update(chatId).digest('hex').slice(0, 16)
      const line = cleanFailLine(await ctx.think(failPrompt(title, why), { title: '翻唱失败', key, noTools: true, timeoutMs: 30_000 }))
      if (!line) throw Error('模型未生成失败提示')
      await delivery.text(line)
    },
    onSung(title, chatId, delivery: SongDestination) {
      const target = delivery.target
      const text = '应邀唱了《' + title + '》'
      const room = delivery.scope || chatId
      nudgeMoodAfterSong(ctx.get('mood'), title, room)
      if (delivery.primary) ctx.get('memory')?.addEvent?.({ text, tags: ['唱歌'], about: target.type === 'private' ? target.id : '', chatId: room, importance: 0.5 })
      else if (delivery.scope && delivery.actor && ctx.root.config.memory?.enabled !== false) {
        ctx.get('room-memory')?.remember({ room, persona: delivery.persona, user: delivery.actor }, text)
      }
      ctx.emit('song/sung', { target, title, chatId })
    },
  })
  ctx.effect(() => { active = false; studio.dispose() })
  const request = (options, target, permitted, actor = target?.type === 'private' ? target.id : '', primaryRoom = '') => {
    if (!target) return { ok: false, message: '缺少接收会话' }
    const delivery = destination(ctx, target, () => active && settings().enabled && permitted())
    if (delivery) {
      const timeline = ctx.get('room-timeline')
      delivery.actor = actor
      delivery.primary = Boolean(primaryRoom)
      delivery.persona = ctx.get('persona')?.current()?.id || ''
      delivery.scope = primaryRoom || (timeline?.enabled() ? timeline.read(target, ctx.bots.get(target.botId, target.platform).selfId, delivery.persona).room : '')
    }
    return delivery ? studio.request({ ...options, destination: delivery, chatId: delivery.room })
      : { ok: false, message: '当前会话未开放点歌、尚未上线或不支持语音' }
  }

  ctx.tool(({ target, chat, primaryChat, sessionId, actors, delegated }) => {
    if (!target || !settings().enabled || !ctx.bots.get(target.botId, target.platform)?.supports('voice')) return []
    return ctx.defineTool({
      name: primaryChat ? 'qq_song_cover' : 'song_cover',
      description: '仅在对方点歌或邀唱时制作翻唱，做好后发到当前会话。歌名可带指定的歌手，清唱可选 acapella。指定片段时填写起点和时长。成功排队后才能答应已开始制作。',
      properties: {
        song: { type: 'string', description: '歌名和指定歌手' },
        pitch: { type: 'integer', description: '明确要求升降调时填写半音数' },
        acapella: { type: 'boolean', description: '仅保留人声' },
        start_sec: { type: 'integer', description: '开始秒数' }, duration_sec: { type: 'integer', description: '片段时长（秒）' },
      },
      required: ['song'],
      execute({ song, pitch, acapella, start_sec, duration_sec }) {
        const allowedTurn = !primaryChat || ctx.turnFromOwner(sessionId)
        const senders = actors?.() || []
        const users = senders.length ? senders : [chat?.userId || (primaryChat && allowedTurn && ctx.root.config.ownerQQ)]
        const permitted = () => !settings().ownerOnly || Boolean(delegated?.('song')) ||
          (allowedTurn && users.every(user => ctx.isOwner(user, target.platform, target.botId)))
        return request({ song, pitch, acapella, startSec: start_sec, durationSec: duration_sec }, target, permitted, chat?.userId, primaryChat ? chat?.chatId : '')
      },
    })
  })

  ctx.command('sing <song:text>').alias('唱', '点歌', '翻唱').action(async ({ session, args }) => {
    const input = parseSingRequest(args)
    if (input.error || !input.song) return session.send(input.error || '请输入歌名')
    const result = request(input, session.target, () => !settings().ownerOnly || ctx.isOwner(session), session.userId)
    return session.send(result.message)
  })
  installSongPanel(ctx, studio, request)
  const service = { ...studio, request: ({ target, ...options }) => request(options, target, () => true) }
  ctx.provide('sing', service)
  return service
}
