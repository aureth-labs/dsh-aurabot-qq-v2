import { commandList } from '../../../modules/commands/dispatch.ts'
import {
  privatePermissionCatalog,
  changePermissions,
  changePrivateWhitelist,
} from '../../../../src/chat/policy/rules/permission.ts'

export function registerPermissionRoutes({ http, logger, mods, getConfig, setConfig, bots, defaultBot }) {
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
  route('/permissions/friends', async (req) => {
    try {
      const { platform, botId } = query(req)
      const bot = botId ? bots.get(String(botId), platform || undefined) : defaultBot()
      if (!bot || platform && bot.platform !== platform) return { ok: false, message: '未找到对应的机器人实例' }
      const friends = (await bot.getFriendList()).map(user => ({ id: user.id, name: user.name || user.nick || user.id }))
      return { ok: true, platform: bot.platform, botId: bot.id, friends }
    } catch (error) {
      return { ok: false, message: '读取好友失败：' + (error.message || String(error)) }
    }
  })
}
