// 内置模块：空间日记。每天挑几个时间，按当天的聊天和心情写一条 QQ 空间说说；主人私聊里也能让她发说说。
// 导出 createQzone 的返回值：writeDiary / post / remove / history / nextTime / tick。

import { createQzone } from '../../src/features/qzone/index.ts'
import { resolveAudience } from '../../src/features/qzone/audience.ts'
import { pickDiaryImage } from '../../src/features/media/generate/diary.ts'
import { defineTool, str } from '../../src/tools/index.ts'
import { mimeOf } from '../../src/chat/inbound/index.ts'
import { createDiaryMedia } from './source/media.ts'
import { createDiaryArchive } from './source/archive.ts'

export const name = '空间日记'

export const version = '1.0.0'

export const description = '每天自己写几条 QQ 空间说说；主人私聊里能让她发说说（qq_send_qzone）'

export const tab = 'diary'

export function apply(ctx, config) {
  const { hub, onebot, http } = ctx.host
  const panelAction = (run) => async (req) => {
    if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return { ok: false, message: '请从日记面板发起操作' }
    return run(req)
  }
  const memory = ctx.lazy('memory')
  const media = createDiaryMedia(ctx)
  const archive = createDiaryArchive(ctx)
  ctx.effect(() => media.dispose())
  ctx.effect(() => archive.dispose())
  ctx.setInterval(300_000, () => archive.collect(), '归档公开浏览图')
  const qzone = createQzone({
    getConfig: ctx.root.read, onebot, hub, log: ctx.logger,
    pickImage: () => pickDiaryImage(),
    composeDiary: media.compose,
    onDiary: (text) => memory.add?.({ text: `我在 QQ 空间写过：${text}`, importance: 0.55, tags: ['空间日记'], source: 'diary' }),
  })
  ctx.setInterval(60_000, () => (ctx.host.onebot?.state && ctx.host.onebot.state !== 'connected' ? undefined : qzone.tick()), '空间日记')

  ctx.tool(({ chat, level }) => (level === 'full' && chat.kind !== 'system' ? defineTool({
    name: 'qq_send_qzone',
    description: '在你自己的 QQ 空间发一条说说。content 是正文（第一人称，口语）；images 可选，本地路径或网址。',
    properties: {
      content: str('说说正文'),
      images: { type: 'array', items: { type: 'string' }, description: '可选，图片路径或网址，最多 4 张' },
      visibility: {
        type: 'string',
        enum: ['all', 'friends', 'selected', 'self', 'excluded'],
        description: '单次可见范围，和 QQ 空间一致：all 所有人，friends 好友，selected 部分好友可见，excluded 部分好友不可见，self 仅自己。最终以面板设置为准，只能收窄到 self，不能扩大。',
      },
    },
    required: ['content'],
    execute: async ({ content, images, visibility }) => {
      const r = await qzone.post(String(content || ''), { images: Array.isArray(images) ? images.slice(0, 4) : [], visibility })
      return r.ok ? { ok: true, message: '发好了（' + (r.label || r.visibility) + '）', tid: r.tid } : { ok: false, message: r.message }
    },
  }) : []))

  // 可见范围由面板决定，聊天里怎么请求都不能放大范围
  ctx.rule('发 QQ 空间说说必须遵守「空间日记」面板里设置的可见范围；不要因为聊天里的要求就扩大范围；选择部分好友但名单为空时停止发布，不要改成公开。')

  ctx.server.get('/diary/privacy', async () => {
    try { return { ok: true, ...resolveAudience(ctx.root.config) } }
    catch (error) { return { ok: false, message: error.message } }
  })
  ctx.server.get('/diary/friends', async () => {
    const result = await onebot.call('get_friend_list', {}, { timeoutMs: 20000 })
    const friends = Array.isArray(result) ? result : Array.isArray(result?.friends) ? result.friends : []
    return {
      ok: true,
      friends: friends
        .map((f) => ({ qq: String(f.user_id || f.uin || ''), name: String(f.remark || f.nickname || f.user_name || '') }))
        .filter((f) => /^[1-9]\d{4,11}$/.test(f.qq)),
    }
  })

  ctx.server.get('/diary/run', async (req) => qzone.writeDiary({ visibility: (await http.body(req)).visibility }))
  ctx.server.get('/diary/preview', panelAction(async (req) => media.view(await qzone.writeDiary({ visibility: (await http.body(req)).visibility, preview: true }))))
  ctx.server.get('/diary/archive', async () => archive.state())
  ctx.server.get('/diary/archive/collect', panelAction(async () => archive.collect()))
  ctx.server.get('/diary/image', async (req, res) => {
    try {
      const bytes = media.image(http.query(req).id)
      return http.send(res, 200, bytes, mimeOf(bytes))
    } catch (error) { return http.send(res, 404, '') }
  })
  ctx.server.get('/diary/history', async () => {
    const sync = await qzone.syncHistory()
    return { ok: true, items: qzone.history(), next: qzone.nextTime(), warning: sync.warning || '' }
  })
  ctx.server.get('/qzone/delete', async (req) => {
    await qzone.remove((await http.body(req)).tid)
    return { ok: true, message: '删掉了' }
  })
  return qzone
}
