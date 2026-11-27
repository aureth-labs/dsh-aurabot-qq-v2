import { isLegacyScope, scopeOfRoom } from '../../../core/bot/room.ts'
import { isOwnerOf } from '../../../core/config/owners.ts'

const scopeOf = (where) => {
  if (where?.platform && where?.botId) return { platform: String(where.platform), botId: String(where.botId) }
  return where?.chatId ? scopeOfRoom(where.chatId) : null
}
const legacy = (where) => {
  const scope = scopeOf(where)
  return !scope || isLegacyScope(scope.platform, scope.botId)
}

export const LEVELS = ['full', 'social', 'chat']

/**
 * @param {object} cfg 插件配置
 * @param {{kind:'private'|'group', userId:string, groupId:string}} msg
 * @returns {{allowed: boolean, reason: string}}
 */
export function checkAllowed(cfg, msg) {
  if (!legacy(msg)) return { allowed: true, reason: '身份目录已放行' }
  const owner = String(cfg.ownerQQ || '')
  if (msg.kind === 'private') {
    if (msg.userId === owner) return { allowed: true, reason: '主人' }
    const list = (cfg.allow?.private || []).map(String)
    return list.includes(msg.userId)
      ? { allowed: true, reason: '私聊白名单' }
      : { allowed: false, reason: '不在私聊白名单' }
  }
  const groups = (cfg.allow?.groups || []).map(String)
  return groups.includes(msg.groupId)
    ? { allowed: true, reason: '群白名单' }
    : { allowed: false, reason: '不在群白名单' }
}

export function groupResponseMode(cfg, groupId, where?) {
  if (where && !legacy(where)) return 'chat'
  const id = String(groupId)
  if (!(cfg.allow?.groups || []).map(String).includes(id)) return 'off'
  return (cfg.group?.moduleOnlyGroups || []).map(String).includes(id) ? 'modules' : 'chat'
}
export const GROUP_RESPONSE_LABELS = { off: '不响应群消息', modules: '仅模块', chat: '允许 AI 聊天' }

export function shouldObserveGroup(cfg, msg) {
  return cfg.enabled === true && !cfg.debug && cfg.memory?.enabled === true &&
    msg.kind === 'group' && !checkAllowed(cfg, msg).allowed &&
    Array.isArray(cfg.memory.passiveGroups) && cfg.memory.passiveGroups.includes(String(msg.groupId))
}

/** 群聊里给不给本机工具：off = 不给；owner = 只有主人说话那一轮给。
 * 没有「谁问都给」这一档——群里任何人都能驱动本机读写，权限面太大，明确不做。 */
export const GROUP_OWNER_TOOLS = ['off', 'owner']

/**
 * 这个群当前该给哪一档。ownerToolsGroups 非空时只在列出的群里生效（留空 = 所有群）。
 * @returns {'off'|'owner'}
 */
export function groupOwnerTools(cfg, chat) {
  if (!chat || chat.kind !== 'group') return 'off'
  const mode = cfg?.group?.ownerTools
  if (mode !== 'owner') return 'off'
  const list = (cfg?.group?.ownerToolsGroups || []).map(String).filter(Boolean)
  if (list.length && !list.includes(String(chat.groupId || ''))) return 'off'
  return mode
}

export function levelFor(cfg, chat) {
  if (chat.kind === 'private' && isOwner(cfg, chat.userId, chat)) {
    return LEVELS.includes(cfg.ownerLevel) ? cfg.ownerLevel : 'full'
  }
  // group-full 不叫 full：插件自己的工具还要按 social 语义挂（模块里到处是 level === 'full' 判主人私聊），
  // 真正的开关由 hub 按这一轮说话的人做（tools.restrict 收走核心工具）。
  if (chat.kind === 'group' && groupOwnerTools(cfg, chat) !== 'off') return 'group-full'
  return 'social'
}

export function presetFor(level, cfg, _chat?) {
  if (level === 'group-full') return 'aurabot-group-owner'
  if (level !== 'full') return 'aurabot-social'
  return cfg && cfg.longTasks ? 'aurabot-private-long' : 'aurabot-private'
}

export function isOwner(cfg, userId, where?) {
  if (String(userId || '') === '') return false
  if (legacy(where)) return String(userId) === String(cfg.ownerQQ || '')
  const scope = scopeOf(where)
  return isOwnerOf(cfg, String(userId), scope.platform, scope.botId)
}

export function privateCapabilityAllowed(cfg, chat, capability) {
  if (chat?.kind !== 'private') return false
  const userId = String(chat.userId || '')
  if (!userId || !(cfg.allow?.private || []).map(String).includes(userId)) return false
  return (cfg.capabilityAllow?.[capability] || []).map(String).includes(userId)
}

export const PROFILE_PERM_LEVELS = ['off', 'owner', 'all']
export const DOUYIN_PERM_KEYS = ['douyinBrowse', 'douyinLike', 'douyinComment', 'douyinShareOwner', 'douyinDm']
export const HEYBOX_PERM_KEYS = ['heyboxBrowse', 'heyboxLike', 'heyboxComment', 'heyboxPost']
export const PROFILE_PERM_KEYS = ['qqNickname', 'qqSignature', 'qqAvatar', 'qqFriendRequest', 'whitelist', ...DOUYIN_PERM_KEYS, ...HEYBOX_PERM_KEYS]
export const profilePermDefault = (key) => 'owner'
export const permOf = (cfg, key) => {
  const p = cfg?.profilePerms?.[key]
  return PROFILE_PERM_LEVELS.includes(p) ? p : profilePermDefault(key)
}

export function profileToolVisible(cfg, key, chat) {
  const p = permOf(cfg, key)
  if (p === 'all') return chat.kind === 'private' || chat.kind === 'group'
  if (p === 'owner') return chat.kind === 'private' && String(chat.userId) === String(cfg.ownerQQ || '')
  return false
}

export function profilePermits(cfg, key, chat, allOwner) {
  const p = permOf(cfg, key)
  if (p === 'off') return { ok: false, message: '这个操作在面板里关掉了' }
  if (!profileToolVisible(cfg, key, chat)) return { ok: false, message: '这里不能做这个操作' }
  if (p === 'owner' && !allOwner) return { ok: false, message: '只有主人私聊让我改才行' }
  return { ok: true }
}
