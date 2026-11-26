import { commandList } from '../../../commands/dispatch.ts'
import {
  privatePermissionCatalog,
  changePermissions,
  changePrivateWhitelist,
} from '../../../../src/chat/policy/rules/permission.ts'

export function registerPermissionRoutes({ http, logger, mods, getConfig, setConfig, onebot }) {
  const { route, query, readBody } = http

  route('/logs', async (req) => {
    const q = query(req)
    return {
      ok: true,
      entries: logger.recent(Number(q.limit) || 300, { level: (q.level || '') as never, area: q.area || '' }),
    }
  })

  route('/commands', async () => ({ ok: true, list: commandList(mods.commands()) }))
  route('/permissions/catalog', async () => ({ ok: true, list: privatePermissionCatalog(mods.commands()) }))
  route('/permissions/subject', async (req) => {
    if (
      req.method !== 'POST' ||
      !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))
    )
      return { ok: false, message: '权限修改需要 POST JSON 请求' }
    const body = await readBody(req)
    const result = changePermissions(getConfig(), body || {}, mods.commands())
    if (!result.ok) return result
    setConfig(result.config)
    return { ok: true }
  })
  route('/permissions/private-batch', async (req) => {
    if (
      req.method !== 'POST' ||
      !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))
    )
      return { ok: false, message: '私聊名单修改需要 POST JSON 请求' }
    const body = await readBody(req)
    const result: any = changePrivateWhitelist(getConfig(), body || {})
    if (!result.ok) return result
    if (result.config) setConfig(result.config)
    return {
      ok: true,
      changed: result.changed,
      skipped: result.skipped,
      message: `已加入私聊白名单 ${result.changed} 人，跳过 ${result.skipped} 个重复、已存在或主人号码`,
    }
  })
  route('/permissions/friends', async () => {
    try {
      const result = await onebot.call('get_friend_list', {}, { timeoutMs: 8000 })
      const friends = Array.isArray(result) ? result : result?.friends || []
      return {
        ok: true,
        friends: friends
          .map((friend) => ({
            id: String(friend.user_id || ''),
            name: String(friend.remark || friend.nickname || ''),
          }))
          .filter(({ id }) => /^\d{5,12}$/.test(id)),
      }
    } catch (error) {
      return { ok: false, message: `读取 QQ 好友失败：${error.message || String(error)}` }
    }
  })
}
