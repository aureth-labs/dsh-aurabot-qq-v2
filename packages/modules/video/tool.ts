import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import type { SessionLike } from '../../../src/types/core/session.ts'
import type { Target } from '../../../src/types/core/target.ts'
import type { Element } from '../../../src/types/core/element.ts'
import { h } from '../../../src/core/message/element/element.ts'
import { isDefiniteFailure } from '../../../src/core/bot/delivery.ts'
import { privateCapabilityAllowed } from '../../../src/chat/policy/rules/access.ts'
import { defineTool, int, str } from '../../../src/tools/index.ts'
import type { videoService } from './service.ts'
import type { videoReview } from './review.ts'

const confirm = /^(确认|确定|可以|行|好|好的|开始|生成|生成吧|确认生成|就这个|没问题|ok)$/i
const cancel = /^(取消|算了|不用了|先不要|别生成|不生成|等等|不要)$/
const room = (t: Target, self: string) => JSON.stringify([t.platform, t.botId, self, t.type, t.id])

interface Request {
  target: Target
  prompt: string
  seconds: number
  frame?: Uint8Array
  actors: string[]
  current(): boolean
  supportsVideo: boolean
  supportsFile: boolean
}

export function registerVideoTool(ctx: PluginContext, service: ReturnType<typeof videoService>, review: ReturnType<typeof videoReview>) {
  const pending = new Map<string, { request: Request; stop(): void }>()
  const descriptions = new Map<string, { at: number; text: string }>()
  const preparing = new Set<string>()
  let active = true
  ctx.effect(() => { active = false; pending.clear(); descriptions.clear() })
  const send = (r: Request, el: Element) => ctx.sendTo(r.target, el, { timeoutMs: 120000 })

  async function render(key: string, r: Request) {
    if (!r.current()) return
    try {
      const { element, file } = await service.generate(r.prompt, { seconds: r.seconds, firstFrame: r.frame })
      if (!r.current()) return
      const attachment = () => h.file(String(element.attrs.url), 'video.mp4')
      let receipt: unknown
      try { receipt = await send(r, r.supportsVideo ? element : attachment()) }
      catch (error) {
        if (!r.supportsVideo || !r.supportsFile || !r.current() || !isDefiniteFailure(error)) throw error
        receipt = await send(r, attachment())
      }
      if (!ctx.text.sent(receipt) || !r.current()) return
      const text = await review.selfView(file, r.prompt, r.seconds)
      if (text && r.current()) {
        if (descriptions.size >= 100) descriptions.delete(descriptions.keys().next().value)
        descriptions.set(key, { text, at: Date.now() })
      }
    } catch (error) {
      ctx.logger.warn('视频生成或投递失败', String(error))
      if (r.current()) await send(r, h.text('视频未能确认送达，请查看视频插件日志。')).catch(() => {})
    }
  }

  ctx.rule(() => service.ready() ? ['- 使用 generate_video 生成视频。提交后很慢，结果会发到当前聊天。'] : [])
  ctx.prompt(({ target }) => {
    if (!target) return ''
    const bot = ctx.bots.get(target.botId, target.platform)
    const last = bot && descriptions.get(room(target, bot.selfId))
    return last && Date.now() - last.at < 1800000 ? '刚刚生成的视频画面：' + last.text : ''
  })

  ctx.tool(({ target, chat, sessionId, primaryChat, images }) => {
    if (!target || chat.kind === 'system' || !service.ready()) return []
    const bot = ctx.bots.get(target.botId, target.platform)
    if (!bot || (!bot.supports('video') && !bot.supports('file'))) return []
    const self = bot.selfId
    const key = room(target, self)
    return defineTool({
      name: 'generate_video', description: '生成视频并发回当前会话。设置要求确认时，等待发起人回复。',
      properties: { prompt: str('画面和镜头描述'), seconds: int('时长，4 至 15 秒'), image: int('本次消息中作为首帧的图片序号，从 1 开始') },
      required: ['prompt'],
      async execute({ prompt, seconds, image }) {
        const text = String(prompt || '').trim()
        if (!text) return { ok: false, message: '缺少画面描述' }
        const actors: string[] = primaryChat && chat.kind === 'group' ? ctx.host.hub.turnSenders(sessionId).map(String) : [String(chat.userId || '')]
        const allowed = () => actors.length && actors.every(id => ctx.isOwner(id, target.platform, target.botId)) ||
          primaryChat && privateCapabilityAllowed(ctx.root.config, chat, 'video')
        const current = () => Boolean(active && service.ready() && (ctx.root.config.enabled || target.platform === 'sandbox') &&
          bot.status === 'online' && bot.selfId === self && ctx.bots.get(target.botId, target.platform) === bot && allowed())
        if (!current() || primaryChat && !ctx.turnFromOwner(sessionId) && !privateCapabilityAllowed(ctx.root.config, chat, 'video'))
          return { ok: false, message: '当前会话没有生成视频的权限' }
        if (service.busy() || preparing.has(key) || pending.has(key)) return { ok: false, message: '上一段视频仍在处理' }
        preparing.add(key)
        try {
          let frame: Uint8Array | undefined
          if (image != null) {
            if (typeof image !== 'number' || !Number.isInteger(image) || image < 1) return { ok: false, message: '首帧图片序号无效' }
            frame = images?.[image - 1] ? Buffer.from(images[image - 1].data, 'base64') :
              primaryChat && image === 1 ? await ctx.host.hub.referenceImage(chat, 'last') : undefined
            if (!frame) return { ok: false, message: '找不到这张首帧图片' }
          }
          const request: Request = { target, current, actors, frame, supportsVideo: bot.supports('video'), supportsFile: bot.supports('file'),
            prompt: await review.enhance(text), seconds: Math.max(4, Math.min(15, Math.round(Number(seconds) || 5))) }
          if (!current()) return { ok: false, message: '接收账号或权限已变更' }
          if (service.busy()) return { ok: false, message: '上一段视频仍在处理' }
          if (ctx.root.config.video?.confirm === false) {
            void render(key, request)
            return { ok: true, message: '已提交生成，结果会发回这里。' }
          }
          const stop = ctx.setTimeout(900000, () => pending.delete(key))
          const entry = { request, stop }
          pending.set(key, entry)
          try {
            const receipt = await send(request, h.text('要按这段生成视频吗？\n\n' + request.prompt + '\n\n' + request.seconds + ' 秒，回复「确认」或「取消」。'))
            if (!ctx.text.sent(receipt)) throw Error('确认消息未送达')
          } catch (error) {
            if (pending.get(key) === entry) pending.delete(key)
            stop()
            throw error
          }
          return { ok: true, message: '已发送描述，等确认。' }
        } finally { preparing.delete(key) }
      },
    })
  })

  ctx.middleware(async (input, next) => {
    const session = input as SessionLike
    const text = session.content.trim()
    if (!confirm.test(text) && !cancel.test(text)) return next()
    const key = room(session.target, session.bot.selfId)
    const entry = pending.get(key)
    if (!entry || (!entry.request.actors.includes(session.userId) && !ctx.isOwner(session))) return next()
    pending.delete(key)
    entry.stop()
    if (cancel.test(text)) await session.send('好，那不生成了。')
    else if (!entry.request.current()) await session.send('接收账号或权限已变更，请重新发起。')
    else if (service.busy()) await session.send('上一段视频正在生成，请稍后重新发起。')
    else {
      const receipt = await session.send('已确认，开始生成视频。')
      if (ctx.text.sent(receipt)) void render(key, entry.request)
    }
    return true
  })
}
