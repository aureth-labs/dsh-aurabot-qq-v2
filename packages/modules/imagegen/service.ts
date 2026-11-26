import type { GenerateImage, PluginContext } from '../../../src/types/plugin/ctx.ts'
import { h } from '../../../src/core/message/element/element.ts'
import { mimeOf } from '../../../src/core/message/media/inspect.ts'
import { defineTool, int, str } from '../../../src/tools/index.ts'
import type { createImageGen } from './engine.ts'

export function installImageService(ctx: PluginContext, engine: ReturnType<typeof createImageGen>) {
  let active = true
  ctx.effect(() => { active = false })
  const generate: GenerateImage = async (prompt, options = {}) => {
    if (!active || !engine.enabled()) throw Error('生图服务尚未就绪')
    if (!prompt?.trim()) throw Error('需要画面描述')
    const { references, ...settings } = options
    const result = await engine.generate(prompt.trim(), { ...settings, images: references?.map(image => Buffer.from(image)) })
    if (!active) throw Error('生图服务已卸载')
    return (Array.isArray(result) ? result : [result]).map(bytes => {
      const type = mimeOf(bytes)
      if (!type?.startsWith('image/')) throw Error('生成结果缺少可用图片')
      return h.image('data:' + type + ';base64,' + bytes.toString('base64'))
    })
  }
  ctx.provide('generateImage', { generate })
  ctx.tool(({ target, chat, primaryChat, images: inputImages }) => {
    if (primaryChat || !target || !engine.enabled()) return []
    const bot = ctx.bots.get(target.botId, target.platform)
    const selfId = bot?.selfId
    const permitted = () => ctx.root.config.imageGen?.ownerOnly === false || ctx.isOwner(chat.userId, target.platform, target.botId)
    const current = () => active && (ctx.root.config.enabled || target.platform === 'sandbox') && permitted() &&
      bot?.status === 'online' && selfId && bot.selfId === selfId && ctx.bots.get(target.botId, target.platform) === bot
    if (!current() || !bot.supports('image')) return []
    return defineTool({
      name: 'generate_image',
      description: '按画面描述生成图片并发送到当前会话。',
      properties: { prompt: str('画面描述'), image: int('参考本次消息的第几张图片，从 1 开始') }, required: ['prompt'],
      async execute({ prompt, image }) {
        if (!current() || !engine.enabled()) return { ok: false, message: '当前会话不能生成图片' }
        const reference = typeof image === 'number' && Number.isInteger(image) && inputImages?.[image - 1]
        if (image != null && !reference) return { ok: false, message: '当前消息中没有这张参考图' }
        const images = await ctx.generateImage(String(prompt || ''), { references: reference ? [Buffer.from(reference.data, 'base64')] : undefined })
        if (!current()) return { ok: false, message: '生成期间接收账号或权限已变更' }
        const sent = await ctx.sendTo(target, images)
        return { ok: ctx.text.sent(sent), count: images.length }
      },
    })
  })
}
