import { existsSync, readFileSync } from 'node:fs'
import { formatBytes } from '../../../src/core/net/index.ts'
import { PANEL_UPLOAD_MAX_BYTES, type createStickerStore } from './store.ts'

export function stickerPanel(ctx, select: () => ReturnType<typeof createStickerStore>) {
  const http = ctx.http
  ctx.server.get('/stickers', async (req) => {
    const q = http.query(req)
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(q.limit) || 40)))
    const offset = Math.max(0, Math.trunc(Number(q.offset) || 0))
    const all = select().library().items.slice().reverse()
    return { ok: true, items: all.slice(offset, offset + limit), total: all.length, hasMore: offset + limit < all.length }
  })
  ctx.server.get('/sticker/image', async (req, res) => {
    const it = select().library().items.find((i) => i.md5 === http.query(req).md5)
    if (!it || !existsSync(select().stickerPath(it))) return http.send(res, 404, '')
    const ext = it.file.split('.').pop()
    http.send(res, 200, readFileSync(select().stickerPath(it)), ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg')
  })
  ctx.server.post('/sticker/rename', async (req) => {
    const b = await http.body(req)
    return select().rename(b.md5, b.name, Array.isArray(b.tags) ? b.tags : undefined)
  })
  ctx.server.post('/sticker/delete', async (req) => {
    const b = await http.body(req)
    return select().remove(b.md5, { fromQQ: b.fromQQ !== false })
  })

  ctx.server.post('/sticker/delete-batch', async (req) => {
    const b = await http.body(req)
    const list = Array.isArray(b.md5s) ? b.md5s : b.md5 ? [b.md5] : []
    return select().removeMany(list, { fromQQ: b.fromQQ !== false })
  })

  ctx.server.post('/sticker/caption-all', async (req) => {
    const b = await http.body(req)
    return select().captionLibrary({ all: b.all === true, limit: Number(b.limit) || 0 })
  })
  ctx.server.get('/sticker/caption-status', async () => ({ ok: true, ...select().captionStatus() }))
  ctx.server.post('/sticker/caption-stop', async () => ({ ok: true, ...select().captionCancel() }))
  ctx.server.post('/sticker/import-qq', async () => select().importFromQQ())
  ctx.rule(() => '- 主人让你存某个表情（「存一下」「导入这个表情」）时用 qq_save_sticker；让你把 QQ 收藏里的表情导进来时用 qq_import_qq_stickers。别人让你存，不用理。')
  ctx.server.post('/sticker/upload', async (req) => {
    const b = await http.body(req)
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64')
    if (!buf.length) return { ok: false, message: '图片是空的' }


    if (buf.length > PANEL_UPLOAD_MAX_BYTES) return { ok: false, message: `图片太大：${formatBytes(buf.length)}，面板上传最多 ${formatBytes(PANEL_UPLOAD_MAX_BYTES)}` }
    return select().addFromBuffer(buf, { name: b.name || '', tags: b.tags || [], from: 'panel' })
  })
}
