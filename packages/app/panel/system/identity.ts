import type { IdentityDirectory, SubjectKey, SubjectKind } from '../../../../src/core/store/identity.ts'

const kinds = new Set<SubjectKind>(['user', 'group', 'private', 'channel'])
const text = (input: unknown, max: number) => typeof input === 'string' && input.length <= max ? input.trim() : ''

function keyOf(body): SubjectKey {
  const platform = text(body.platform, 128), botId = text(body.botId, 256), id = text(body.id, 512)
  if (!platform || !id || !kinds.has(body.kind) || typeof body.botId !== 'string' || body.botId.trim() !== botId) {
    throw new Error('请填写平台、对象类型和平台 ID')
  }
  if (!botId && body.kind !== 'user') throw new Error('频道需要指定机器人实例')
  return { platform, botId, kind: body.kind, id }
}

export function registerIdentityRoutes(http, directory: IdentityDirectory) {
  http.route('/panel/identities', req => {
    if (req.method !== 'GET') return { ok: false, message: '请使用 GET 查询' }
    const q = http.query(req)
    const table = q.table === 'channels' ? 'channels' : 'users'
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(q.limit)) || 30))
    const offset = Math.max(0, Math.trunc(Number(q.offset)) || 0)
    return { ok: true, ...directory.list(table, text(q.platform, 128), text(q.botId, 256), text(q.q, 512), limit, offset) }
  })
  http.route('/panel/identities/edit', async req => {
    if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || ''))
      return { ok: false, message: '权限修改需要 POST JSON 请求' }
    const body = await http.readBody(req)
    const key = keyOf(body)
    if (body.action === 'remove') directory.remove(key)
    else if (body.action === 'save') {
      if (!key.botId && body.level !== 0) throw new Error('跨实例规则仅用于封禁用户')
      if (typeof body.alias !== 'string' || body.alias.length > 128) throw new Error('备注最长 128 字')
      directory.edit(key, body.alias.trim(), body.level)
    } else throw new Error('请选择保存或移除')
    return { ok: true }
  })
}
