import { ownerId } from '../../../src/core/config/owners.ts'
import { readFileSync } from 'node:fs'
import { defineTool, int, str } from '../../../src/tools/index.ts'
import { fetchImage } from '../../../src/core/net/index.ts'
import { mediaLimits } from '../../../src/core/message/media/limits.ts'
import { readSticker } from '../../../src/core/message/media/sticker.ts'
import { imageSize } from '../../../src/core/message/media/inspect.ts'
import { resolvePainting } from '../../../src/features/media/generate/paintings.ts'
import type { primaryLibrary } from './primary.ts'

export function primaryTools(ctx, { select, source }: ReturnType<typeof primaryLibrary>) {
  const hub = ctx.host.hub
  ctx.tool(({ chat, level, sessionId, target, primaryChat }) => {
    if ((target && !primaryChat) || chat.kind === 'system') return []
    const store = select()
    const connection = source()
    const currentAccount = () => !target || Boolean(connection?.active() && select() === store)
    const current = chat.chatId
    const tools = [
      ...(ctx.root.config.stickers.enabled ? [defineTool({
        name: 'qq_send_sticker',
        description: '在当前 QQ 聊天里发一张表情包。name 写表情的名字或情绪（如「委屈」「开心」「早晚安」），会在表情库里模糊匹配。一般直接在回复里写 <sticker:名字> 就行，这个工具用于回复之外单独补发。',
        properties: { name: str('表情名字或情绪关键词') },
        required: ['name'],
        execute: async ({ name }) => {
          const ok = await hub.sendSticker(current, String(name || ''))
          return ok ? { ok: true, message: '发了' } : { ok: false, message: '表情库里没找到合适的' }
        },
      })] : []),
      defineTool({
        name: 'qq_list_stickers',
        description: '看看表情库里有哪些表情（名字和标签），挑表情前可以先看。非主人只能看到数量，名字和标签只给主人看。',
        properties: { query: str('可选，按名字/标签筛选') },
        execute: async ({ query }) => {
          const items = store.library().items
          if (!hub.turnSendersAllOwner(sessionId)) return { ok: true, count: items.length, message: `表情库里有 ${items.length} 张表情；名字和标签只给主人看` }
          const q = String(query || '').trim()
          const hit = (q ? items.filter((i) => (i.name || '').includes(q) || (i.tags || []).some((t) => t.includes(q))) : items).slice(-60)
          return { ok: true, count: items.length, message: hit.length ? hit.map((i) => `${i.name || '未命名'}${i.tags?.length ? '（' + i.tags.join('/') + '）' : ''}`).join('、') : '没有符合的表情', items: hit.map((i) => ({ name: i.name, tags: i.tags })) }
        },
      }),
      defineTool({
        name: 'qq_edit_sticker',
        description: '整理表情库：给一张表情改名字、改标签，或者删掉。名字不贴切、别人建议改名、标签不对的时候用；不喜欢、重复、发不出去的表情可以删。sticker 写现在的名字或标签（模糊匹配）。',
        properties: {
          sticker: str('要改的那张表情现在的名字或标签'),
          new_name: str('新名字（12 字以内，不改就不填）'),
          tags: { type: 'array', items: { type: 'string' }, description: '新标签（情绪 / 用途，比如 开心、委屈、嘲讽；不改就不填）' },
          delete: { type: 'boolean', description: 'true = 删掉这张表情' },
        },
        required: ['sticker'],
        execute: async ({ sticker, new_name, tags, delete: del }) => {
          const item = store.match(String(sticker || ''))
          if (!item) return { ok: false, message: '表情库里没找到这张' }
          const label = item.name || item.md5.slice(0, 8)
          if (del) {

            if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '删表情要主人发话' }
            const r = await store.remove(item.md5)
            return r.ok ? { ok: true, message: `删掉了「${label}」` } : { ok: false, message: r.reason || '没删成' }
          }
          if (!new_name && !(Array.isArray(tags) && tags.length)) return { ok: false, message: '要说改成什么' }
          const r = store.rename(item.md5, new_name ? String(new_name).trim().slice(0, 12) : undefined, Array.isArray(tags) && tags.length ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 5) : undefined)
          return r.ok ? { ok: true, message: `改好了：「${label}」→「${r.item.name}」${r.item.tags?.length ? '（' + r.item.tags.join('/') + '）' : ''}` } : { ok: false, message: '没改成' }
        },
      }),
    ]


    tools.push(defineTool({
      name: 'qq_collect_sticker',
      description: '悄悄把聊天里刚出现的表情收进自己的表情库（喜欢才收，不喜欢就别调）。index 从 1 开始；name 是你给它起的名字。收表情是你自己的小习惯，通常不用跟对方说你收没收到。主人让你收哪张，你收哪张（「只听主人的」模式下：主人私聊里可以自己挑着收；群里这一轮只有主人说话时也能自己收，有别人在场就要等主人发话）。传 painting（画作编号，如 #1）时，收的是你自己刚画的那张图，不是聊天里的表情。',
      properties: {
        index: int('第几张表情（从 1 开始，默认 1）'),
        latest_image: { type: 'boolean', description: '仅当对方明确要求收藏一张以普通图片发来的表情时设为 true，选最近一张图片（近方形且最长边不超过 1024 像素），与 index、painting 二选一' },
        name: str('给它起的名字（≤12 字）'),
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈' },
        painting: str('画作编号（如 #1）：收你自己刚画的图时填，和 index 二选一'),
      },
      required: [],
      execute: async ({ index, name, tags, painting, latest_image }) => {

        if (painting) {
          const p = resolvePainting(current, painting)
          if (!p) return { ok: false, message: `找不到画作 ${painting}（可能是编号过期了，先让我画一张？）` }
          let buf
          try {
            buf = readFileSync(p.path)
          } catch (error) {
            return { ok: false, message: '这张画的文件读不到了：' + error.message }
          }
          const r = await store.addFromBuffer(buf, {
            name: String(name || '').trim().slice(0, 12),
            tags: Array.isArray(tags) ? tags.slice(0, 3) : [],
            from: 'painting',
          })
          if (!r.ok) return { ok: false, message: r.reason || '没存成' }
          if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
          return { ok: true, message: `收进库了：「${r.item.name || '未命名'}」（${p.prompt ? '画的是' + p.prompt : '自己画的'}）` }
        }
        if (!ctx.root.config.stickers.collect) return { ok: false, message: '偷表情关着' }
        const mode = (ctx.root.config.stickers.collectMode || 'auto')
        if (mode === 'owner' && !hub.turnSendersAllOwner(sessionId)) {
          return { ok: false, message: '现在是「只听主人的」模式：这一轮有别人在，得主人让我收才行' }
        }
        if (latest_image && !(current.startsWith('group:') ? ctx.root.config.stickers.fromGroups : ctx.root.config.stickers.fromPrivate)) {
          return { ok: false, message: '没有开启从这个会话收表情' }
        }
        const photo = latest_image ? hub.recentImages(current).at(-1) : null
        const seg = latest_image
          ? (photo?.element.type === 'image' && !photo.sticker ? photo.element : null)
          : hub.stickerElement(current, index || 1)
        if (!seg) return { ok: false, message: '这张表情已经拿不到了（超过 30 分钟，或者这一轮里没有这张）' }
        let buf
        try {
          buf = await readSticker(seg, mediaLimits(ctx.root.config.media).maxImageMB * 1048576, connection)
        } catch (error) {
          return { ok: false, message: '这张表情下载失败了：' + error.message }
        }
        if (!currentAccount() || !ctx.root.config.stickers.collect || (ctx.root.config.stickers.collectMode === 'owner' && !hub.turnSendersAllOwner(sessionId))) return { ok: false, message: '接收账号或权限已改变' }
        if (latest_image) {
          const { width, height } = imageSize(buf)
          const ratio = width / height
          if (!(ratio >= 0.75 && ratio <= 4 / 3) || Math.max(width, height) > 1024) {
            return { ok: false, message: '普通图片需要近方形且最长边不超过 1024 像素才能作为表情收藏' }
          }
        }
        const r = await store.addFromBuffer(buf, {
          name: String(name || '').trim().slice(0, 12),
          tags: Array.isArray(tags) ? tags.slice(0, 3) : [],
          from: current,
        })
        if (!r.ok) return { ok: false, message: r.reason || '没存成' }
        if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
        return { ok: true, message: `收进库了：「${r.item.name || '未命名'}」` }
      },
    }))


    tools.push(defineTool({
      name: 'qq_save_sticker',
      description: '把这个聊天里刚发来的那张表情包 / 图片收进你的表情库（同时收藏到 QQ）。主人说「存一下这个表情」「导入这个表情」「收藏这张」时用。传 painting（画作编号，如 #1）时，存的是你自己刚画的那张图。name 是不超过 12 个字的备注，可以不填（会自动看图起名）。',
      properties: {
        name: str('备注（≤12 字，可不填）'),
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈（可不填）' },
        painting: str('画作编号（如 #1）：存你自己刚画的图时填'),
      },
      execute: async ({ name, tags, painting }) => {
        if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '只有主人能让我存表情' }
        let buf
        if (painting) {
          const p = resolvePainting(current, painting)
          if (!p) return { ok: false, message: `找不到画作 ${painting}（编号可能过期了，先让我画一张？）` }
          try {
            buf = readFileSync(p.path)
          } catch (error) {
            return { ok: false, message: '这张画的文件读不到了：' + error.message }
          }
        } else {
          const media = hub.recentImages(current)

          const pick = media.filter((x) => x.userId === String(ownerId(ctx.root.config))).at(-1) || media.at(-1)
          if (!pick) return { ok: false, message: '最近半小时这个聊天里没有人发表情或图片，先把那张发过来' }


          try {
            buf = await readSticker(pick.element, mediaLimits(ctx.root.config.media).maxImageMB * 1048576, connection)
          } catch (error) {
            return { ok: false, message: '这张表情下载失败了：' + error.message }
          }
        }
        if (!currentAccount() || !hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '接收账号或权限已改变' }
        const r = await store.addFromBuffer(buf, { name: String(name || '').slice(0, 12), tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'tool' })
        if (!r.ok) return { ok: false, message: r.reason || '没存成' }
        if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
        return { ok: true, message: `存好了${r.item.name ? '「' + r.item.name + '」' : ''}` }
      },
    }))
    tools.push(defineTool({
      name: 'qq_import_qq_stickers',
      description: '把你 QQ「我喜欢的」收藏里已有的表情全部导进表情库（已经有的跳过），之后就能用 <sticker:名字> 发它们。主人让你「导入收藏的表情」「同步一下 QQ 表情」时用。',
      execute: async () => {
        if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '只有主人能让我导入收藏的表情' }
        return store.importFromQQ()
      },
    }))

    if (level === 'full') tools.push(defineTool({
      name: 'qq_add_sticker',
      description: '把一张图片收进表情库并收藏到 QQ。source 是本地图片路径或图片网址；name 是不超过 12 个字的备注。',
      properties: { source: str('本地路径或 http(s) 地址'), name: str('备注（≤12 字）'), tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈' } },
      required: ['source'],
      execute: async ({ source, name, tags }) => {
        if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '只有主人可以导入图片' }
        let buf
        try {
          buf = await fetchImage(String(source), { maxBytes: mediaLimits(ctx.root.config.media).maxImageMB * 1048576 })
        } catch (error) {
          return { ok: false, message: '这张图取不下来：' + error.message }
        }
        if (!currentAccount() || !hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '接收账号或权限已改变' }
        const r = await store.addFromBuffer(buf, { name: String(name || ''), tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'tool' })
        return r.ok ? { ok: true, message: r.existed ? '库里已经有这张了' : `收好了「${r.item.name || '未命名'}」` } : { ok: false, message: r.reason }
      },
    }))
    return tools.map(tool => ({ ...tool, execute: (args, env) => currentAccount() ? tool.execute(args, env) : Promise.resolve({ ok: false, message: '接收账号已改变' }) }))
  })
}
