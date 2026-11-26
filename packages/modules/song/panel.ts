import { ownerTarget, ownerTargets } from './destination.ts'
import { checkRoot, listDrives } from './studio/env/install.ts'

export function installSongPanel(ctx, song, request) {
  const http = ctx.http
  ctx.server.get('/song/status', async () => ({ ok: true, ...song.status(), targets: ownerTargets(ctx) }))
  ctx.server.post('/song/install', async () => song.install())
  ctx.server.get('/song/root/check', async (req) => ({ ok: true, ...checkRoot(http.query(req).path || '') }))
  ctx.server.get('/song/drives', async () => ({ ok: true, list: listDrives() }))
  ctx.server.get('/song/search', async (req) => {
    try { return { ok: true, list: await song.search(http.query(req).q || '') } } catch (error) { return { ok: false, message: error.message, list: [] } }
  })
  ctx.server.get('/song/account', async () => song.account())
  ctx.server.post('/song/import', async (req) => {
    const name = http.query(req).name || ''
    try {
      const buf = await http.raw(req, 1024 * 1024 * 1024)
      if (!buf.length) return { ok: false, message: '文件是空的' }
      const r = song.importModels(name, buf)
      if (r.ok) ctx.logger.info('导入音色：' + r.message)
      return r
    } catch (error) {
      return { ok: false, message: '导入失败：' + error.message }
    }
  })
  ctx.server.post('/song/voice/delete', async (req) => song.deleteVoice(String((await http.body(req)).id || '')))
  ctx.server.post('/song/request', async (req) => {
    const b = await http.body(req)
    const target = ownerTarget(ctx, b.target)
    if (!target) return { ok: false, message: '请指定已上线的主人私聊账号' }
    return request({ song: b.song, songId: b.songId, pitch: b.pitch, voice: b.voice, startSec: b.startSec, durationSec: b.durationSec }, target,
      () => ctx.isOwner(target.id, target.platform, target.botId))
  })
}
