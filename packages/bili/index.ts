// 内置模块：B 站。别人发来链接时她能「看」视频（标题、简介、字幕、热评）；定时自己去刷、评论、回评论，看到好玩的分享给主人。

import { readFileSync } from 'node:fs'
import { createBili } from './impl/live/duty.ts'
import { createGroupShare } from './impl/live/group-share.ts'
import { defineTool, str } from '../../src/tools/index.ts'
import { permOf, profileToolVisible, profilePermits } from '../../src/chat/policy/rules/access.ts'
import { avatarSource } from '../profile/index.ts'
import { resolvePainting } from '../../src/features/media/generate/paintings.ts'
import { segmentBytes } from '../../src/core/net/index.ts'
import { createDanmaku, danmakuPanelRequest } from './danmaku.ts'
import { createQrLogin } from './impl/login/qr-login.ts'
import { dataDir } from '../../src/core/store/index.ts'

export const name = 'B站'

export const version = '1.1.0'

export const description = '看别人发的 B 站视频；定时自己刷、评论、回评论；可选发弹幕；抽帧看画面、发截图；按权限改自己的头像 / 签名（bili_watch / bili_comment / bili_danmaku / qq_send_shot / bili_set_avatar / bili_set_sign）'

export const tab = 'bili'

export function apply(ctx, config) {
  const { hub } = ctx.host
  const lastImage = new Map() // chatId → 最近一张图的网址（给 bili_set_avatar 的 last 用）
  const groupShare = createGroupShare({
    getConfig: ctx.root.read, hub, log: ctx.logger,
    shotPathOf: (name) => bili.shotFileOf(name),
    captureShot: (bvid) => bili.captureShot(bvid),
    groupNameOf: (gid) => hub.groupName(gid),
  })
  ctx.on('message', (msg) => {
    const url = (msg.images || []).slice(-1)[0]?.data?.url
    if (url && /^https?:\/\//i.test(url)) lastImage.set(msg.chatId, url)
    return groupShare.handleReply(msg.chatId, msg.userId, msg.text)
  })
  const danmaku = createDanmaku(ctx)
  const bili = createBili({
    getConfig: ctx.root.read, hub, memory: ctx.lazy('memory'), log: ctx.logger, dsh: ctx.harness,
    afterBrowse: danmaku.afterBrowse, groupShare,
  })
  ctx.setInterval(60_000, () => (ctx.host.onebot?.state && ctx.host.onebot.state !== 'connected' ? undefined : bili.tick()), '刷B站')

  ctx.tool(({ chat, sessionId }) => {
    if (!ctx.root.config.bili.enabled || chat.kind === 'system') return []
    return [
      defineTool({
        name: 'bili_watch',
        description: '打开一个 B 站视频看看：读标题、简介、字幕和热评，看完再跟大家聊。别人发来 B 站链接、BV 号或分享卡片时用。link 填链接或 BV 号。',
        properties: { link: str('B 站链接、b23.tv 短链或 BV 号') },
        required: ['link'],
        execute: async ({ link }) => bili.watch(String(link || '')),
      }),
      defineTool({
        name: 'bili_comment',
        description: '在一个 B 站视频下发评论（只有主人让你发的时候才用）。link 填链接或 BV 号，text 是评论内容。要 @ 人就写 @完整昵称 并在后面空一格，@主人 会换成主人的 B 站号。',
        properties: { link: str('B 站链接或 BV 号'), text: str('评论内容') },
        required: ['link', 'text'],
        execute: async ({ link, text }) => {
          const perm = permOf(ctx.root.config, 'biliComment')
          if (perm === 'off') return { ok: false, message: '这个操作在面板里关掉了' }
          if (perm === 'owner' && !hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '只有主人能让我去发评论' }
          return bili.comment(String(link || ''), String(text || ''))
        },
      }),
      defineTool({
        name: 'qq_send_shot',
        description: '把你在 B 站视频里截到的画面发到当前聊天。主人说「发张截图」「给我看看你刷到的」「刚才那个视频长啥样」这类话时用。query 填视频标题里的词或想看的内容，不填就挑最近的一张。',
        properties: { query: str('可选：视频标题关键词，或想看的内容') },
        required: [],
        execute: async ({ query }) => {
          if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '截图只给主人看' }
          return bili.sendShot({ chatId: chat.chatId, query: String(query || '') })
        },
      }),
      defineTool({
        name: 'qq_list_shots',
        description: '看看你手上还有哪些 B 站截图（来自哪个视频、第几秒）。挑截图之前可以先看一眼。',
        properties: { query: str('可选，按视频标题筛选') },
        required: [],
        execute: async ({ query }) => {
          if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '截图只给主人看' }
          return bili.listShots(String(query || ''))
        },
      }),
    ]
  })

  ctx.tool(({ chat, sessionId }) => {
    const cfg = ctx.root.config
    if (!cfg.bili.enabled) return []
    const tools = []
    if (profileToolVisible(cfg, 'biliAvatar', chat)) tools.push(defineTool({
      name: 'bili_set_avatar',
      description: '换你自己 B 站账号的头像。image 填图片网址；填 last 就用这个聊天里刚才别人发的那张图；填「画作 #1」就用你自己刚画的那张（画完时会告诉你编号）。图超过 2MB 会自动缩小。',
      properties: { image: str('图片网址（http/https）／last（刚才那张图）／画作编号（如 #1）') },
      required: ['image'],
      execute: async ({ image }) => {
        const c = ctx.root.config
        if (!c.bili.enabled) return { ok: false, message: 'B 站没打开' }
        const p = profilePermits(c, 'biliAvatar', chat, hub.turnSendersAllOwner(sessionId))
        if (!p.ok) return p
        const chatId = hub.chatOfSession?.(sessionId) || chat.chatId
        const raw = String(image || '').trim()
        const looksLikePath = /^https?:\/\//i.test(raw) || /^[a-zA-Z]:[\\/]|^\/(?!\/)|^file:|^base64:/i.test(raw)
        const pref = /^画作/i.test(raw) ? (raw.replace(/^画作\s*[:：#]?\s*/i, '').trim() || '画作') : raw
        const isPainting = !looksLikePath && (/^#?\d{1,2}$/.test(pref) || /^画作$/i.test(pref) || /\.(png|jpe?g|webp|gif)$/i.test(pref))
        if (isPainting) {
          const painting = resolvePainting(chatId, pref)
          if (!painting) return { ok: false, message: `找不到画作 ${raw}（编号可能过期了，先让我画一张？）` }
          let buf
          try {
            buf = readFileSync(painting.path)
          } catch (error) {
            return { ok: false, message: '这张画的文件读不到了：' + error.message }
          }
          return bili.setAvatar(buf)
        }
        // ② 刚才那张图：优先取图片字节，拿不到再退回记下的网址
        if (!raw || /^(last|刚才|上一张|最近)/i.test(raw)) {
          const media = hub.recentMedia?.(chatId) || []
          const pick = media.filter((x) => !x.sticker).at(-1) || media.at(-1)
          if (pick) {
            try {
              const buf = await segmentBytes(pick.seg, ctx.host.onebot, { maxBytes: 10 * 1024 * 1024 })
              if (buf && buf.length) return bili.setAvatar(buf)
            } catch (error) { /* 退回网址 */ }
          }
          const previous = lastImage.get(chatId)
          if (!previous) return { ok: false, message: '最近半小时这个聊天里没人发过图片，先把图发过来' }
          return bili.setAvatar(previous)
        }
        // ③ 显式网址
        const src = avatarSource(raw)
        if (!src.ok) return src
        return bili.setAvatar(src.file)
      },
    }))
    if (!profileToolVisible(cfg, 'biliSign', chat)) return tools
    return [...tools, defineTool({
      name: 'bili_set_sign',
      description: '改你自己 B 站账号的个性签名（最多 70 字）。有人让你改 B 站签名时用。',
      properties: { text: str('新的签名') },
      required: ['text'],
      execute: async ({ text }) => {
        const c = ctx.root.config
        if (!c.bili.enabled) return { ok: false, message: 'B 站没打开' }
        const p = profilePermits(c, 'biliSign', chat, hub.turnSendersAllOwner(sessionId))
        if (!p.ok) return p
        return bili.setSign(text)
      },
    })]
  })

  ctx.server.get('/bili/state', async () => ({ ok: true, ...bili.state(), account: await bili.account() }))
  ctx.server.get('/bili/account', async () => bili.account(true))
  ctx.server.get('/bili/run', async () => bili.run({ force: true }))
  ctx.server.get('/bili/replies', async () => bili.checkReplies())
  ctx.server.get('/bili/danmaku/state', async () => danmaku.state())
  for (const action of ['inspect', 'send']) {
    ctx.server.get('/bili/danmaku/' + action, async (req) => {
      if (!danmakuPanelRequest(req)) return { ok: false, message: '请从 B 站面板发起弹幕操作' }
      return danmaku[action](await ctx.host.http.body(req))
    })
  }
  ctx.tool(({ chat, level, sessionId }) => {
    const cfg = ctx.root.config
    if (!cfg.bili.enabled || !cfg.bili.danmakuEnabled || level !== 'full'
      || chat.kind !== 'private' || String(chat.userId) !== String(cfg.ownerQQ)) return []
    return defineTool({
      name: 'bili_danmaku',
      description: '只有主人明确让你发弹幕时才用。link 为视频或番剧链接；seconds 为当前分P内的出现时间（秒），part 为分P或ss链接的选集序号。不要替主人猜时间或内容。',
      properties: {
        link: str('B站视频 / 番剧完整链接或 BV、av、ep、ss 编号'), text: str('一行弹幕文字，最多100字'),
        seconds: { type: 'number', minimum: 0, description: '出现时间（秒）' },
        part: { type: 'integer', minimum: 1, description: '分P / 选集序号，默认1' },
      },
      required: ['link', 'text', 'seconds'],
      execute: async ({ link, text, seconds, part }) => {
        if (!hub.turnSendersAllOwner(sessionId)) return { ok: false, message: '只有主人私聊让我发弹幕才行' }
        return danmaku.send({ video: link, text, seconds, part })
      },
    })
  })
  // 截图库（面板分页、手动删）
  ctx.server.get('/bili/shots', async (req) => {
    const q = req ? ctx.host.http.query(req) : {}
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(q.limit) || 25)))
    const offset = Math.max(0, Math.trunc(Number(q.offset) || 0))
    return { ...bili.libraryShots({ limit, offset }), limit: ctx.root.config.bili.shotLibrary }
  })
  ctx.server.get('/bili/shot/image', async (req, res) => {
    const p = bili.shotFileOf(ctx.host.http.query(req).file)
    if (!p) return ctx.host.http.send(res, 404, '')
    return ctx.host.http.send(res, 200, readFileSync(p), 'image/jpeg')
  })
  ctx.server.get('/bili/shot/delete', async (req) => bili.deleteShot(String((await ctx.host.http.body(req)).file || '')))

  // 扫码登录：机器人自己起浏览器拿一张只属于它的票，拿到后自动写配置（只写一次）
  const qr = createQrLogin({ log: ctx.logger, dataDir })
  const savedQr = new Set()
  ctx.server.get('/bili/qr/start', async () => qr.start())
  ctx.server.get('/bili/qr/status', async (req) => {
    const id = String(ctx.host.http.query(req).id || '')
    const r: any = await qr.poll(id)
    if (r.state !== 'done') return { ok: r.state !== 'error', state: r.state, message: r.message }
    if (!r.creds) return { ok: false, state: 'error', message: '票没拿到，重新生成一个' }
    if (savedQr.has(id)) return { ok: true, state: 'done', account: r.account }
    try {
      const { sessdata, biliJct, buvid3, buvid4, dedeUserId } = r.creds
      ctx.root.update({ bili: { sessdata, biliJct, buvid3, buvid4, dedeUserId } })
      savedQr.add(id)
      return { ok: true, state: 'done', account: r.account }
    } catch (e) {
      return { ok: false, state: 'error', message: '票拿到了但保存失败：' + e.message }
    }
  })
  ctx.server.get('/bili/qr/cancel', async (req) => {
    const id = String((await ctx.host.http.body(req)).id || '')
    savedQr.delete(id)
    return qr.cancel(id)
  })
  ctx.effect(() => qr.dispose())
  return bili
}
