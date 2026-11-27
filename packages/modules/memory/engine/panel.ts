import { ownerId } from '../../../../src/core/config/owners.ts'
import { roomId, isGroupRoom } from '../../../../src/core/bot/room.ts'
// 面板视图：人物墙、关系、群印象、梗概、时间线与推荐。只读或只改面板可见的字段。

import type { GistsOptions, PersonaNotesOptions, PersonaPersonOptions, RecommendationsOptions, SaveChatOptions, SavePersonaPersonOptions, TimelineOptions } from './types.ts'

export interface PanelViewDeps {
  [key: string]: any
}

export function createPanelViews(deps: PanelViewDeps) {
  const { load, save, list, shortTermOf, getConfig, hub, socialHistory, personTags, relationHas, rememberedRelation, rememberedItem, rememberedRow, relationText, remembers, canProfile, relationPeople, relationPair, profileOf, insightsOf, styleOf, factTiers, isCurrent, memoryPlatforms, saidTime, eventText, validityText, memoryVisible, search, buildIndex, index, RELATED_LIMIT } = deps  /** 面板上的人物墙：画像、个人事实和个人梗概都可以让一个人出现在列表里。 */
  function personaOverview() {
    const s = load()
    const people = new Map()
    const spoken = new Map()
    const rememberedGroups = new Map()
    const ensure = (qq) => {
      const id = String(qq || '')
      if (!/^\d+$/.test(id)) return null
      if (!people.has(id)) {
        const profile = (s.profiles || {})[id] || {}
        const stale = Boolean((s.dirtyProfiles || {})[id])
        people.set(id, { ...profile, qq: id, notes: 0, lastActive: 0, ...(stale && profile.text ? { stale: true } : {}) })
      }
      return people.get(id)
    }
    for (const qq of Object.keys(s.profiles || {})) ensure(qq)
    for (const qq of Object.keys(s.shortTerm || {})) if (shortTermOf(qq)) ensure(qq)
    for (const r of s.relations || []) {
      for (const [qq, name] of [[r.subjQq, r.subj], [r.objQq, r.obj]]) {
        const p = ensure(qq)
        if (p && !p.name) p.name = name
      }
    }
    for (const key of Object.keys(s.insights || {})) {
      const p = key.startsWith('qq:') ? ensure(key.slice(3)) : null
      if (p && !p.name) p.name = (s.insightNames || {})[key] || ''
    }
    for (const m of list('')) {
      const speaker = String(m.speaker || '')
      if (speaker) {
        spoken.set(speaker, Math.max(spoken.get(speaker) || 0, Number(saidTime(m)) || 0))
        if (/^group:\d+$/.test(String(m.chatId || ''))) {
          if (!rememberedGroups.has(speaker)) rememberedGroups.set(speaker, new Set())
          rememberedGroups.get(speaker).add(roomId(m.chatId))
        }
      }
      const p = ensure(m.about)
      if (!p) continue
      p.notes++
      if (!p.name && m.aboutName) p.name = m.aboutName
    }
    for (const g of s.gists || []) if (g.kind === 'gist') ensure(g.about)
    for (const [qq, at] of spoken) if (people.has(qq)) people.get(qq).lastActive = at
    // 画像的 at 是整理时间，不是发言时间；用仍保留的聊天流水补上最近活跃时间。
    if (people.size) for (const [qq, activity] of socialHistory()) {
      const p = people.get(qq)
      if (!p) continue
      p.interactions = activity.interactions
      p.lastInteraction = activity.lastInteraction
      p.closeness = Math.log2(1 + activity.interactions) * 4 + (activity.lastInteraction ? 2 / (1 + Math.max(0, Date.now() - activity.lastInteraction) / (7 * 86400_000)) : 0)
      p.lastActive = Math.max(p.lastActive, activity.at)
      for (const id of activity.groups) { if (!rememberedGroups.has(qq)) rememberedGroups.set(qq, new Set()); rememberedGroups.get(qq).add(id) }
    }
    const owner = String(ownerId(getConfig()) || '')
    return [...people.values()].map((p) => ({ ...p, tags: personTags(p.qq), groups: [...(rememberedGroups.get(p.qq) || [])].map((id) => ({ id, name: hub?.groupNames?.get?.(id) || id })), hasRelations: (s.relations || []).some((r) => relationHas(r, p.qq, [p.name, p.alias].filter(Boolean))), hasInsights: Boolean((s.insights || {})[`qq:${p.qq}`]?.length), isOwner: Boolean(owner && p.qq === owner) }))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || (b.closeness || 0) - (a.closeness || 0) || a.qq.localeCompare(b.qq))
  }

  /** 星图只是现有人物、关系和互动亲疏的投影，不另存节点和边。 */
  function personaGraph() {
    const people = personaOverview()
    const nodes = people.filter((p) => remembers(p.qq))
      .map((p) => ({ qq: p.qq, name: personName(p), closeness: p.closeness || 0, interactions: p.interactions || 0, isOwner: p.isOwner }))
    const ids = new Set(nodes.map((p) => p.qq))
    const names = new Map()
    for (const p of people) for (const name of new Set([p.name, p.alias].filter(Boolean))) {
      if (!names.has(name)) names.set(name, [])
      names.get(name).push(p.qq)
    }
    const resolve = (qq, name) => qq ? ids.has(String(qq)) ? String(qq) : '' : names.get(name)?.length === 1 && ids.has(names.get(name)[0]) ? names.get(name)[0] : ''
    const links = (load().relations || []).filter(rememberedRelation).flatMap((r) => {
      const source = resolve(r.subjQq, r.subj), target = resolve(r.objQq, r.obj)
      return source && target && source !== target ? [{ id: r.id, source, target, label: r.pred, text: relationText(r), chatId: r.chatId }] : []
    })
    return { nodes, links }
  }

  function personaPerson(qq, { notesLimit = 20 } : PersonaPersonOptions = {}) {
    const id = String(qq || '')
    if (!/^\d+$/.test(id)) return null
    const person = personaOverview().find((p) => p.qq === id)
    if (!person) return null
    const allNotes = list('').filter((m) => String(m.about || '') === id)
    const notes = allNotes.slice(0, Math.max(0, Math.min(500, Math.trunc(Number(notesLimit) || 20))))
    return {
      person,
      factTiers: factTiers(getConfig().memory.tierDays),
      shortTerm: shortTermOf(id),
      notes,
      notesTotal: allNotes.length,
      notesLive: allNotes.filter((m) => isCurrent(m)).length,
      notesOld: allNotes.filter((m) => !isCurrent(m)).length,
      gists: gists({ about: id }),
      insights: insightsOf(`qq:${id}`),
      styles: styleOf(`qq:${id}`),
      relations: (load().relations || []).filter((r) => relationHas(r, id, [person.name, person.alias].filter(Boolean))).map((r) => ({ ...r, text: relationText(r) })),
    }
  }

  /** 人物详情里的 notes 分页：先过滤再切片，不把整份 notes 发给面板。 */
  function personaNotes(qq, { limit = 20, offset = 0 } : PersonaNotesOptions = {}) {
    const id = String(qq || '')
    if (!/^\d+$/.test(id)) return null
    if (!personaOverview().some((p) => p.qq === id)) return null
    const all = list('').filter((m) => String(m.about || '') === id)
    const start = Math.max(0, Math.trunc(Number(offset) || 0))
    const take = Math.max(0, Math.min(100, Math.trunc(Number(limit) || 20)))
    const listPage = all.slice(start, start + take)
    return { list: listPage, total: all.length, hasMore: start + listPage.length < all.length }
  }

  /** 只改面板允许编辑的字段，保留旧画像的名字和其他元数据。 */
  function savePersonaPerson(qq, patch : SavePersonaPersonOptions = {}) {
    const id = String(qq || '')
    if (!/^\d+$/.test(id)) return { ok: false, message: 'QQ 号不对' }
    const fields = ['alias', 'style', 'persona', 'handle', 'text']
    if (!remembers(id) && fields.some((key) => String(patch?.[key] || '').trim() && patch[key] !== load().profiles?.[id]?.[key])) return { ok: false, message: '先撤销不再记住，才能编辑人物印象' }
    if (!patch || ![...fields, 'tags'].some((key) => Object.hasOwn(patch, key))) return { ok: false, message: '没有要保存的内容' }
    if (Object.hasOwn(patch, 'tags')) {
      if (!Array.isArray(patch.tags) || patch.tags.length > 8 || patch.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || [...tag.trim()].length > 8)) return { ok: false, message: '标签最多 8 个，每个最多 8 个字' }
      const tags = patch.tags.map((tag) => tag.trim())
      if (new Set(tags).size !== tags.length || (tags.includes('喜欢') && tags.includes('讨厌'))) return { ok: false, message: '标签不能重复，喜欢和讨厌不能同时选' }
      if (id === String(ownerId(getConfig()) || '') && tags.includes('讨厌')) return { ok: false, message: '不能讨厌主人' }
    }
    const s = load()
    if (!s.profiles?.[id] && fields.some((key) => String(patch[key] || '').trim()) && !canProfile(id)) return { ok: false, message: '还没有和这个人直接互动，暂不建立人物画像' }
    s.profiles = s.profiles || {}
    const profile = { ...(s.profiles[id] || {}) }
    if (Object.hasOwn(patch, 'tags')) { profile.tags = patch.tags.map((tag) => tag.trim()); profile.tagsBy = 'owner' }
    for (const key of fields) if (Object.hasOwn(patch, key)) profile[key] = String(patch[key] ?? '').trim()
    profile.at = Date.now()
    s.profiles[id] = profile
    if (s.dirtyProfiles) delete s.dirtyProfiles[id]
    s.rev = (s.rev || 0) + 1
    save(s)
    return { ok: true, message: '人物印象已保存' }
  }

  // ---------- 人物关系：谁和谁是什么关系。和事实一样，别人只看得到同一个聊天里来的 ----------
  function personNames(qq, state = load()) {
    const p = (state.profiles || {})[String(qq)] || {}
    return [p.name, p.alias].filter(Boolean)
  }
  function visibleRelations(chat, state = load()) {
    const ownerPrivate = chat?.kind === 'private' && String(chat.userId) === String(ownerId(getConfig()) || '')
    return (state.relations || []).filter((r) => rememberedRelation(r, state) && (ownerPrivate || r.chatId === chat?.chatId))
  }
  /** 同一对人只留最新的关系：分手了、换了说法都直接盖掉。 */
  function putRelation(s, relation) {
    if (!rememberedRelation(relation) || [...relationPeople(relation, s), relation.speaker].filter(Boolean).some((qq) => !canProfile(qq))) return false
    s.relations = (s.relations || []).filter((r) => relationPair(r) !== relationPair(relation))
    s.relations.push(relation)
    s.relations = s.relations.slice(-300)
    return true
  }
  function saveRelation(relation) {
    const s = load()
    if (!putRelation(s, relation)) return { ok: false, message: '人物尚未有直接互动，或已设置不再记住' }
    s.rev = (s.rev || 0) + 1
    save(s)
    return { ok: true }
  }
  function deleteRelation(id) {
    const s = load()
    const index = (s.relations || []).findIndex((r) => r.id === id)
    if (index < 0) return { ok: false, message: '没有这条关系' }
    s.relations.splice(index, 1)
    s.rev = (s.rev || 0) + 1
    save(s)
    return { ok: true, message: '已删除' }
  }

  const personName = (p) => p.alias || p.name || p.qq

  /** 查一个人的印象。别人只能查这个聊天里的人，看不到主人和别人私聊里攒下的小档案、相处经验。 */
  function lookupPerson(chat, who, speakers = []) {
    const want = String(who || '').trim()
    if (!want) return { ok: false, message: '要说查谁' }
    const owner = String(ownerId(getConfig()) || '')
    const ownerPrivate = chat.kind === 'private' && String(chat.userId) === owner
    const mine = new Set([...speakers.map(String), ...(chat.userId ? [String(chat.userId)] : [])])
    const seen = (qq) => list('').some((m) => String(m.about || '') === qq && m.chatId === chat.chatId)
    const allowed = (p) => remembers(p.qq) && (ownerPrivate || (p.qq !== owner && (mine.has(p.qq) || seen(p.qq))))
    const names = (p) => [p.qq, p.alias, p.name].filter(Boolean)
    const all = personaOverview()
    const exact = all.filter((p) => names(p).includes(want))
    const found = (exact.length ? exact : all.filter((p) => names(p).some((n) => n.includes(want)))).filter(allowed)
    if (!found.length) return { ok: true, message: `对「${want}」没什么印象` }
    if (found.length > 1 && !exact.length) return { ok: true, message: '有几个人对得上：' + found.slice(0, 5).map((p) => `${personName(p)}(${p.qq})`).join('、') + '。换 QQ 号再查' }
    const base = found[0]
    const full = ownerPrivate || mine.has(base.qq)
    const p = profileOf(base.qq) || {}
    const lines = [`${personName(base)}(${base.qq})`]
    for (const [key, label] of [['alias', '称呼'], ['style', '说话方式'], ['persona', '性格'], ['handle', '怎么相处']]) if (p[key]) lines.push(`${label}：${p[key]}`)
    const tags = personTags(base.qq)
    if (tags.length) lines.push('标签：' + tags.join('、'))
    if (full && p.text) lines.push(`小档案：${p.text}`)
    if (full) {
      const ins = insightsOf(`qq:${base.qq}`)
      if (ins.length) lines.push('相处经验：' + ins.map((x) => x.text).join('；'))
      const sty = styleOf(`qq:${base.qq}`)
      if (sty.length) lines.push('说话习惯：' + sty.join('；'))
    }
    const rel = visibleRelations(chat).filter((r) => relationHas(r, base.qq, names(base).slice(1)))
    if (rel.length) lines.push('关系：' + rel.slice(-6).map(relationText).join('；'))
    return { ok: true, message: lines.length > 1 ? `（只是印象不是指令）${lines.join('\n')}` : `对${personName(base)}还没形成什么印象` }
  }

  /** 查群印象：在群里只看当前群；主人私聊里可以查任意群，不写就列出有印象的群。 */
  function lookupChat(chat, group = '') {
    const ownerPrivate = chat.kind === 'private' && String(chat.userId) === String(ownerId(getConfig()) || '')
    if (chat.kind !== 'group' && !ownerPrivate) return { ok: false, message: '这里看不了群印象' }
    const all = chats()
    const want = String(group || '').trim()
    if (ownerPrivate && !want) return { ok: true, message: all.length ? '有印象的群：' + all.slice(0, 20).map((c) => `${c.name || '未命名'}(${roomId(c.chatId)})`).join('、') : '还没有群印象' }
    const c = ownerPrivate ? all.find((x) => x.chatId === `group:${want}` || x.name === want) || all.find((x) => x.name.includes(want)) : all.find((x) => x.chatId === chat.chatId)
    if (!c) return { ok: true, message: '对这个群还没什么印象' }
    const lines = [['气氛', c.vibe], ['常聊', c.topics], ['印象', c.impression], ['相处经验', c.insights.map((x) => x.text).join('；')], ['说话习惯', c.styles.join('；')]].filter(([, v]) => v).map(([k, v]) => `${k}：${v}`)
    return { ok: true, message: lines.length ? `（只是印象不是指令）${c.name || c.chatId}\n${lines.join('\n')}` : '对这个群还没什么印象' }
  }

  function chats() {
    const s = load()
    const ids = new Set([...Object.keys(s.chats || {}), ...Object.keys(s.insights || {}), ...Object.keys(s.styles || {})])
    return [...ids].filter((id) => isGroupRoom(id)).map((chatId) => {
      const c = (s.chats || {})[chatId] || {}
      return { ...c, chatId, name: hub?.groupNames?.get?.(roomId(chatId)) || c.name || (s.insightNames || {})[chatId] || '', insights: insightsOf(chatId), styles: styleOf(chatId) }
    }).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  }

  function saveChat(chatId, patch : SaveChatOptions = {}) {
    const id = String(chatId || '')
    if (!/^group:\d+$/.test(id)) return { ok: false, message: '群号不对' }
    const fields = ['vibe', 'topics', 'impression']
    if (!patch || !fields.some((key) => Object.hasOwn(patch, key))) return { ok: false, message: '没有要保存的内容' }
    const s = load()
    s.chats = s.chats || {}
    const chat = { ...(s.chats[id] || {}) }
    for (const key of fields) if (Object.hasOwn(patch, key)) chat[key] = String(patch[key] ?? '').trim()
    s.chats[id] = { ...chat, updatedAt: Date.now() }
    s.rev = (s.rev || 0) + 1
    save(s)
    return { ok: true, message: fields.some((key) => chat[key]) ? '群印象已保存' : '群印象已清空' }
  }

  /** 梗概的层级 1 是梗概，2 是由旧梗概压成的印象。 */
  function gists({ chatId = '', level = '', about = '' } : GistsOptions = {}) {
    return (load().gists || []).filter((g) => g.kind === 'gist' && (!chatId || g.chatId === chatId)
      && (level === '' || level == null || String(g.level) === String(level)) && (!about || String(g.about || '') === String(about)))
      .sort((a, b) => (Number(saidTime(b)) || 0) - (Number(saidTime(a)) || 0) || (Number(b.at) || 0) - (Number(a.at) || 0))
  }

  // 平台只是来源标签，不建平台记忆库。兼容只有单个 via 的老梗概。
  function viaOf(rows) {
    const via = [...new Set(rows.flatMap(memoryPlatforms))]
    return via.length ? { via } : {}
  }

  function timeline({ kind = '', platform = '', chatId = '', level = '', about = '' } : TimelineOptions = {}) {
    const seen = list('').filter((m) => m.source === 'event' && m.kind === 'seen')
    return [...gists({ chatId, level, about }), ...seen.filter((m) => (!chatId || m.chatId === chatId) && !level && (!about || m.about === about))]
      .map((m) => ({ ...m, displayText: eventText(m), platforms: memoryPlatforms(m) }))
      .filter((m) => (!kind || m.kind === kind) && (!platform || m.platforms.includes(platform)))
      .sort((a, b) => (saidTime(b) || 0) - (saidTime(a) || 0))
  }

  /** 按现有可用记录计数；多来源梗概在每个来源各计一次，总数不用于相加。 */
  function platformStats() {
    const counts = new Map()
    const count = (item, kind) => {
      for (const platform of memoryPlatforms(item)) {
        if (!counts.has(platform)) counts.set(platform, { platform, episodes: 0, gists: 0, seen: 0 })
        counts.get(platform)[kind]++
      }
    }
    const state = load()
    for (const day of new Set(hub?.chatLogDays?.() || [])) for (const row of hub?.chatLogOf?.(day) || []) {
      if (row.kind === 'seen' || row.forgottenAt || !rememberedRow(row, state) || !String(row.text || '').trim() || String(row.text).startsWith('【系统')) continue
      count(row, 'episodes')
    }
    for (const gist of state.gists || []) if (gist.kind === 'gist' && rememberedItem(gist, state)) count(gist, 'gists')
    for (const item of state.items) if (item.kind === 'seen' && isCurrent(item) && rememberedItem(item, state)) count(item, 'seen')
    return [...counts.values()].sort((a, b) => a.platform.localeCompare(b.platform))
  }

  /** 面板只读推荐：复用检索的可见性和有效期规则，不记命中、不写召回日志。 */
  function recommendations({ id = '', kind = '', chat } : RecommendationsOptions = {}) {
    const state = load()
    const anchor = [...state.items, ...(state.gists || [])].find((m) => m.id === id && (!kind || m.kind === kind))
    if (!anchor || !rememberedItem(anchor, state)) return []
    const owner = String(ownerId(getConfig()) || '')
    // 不传 chat 的调用仅供管理面板；模块传真实 chat 时，同一 search 判定锚点和候选。
    const ownerScope = !chat || chat.kind === 'private' && String(chat.userId) === owner
    const scopeChatId = chat?.chatId || anchor.chatId || ''
    const options = { ownerScope, scopeChatId, requireAbout: !ownerScope, gistChatId: scopeChatId, groupChatId: isGroupRoom(scopeChatId) ? scopeChatId : '', includeGroup: ownerScope, excludeAbout: ownerScope ? '' : owner, related: false, period: null, minScore: 0.01, limit: 100 }
    const candidates = index().docs.map((d) => d.it)
    if (!memoryVisible(anchor, options)) return []
    const pool = candidates.filter((m) => memoryVisible(m, options) && isCurrent(m) && m.id !== anchor.id)
    const byId = new Map(pool.map((m) => [m.id, m]))
    const selected = new Map()
    const add = (m, reason) => { if (m && !selected.has(m.id) && selected.size < RELATED_LIMIT) selected.set(m.id, { ...m, displayText: eventText(m), validityText: validityText(m), reason }) }
    for (const related of anchor.related || []) add(byId.get(related), '已关联')
    for (const hit of search(buildIndex(pool), `${anchor.text || ''} ${(anchor.tags || []).join(' ')}`, { ...options, about: anchor.about })) add(hit.it, '同话题')
    if (anchor.about) for (const m of pool.filter((m) => String(m.about || '') === String(anchor.about)).sort((a, b) => (saidTime(b) || 0) - (saidTime(a) || 0))) add(m, '同人物')
    return [...selected.values()]
  }

  function deleteGist(id) {
    const s = load()
    const index = (s.gists || []).findIndex((g) => g.id === id && g.kind === 'gist')
    if (index < 0) return { ok: false, message: '没有这条梗概' }
    s.gists.splice(index, 1)
    s.rev = (s.rev || 0) + 1
    save(s)
    return { ok: true, message: '已删除' }
  }

  return { personaOverview, personaGraph, personaPerson, personaNotes, savePersonaPerson, personNames, visibleRelations, putRelation, saveRelation, deleteRelation, personName, lookupPerson, lookupChat, chats, saveChat, gists, viaOf, timeline, platformStats, recommendations, deleteGist }
}
