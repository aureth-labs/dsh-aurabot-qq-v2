import type { Owner } from '../../../core/config/owners.ts'
import { ownerId } from '../../../core/config/owners.ts'
// 群消息入口过滤；纯配置判断，不联网、不创建计时器。

/** 一条「不回应」规则：在哪些群里不理这个人。 */
export interface MemberFilterRule {
  userId: string
  scope: 'all' | 'groups'
  groups: string[]
}

/** memberFilter 配置段的归一化结果。 */
export interface MemberFilterConfig {
  enabled: boolean
  rules: MemberFilterRule[]
}

/** 归一化时的宽松入参：配置文件里可能是任意形状。 */
interface RawMemberFilter {
  enabled?: unknown
  rules?: unknown
}

/** 过滤判断只需要这两段配置。 */
interface FilterConfig {
  owners?: Owner[]
  memberFilter?: MemberFilterConfig
}

/** 过滤判断只需要这几个字段。 */
interface FilterMessage {
  kind?: string
  userId?: string | number
  groupId?: string | number
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{4,11}$/.test(value)

export function validMemberFilter (value: unknown): boolean {
  const v = value as RawMemberFilter | null
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).every(k => ['enabled', 'rules'].includes(k)) && typeof v.enabled === 'boolean' &&
    Array.isArray(v.rules) && v.rules.length <= 100 &&
    new Set(v.rules.map((r: MemberFilterRule) => r?.userId)).size === v.rules.length &&
    v.rules.every((r: MemberFilterRule) => r && typeof r === 'object' && !Array.isArray(r) &&
      Object.keys(r).every(k => ['userId', 'scope', 'groups'].includes(k)) && id(r.userId) &&
      ['all', 'groups'].includes(r.scope) && Array.isArray(r.groups) && r.groups.length <= 100 && r.groups.every(id))
}

export function normalizeMemberFilter (value: RawMemberFilter | null | undefined): MemberFilterConfig {
  // 无效文件配置不会变成「所有群」；面板另行严格拒绝无效输入。
  const seen = new Set<string>()
  const rules: MemberFilterRule[] = []
  for (const r of Array.isArray(value?.rules) ? value.rules as MemberFilterRule[] : []) {
    if (!r || !id(r.userId) || seen.has(r.userId) || !['all', 'groups'].includes(r.scope) || !Array.isArray(r.groups) || !r.groups.every(id)) continue
    seen.add(r.userId)
    rules.push({ userId: r.userId, scope: r.scope, groups: [...new Set(r.groups)].slice(0, 100) })
    if (rules.length === 100) break
  }
  return { enabled: value?.enabled !== false, rules }
}

export function ignoredGroupMember (cfg: FilterConfig, msg: FilterMessage | null | undefined): boolean {
  if (msg?.kind !== 'group' || cfg.memberFilter?.enabled !== true) return false
  const user = String(msg.userId || '')
  const group = String(msg.groupId || '')
  if (!id(user) || !id(group) || user === String(ownerId(cfg) || '')) return false
  return (cfg.memberFilter.rules || []).some(r => r.userId === user &&
    (r.scope === 'all' || (r.scope === 'groups' && r.groups.includes(group))))
}
