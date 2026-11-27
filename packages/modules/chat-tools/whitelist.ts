import { isOwnerOf } from '../../../src/core/config/owners.ts'
import { whitelistPermits, whitelistVisible } from '../../../src/chat/policy/rules/access.ts'
import { defineTool, str } from '../../../src/tools/index.ts'

export function cleanId(value) {
  const id = String(value ?? '').trim()
  return /^[\w.@:-]{1,64}$/.test(id) ? id : ''
}

export function planWhitelist(cfg, { action, kind, id }: Record<string, unknown>, scope = { platform: 'qq', botId: '' }, selfId = '') {
  const act = String(action || '').trim().toLowerCase()
  if (!['add', 'remove'].includes(act)) return { ok: false, message: 'action 只能是 add 或 remove' }
  const k = String(kind || '').trim().toLowerCase()
  if (!['private', 'group'].includes(k)) return { ok: false, message: 'kind 只能是 private（私聊的人）或 group（群）' }
  const n = cleanId(id)
  if (!n) return { ok: false, message: '编号不对：填用户 ID 或群 ID' }
  const label = k === 'private' ? '用户' : '群'
  const listName = k === 'private' ? '私聊白名单' : '群白名单'
  if (k === 'private' && isOwnerOf(cfg, n, scope.platform, scope.botId))
    return act === 'remove' ? { ok: false, message: '主人不能被移出私聊白名单' } : { ok: true, message: '主人本来就能私聊，不用加白名单' }
  if (k === 'private' && act === 'add' && n === String(selfId)) return { ok: false, message: '这是我自己的号，不用加' }
  const list = ((k === 'private' ? cfg.allow?.private : cfg.allow?.groups) || []).map(String)
  const has = list.includes(n)
  const modeNote = k === 'group' && (cfg.group?.moduleOnlyGroups || []).includes(n) ? '；仍为仅模块，@ 也不触发 AI。要恢复 AI 聊天，请修改群响应模式' : ''
  if (act === 'add') {
    if (has) return { ok: true, message: `${label} ${n} 已经在${listName}里了${modeNote}` }
    return { ok: true, changed: true, message: `${label} ${n} 加进${listName}了${modeNote}`, next: [...list, n] }
  }
  if (!has) return { ok: true, message: `${label} ${n} 本来就不在${listName}里` }
  return { ok: true, changed: true, message: `${label} ${n} 从${listName}移出了`, next: list.filter((x) => x !== n) }
}

export function whitelistTool(ctx, { chat, sessionId, target, selfId }) {
  const scope = { platform: target.platform, botId: target.botId }
  if (!whitelistVisible(ctx.root.config, chat, scope)) return null
  return defineTool({
    name: 'chat_whitelist',
    description: '改白名单：action 填 add（加进）或 remove（移出），kind 填 private（某个人可以私聊你）或 group（允许群消息交给模块；是否 AI 接话另看群响应模式），id 填用户 ID 或群 ID。主人不能被移出。群模式用 group_settings 查询或修改。',
    properties: { action: str('add 加进 / remove 移出'), kind: str('private 私聊的人 / group 群'), id: str('用户 ID 或群 ID') },
    required: ['action', 'kind', 'id'],
    execute: async (args) => {
      const allowed = whitelistPermits(ctx.root.config, chat, ctx.turnFromOwner(sessionId), scope)
      if (!allowed.ok) return allowed
      const key = String(args.kind).trim().toLowerCase() === 'private' ? 'private' : 'groups'
      let result = planWhitelist(ctx.root.config, args, scope, selfId)
      if (!result.ok || !result.changed) return result
      ctx.root.update((cur) => {
        result = planWhitelist(cur, args, scope, selfId)
        if (!result.ok || !result.changed) return cur
        return { ...cur, allow: { ...cur.allow, [key]: result.next } }
      })
      return { ok: result.ok, message: result.message }
    },
  })
}
