import { useState, useEffect, useMemo } from './../core/react.ts'
import { bustCache, get, getCached, post } from './../core/api.ts'
import { timeAgo } from './../core/format.ts'
import { PERSON_FIELDS, PersonFace, faceColor, gistLevel, gistSource, memoryDate, memoryEnded, personName } from './../core/memory-model.ts'
import { Btn, Card, Empty, Row, Seg, Select, cx, h } from './../core/ui.ts'
import { InsightCard } from './memory-parts.ts'

function PersonaMemory({ toast }) {
  const [page, setPage] = useState('wall')
  return h('div', { className: 'ab-pm' },
    h('div', { className: 'ab-pm-head' },
      h(Seg, { value: page, onChange: setPage, options: [{ value: 'wall', label: '人物墙' }, { value: 'graph', label: '关系星图' }, { value: 'chats', label: '群印象' }, { value: 'timeline', label: '时间轴' }] })),
    h(MemoryPlatforms),
    page === 'wall' ? h(PersonaWall, { toast }) : page === 'graph' ? h(PersonaGraph, { toast }) : page === 'chats' ? h(PersonaChats, { toast }) : h(PersonaTimeline, { toast }))
}

function MemoryPlatforms() {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const r = await get('/memory/platforms')
      if (!r.ok) throw new Error(r.message || '来源统计没读出来')
      setList(r.list || []); setError('')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  const names = { qq: 'QQ', douyin: '抖音', bili: 'B站', heybox: '小黑盒', unknown: '来源未知' }
  return h(Card, { title: '来源平台', desc: '统计目前可用的记录，已忘和停记内容不计；多来源梗概在每个来源各计一次。', right: h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新') },
    error ? h('div', { className: 'ab-note err' }, error) : list === null ? h('div', { className: 'ab-muted' }, '读取中…') : !list.length ? h('div', { className: 'ab-muted' }, '还没有记录') :
    h('div', { className: 'ab-pm-platforms' }, h('table', { className: 'ab-table num' },
      h('thead', null, h('tr', null, ['平台', '原话', '梗概 / 印象', '看过的内容'].map((x) => h('th', { key: x, scope: 'col' }, x)))),
      h('tbody', null, list.map((p) => h('tr', { key: p.platform }, h('td', null, names[p.platform] || p.platform), h('td', null, p.episodes), h('td', null, p.gists), h('td', null, p.seen)))))))
}

// 有界的确定性布局：斥力让节点散开，关系边把相关的人拉近，不保存坐标。
function starPositions(nodes: any[], links: any[]) {
  const height = Math.max(340, Math.ceil(nodes.length / 3) * 90 + 40)
  const points = nodes.map((p, i) => ({ ...p, x: 60 + (i % 3) * 120, y: 45 + Math.floor(i / 3) * 90, r: 12 + Math.min(10, Math.sqrt(Math.max(0, p.closeness || 0)) * 2) }))
  const byId = new Map(points.map((p) => [p.qq, p]))
  for (let step = 0; step < 70; step++) {
    const shifts = points.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const force = Math.min(8, 1200 / (distance * distance))
      shifts[i].x += dx / distance * force; shifts[i].y += dy / distance * force
      shifts[j].x -= dx / distance * force; shifts[j].y -= dy / distance * force
    }
    const indices = new Map(points.map((p, i) => [p.qq, i]))
    for (const edge of links) {
      const a = byId.get(edge.source), b = byId.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy))
      const force = (distance - 100) * 0.018
      shifts[indices.get(a.qq)].x += dx / distance * force; shifts[indices.get(a.qq)].y += dy / distance * force
      shifts[indices.get(b.qq)].x -= dx / distance * force; shifts[indices.get(b.qq)].y -= dy / distance * force
    }
    points.forEach((p, i) => {
      p.x = Math.max(30, Math.min(330, p.x + Math.max(-8, Math.min(8, shifts[i].x))))
      p.y = Math.max(30, Math.min(height - 40, p.y + Math.max(-8, Math.min(8, shifts[i].y))))
    })
  }
  return { points, height }
}

function PersonaGraph({ toast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState('')
  const load = async () => {
    try {
      const r = await get('/persona/graph')
      if (!r.ok) throw new Error(r.message || '关系星图没读出来')
      setData(r); setError('')
      setSelected((qq) => r.nodes.some((p) => p.qq === qq) ? qq : '')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  const filtered = (data?.nodes || []).filter((p) => [p.qq, p.name].some((s) => String(s).toLowerCase().includes(query.trim().toLowerCase())))
  const last = Math.max(0, Math.ceil(filtered.length / 48) - 1), current = Math.min(page, last)
  const nodes = filtered.slice(current * 48, (current + 1) * 48)
  const layout = useMemo(() => starPositions(nodes, data?.links || []), [data, query, current])
  if (error) return h('div', { className: 'ab-note err' }, error, h(Btn, { small: true, onClick: load }, '重试'))
  if (!data) return h(Empty, { text: '读取中…' })
  const positions = new Map<any, any>(layout.points.map((p: any) => [p.qq, p]))
  const links = data.links.filter((e) => positions.has(e.source) && positions.has(e.target))
  return h('div', { className: cx('ab-pm-split ab-pm-graph', selected && 'open') },
    h('div', { className: 'ab-pm-list' }, h(Card, { title: '关系星图', desc: '圆越大，最近互动越亲近；线表示记下的人物关系。点一个人查看详情。', right: h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新') },
      h('input', { className: 'ab-input', style: { width: '100%', boxSizing: 'border-box' }, 'aria-label': '在星图里找人', placeholder: '名字或 QQ 号', value: query, onChange: (e) => { setQuery(e.target.value); setPage(0) } }),
      !nodes.length ? h(Empty, { text: '还没有符合条件的人物记忆' }) : h('div', { className: 'ab-pm-stars' }, h('svg', { viewBox: `0 0 360 ${layout.height}`, 'aria-label': '人物关系星图' },
        links.map((edge) => { const a = positions.get(edge.source), b = positions.get(edge.target); return h('line', { key: edge.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--ab-sub)', strokeOpacity: 0.35, strokeWidth: 1.5 }, h('title', null, edge.text)) }),
        layout.points.map((p) => h('g', { key: p.qq, role: 'button', tabIndex: 0, 'aria-label': `${p.name}，${p.interactions} 次互动，查看详情`, onClick: () => setSelected(p.qq), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.qq) } } },
          h('title', null, `${p.name} (${p.qq}) · ${p.interactions} 次互动`),
          h('circle', { cx: p.x, cy: p.y, r: 28, fill: 'transparent' }),
          h('circle', { cx: p.x, cy: p.y, r: p.r, fill: faceColor(p.qq), stroke: p.isOwner ? 'var(--ab-sea)' : 'var(--ab-card)', strokeWidth: p.isOwner ? 3 : 1 }),
          h('text', { x: p.x, y: p.y + 4, textAnchor: 'middle', fill: '#fff', fontSize: 12, pointerEvents: 'none' }, [...p.name][0] || '?'),
          h('text', { x: p.x, y: p.y + p.r + 15, textAnchor: 'middle', fill: 'var(--ab-text)', fontSize: 11, pointerEvents: 'none' }, [...p.name].slice(0, 8).join('')))))),
      h('div', { className: 'ab-flex ab-small ab-muted', style: { marginTop: 8 } },
        `${filtered.length} 人 · 本页 ${links.length} 条关系`,
        last ? h('span', null, h(Btn, { small: true, disabled: !current, onClick: () => setPage(current - 1) }, '上一页'), ` ${current + 1}/${last + 1} `, h(Btn, { small: true, disabled: current === last, onClick: () => setPage(current + 1) }, '下一页')) : null),
      links.length ? h('details', { className: 'ab-small', style: { marginTop: 8 } }, h('summary', null, '本页的关系'), links.map((e) => h('div', { key: e.id }, e.text))) : null)),
    selected ? h(PersonaDetail, { key: selected, qq: selected, toast, back: () => setSelected(''), onChanged: load }) : null)
}

/** 展开时才查；推荐没有编辑、删除和命中记账。 */

function RelatedMemories({ m }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    if (!open) return () => { alive = false }
    setList(null); setError('')
    get('/memory/related?id=' + encodeURIComponent(m.id) + '&kind=' + encodeURIComponent(m.kind || '')).then((r) => {
      if (!alive) return
      if (!r.ok) setError(r.message || '相关记忆没读出来')
      else setList(r.list || [])
    }).catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [open, m.id, m.text, m.related, m.at])
  return h('div', { className: 'ab-pm-related' },
    !open && (m.relatedItems || []).length ? h('div', { className: 'ab-muted' }, m.relatedItems.map((r) => h('div', { key: r.id }, '相关：' + r.text + (r.validityText ? '（' + r.validityText + '）' : '')))) : null,
    h('button', { type: 'button', className: 'ab-pm-link', 'aria-expanded': open, onClick: () => setOpen(!open) }, open ? '收起相关记忆' : '看看相关记忆'),
    open ? h('div', { 'aria-live': 'polite' }, error ? h('div', { className: 'ab-note err' }, error) : list === null ? '查找中…' : !list.length ? h('div', { className: 'ab-muted' }, '暂时没有相关的记忆') :
      list.map((it) => h('article', { key: it.id }, h('div', { className: 'text' }, it.displayText || it.text),
        h('div', { className: 'ab-muted' }, [it.reason, memoryDate(it.saidAt || it.at), it.chatId ? gistSource(it.chatId) : ''].filter(Boolean).join(' · '))))) : null)
}

function PersonaWall({ toast }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState('')
  const load = async () => {
    const r = await getCached('/persona/overview')
    if (!r.ok) { setError(r.message || '人物列表没读出来'); return }
    setError(''); setList(r.list || [])
    setSelected((cur) => (r.list || []).some((p) => p.qq === cur) ? cur : (window.innerWidth > 760 && r.list?.[0]?.qq) || '')
  }
  useEffect(() => { load() }, [])
  if (error) return h('div', { className: 'ab-note err' }, error)
  if (list === null) return h(Empty, { icon: '⏳', text: '加载中…' })
  if (!list.length) return h(Card, { title: '还没有人物记忆' }, h(Empty, { icon: '🌱', text: '聊过一段时间后，ta记住的人会慢慢出现在这里。' }))
  const q = query.trim().toLowerCase()
  const groups = [...new Map<string, string>(list.flatMap((p: any) => (p.groups || []).map((g) => [g.id, g.name]))).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const tags = [...new Set<string>(list.flatMap((p: any) => p.tags || []))].sort((a, b) => { const rank = (x) => x === '喜欢' ? 0 : x === '讨厌' ? 1 : 2; return rank(a) - rank(b) || a.localeCompare(b) })
  const visible = list.filter((p) => (!q || [p.qq, p.name, p.alias, p.style, p.persona, p.handle, p.text, ...(p.tags || [])].some((v) => String(v || '').toLowerCase().includes(q))) && (!group || (p.groups || []).some((g) => g.id === group)) && (!tag || (p.tags || []).includes(tag)) && (!status || (status === 'owner' ? p.isOwner : status === 'active' ? p.lastActive >= Date.now() - 7 * 86400_000 : status === 'relations' ? p.hasRelations : p.hasInsights)))
  return h('div', { className: cx('ab-pm-split', selected && 'open') },
    h('div', { className: 'ab-pm-list' },
      h('div', { className: 'ab-pm-search', style: { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 } },
        h('input', { className: 'ab-input', style: { flex: '1 1 140px', minWidth: 0 }, placeholder: `在 ${list.length} 个人里找`, 'aria-label': '搜索人物', value: query, onChange: (e) => setQuery(e.target.value) }),
        ...[[group, setGroup, '所有群', groups], [tag, setTag, '所有标签', tags.map((x) => [x, x])], [status, setStatus, '所有状态', [['owner', '主人'], ['active', '最近 7 天活跃'], ['relations', '有人物关系'], ['insights', '有相处经验']]]].map(([value, set, label, options]) => h(Select, { key: label, ariaLabel: label, value, onChange: set, options: [{ value: '', label }, ...options.map(([v, text]) => ({ value: v, label: text }))] }))),
      h('div', { className: 'ab-pm-rows' },
        visible.length ? visible.map((p) => h('button', { key: p.qq, type: 'button', className: cx('ab-pm-row', p.qq === selected && 'on'), onClick: () => setSelected(p.qq) },
          h(PersonFace, { p }),
          h('span', { className: 'who' },
            h('span', { className: 'name' }, h('span', null, personName(p)), p.isOwner ? h('span', { className: 'ab-pm-own' }, '主人') : null),
            h('span', { className: 'line', style: { display: 'block' } }, p.persona || p.style || p.text || `记得 ${p.notes} 件事`),
            (p.tags || []).length ? h('span', { className: 'line', style: { display: 'block' } }, p.tags.join(' · ')) : null)))
          : h(Empty, { text: '没找到这个人' }))),
    selected ? h(PersonaDetail, { key: selected, qq: selected, toast, back: () => setSelected(''), onChanged: load }) : h('div', { className: 'ab-pm-detail' }, h(Empty, { text: '选一个人看看' })))
}

function PersonMemoryReset({ qq, toast, onDone }) {
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    if (busy || !confirm(`清理 QQ ${qq} 的记忆并重开私聊？\n相关记忆会被删除，清理前的消息将退出机器人上下文。旧会话仍可在 QQ 和 DSH 中查看，权限设置会保留。`)) return
    setBusy(true)
    try {
      const result = await post('/persona/person/reset', { qq })
      toast(result.message || (result.ok ? '记忆已清理' : '清理失败'), result.ok ? 'ok' : 'err')
      if (result.ok) await onDone?.()
    } finally { setBusy(false) }
  }
  return h(Btn, { small: true, kind: 'danger', disabled: busy, onClick: reset }, '清理记忆并重开私聊')
}

function PersonaDetail({ qq, toast, back, onChanged }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [editing, setEditing] = useState(false)
  const [relationEdit, setRelationEdit] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState('')
  const [notesBusy, setNotesBusy] = useState(false)
  const load = async (keepForm = false, notesLimit = 20) => {
    const n = Math.min(100, Math.max(20, Math.trunc(Number(notesLimit) || 20)))
    const r = await getCached('/persona/person?qq=' + encodeURIComponent(qq) + '&notesLimit=' + n)
    if (!r.ok) { setError(r.message || '人物详情没读出来'); return }
    setError(''); setData(r)
    if (!keepForm) setForm({ ...Object.fromEntries(PERSON_FIELDS.map(([key]) => [key, r.person[key] || ''])), tags: r.person.tags || [] })
  }
  const loadMoreNotes = async () => {
    if (notesBusy) return
    const shown = (data.notes || []).length
    if (shown >= (data.notesTotal || 0)) return
    setNotesBusy(true)
    try {
      const r = await getCached('/persona/person/notes?qq=' + encodeURIComponent(qq) + '&limit=20&offset=' + shown)
      if (!r.ok) return toast(r.message || '加载失败', 'err')
      setData((prev) => prev ? { ...prev, notes: [...(prev.notes || []), ...(r.list || [])] } : prev)
    } finally { setNotesBusy(false) }
  }
  const removeNote = (id) => {
    const gone = (data.notes || []).find((m) => m.id === id)
    const ended = gone ? memoryEnded(gone) : false
    setData((prev) => prev ? {
      ...prev,
      notes: (prev.notes || []).filter((m) => m.id !== id),
      notesTotal: Math.max(0, (prev.notesTotal || 1) - 1),
      notesLive: Math.max(0, (prev.notesLive || 0) - (ended ? 0 : 1)),
      notesOld: Math.max(0, (prev.notesOld || 0) - (ended ? 1 : 0)),
    } : prev)
  }
  const removeGist = (id) => setData((prev) => prev ? { ...prev, gists: (prev.gists || []).filter((g) => g.id !== id) } : prev)
  const editNote = (id, text) => setData((prev) => prev ? {
    ...prev,
    notes: (prev.notes || []).map((m) => m.id === id ? { ...m, text, displayText: text } : m),
  } : prev)
  const restoreNote = (id) => setData((prev) => prev ? {
    ...prev,
    notes: (prev.notes || []).map((m) => m.id === id ? { ...m, invalidAt: undefined, validUntil: undefined, validityText: '' } : m),
    notesLive: (prev.notesLive || 0) + 1,
    notesOld: Math.max(0, (prev.notesOld || 0) - 1),
  } : prev)
  useEffect(() => { load() }, [qq])
  if (error) return h('div', { className: 'ab-pm-detail' }, h('div', { className: 'ab-note err' }, error))
  if (!data || !form) return h('div', { className: 'ab-pm-detail' }, h(Empty, { icon: '⏳', text: '加载中…' }))
  const p = data.person
  const tagsChanged = JSON.stringify(form.tags) !== JSON.stringify(p.tags || [])
  const changed = tagsChanged || PERSON_FIELDS.some(([key]) => form[key] !== (p[key] || ''))
  const save = async () => {
    const { tags, ...fields } = form
    const r = await post('/persona/person/save', { qq, ...fields, ...(tagsChanged ? { tags } : {}) })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { setEditing(false); await load(false, Math.max(20, (data.notes || []).length)); onChanged() }
  }
  const editRelation = async (r) => {
    setRelationEdit(r.id)
    const text = window.prompt('按「主语 关系 宾语」修改这条关系，例如：大肥鱼 是 主人的猫', r.text)
    if (text == null) { setRelationEdit(null); return }
    const parts = String(text).trim().split(/\s+/)
    if (parts.length < 3) { toast('要写成「主语 关系 宾语」', 'err'); setRelationEdit(null); return }
    const subj = parts.shift()
    const obj = parts.pop()
    const pred = parts.join(' ')
    const res = await post('/memory/relations/save', { ...r, subj, pred, obj })
    toast(res.message || (res.ok ? '改好了' : '没改成'), res.ok ? 'ok' : 'err')
    setRelationEdit(null)
    if (res.ok) await load(true)
  }
  const rebuild = async () => {
    if (!(data.notesLive > 0)) return toast('还没有能用来重写小档案的事实', 'err')
    if (changed && !confirm('重写会放弃还没保存的修改，继续吗？')) return
    const r = await post('/profiles/rebuild', { qq })
    toast(r.message, r.ok ? 'ok' : 'err')
    await load(!r.ok, Math.max(20, (data.notes || []).length))
  }
  const forgetPerson = async () => {
    if (!confirm(`删除关于「${personName(p)}」的全部人物记忆？画像、事实、关系、相处经验和标签都会清掉。`)) return
    if (!confirm('再次确认：删除后无法恢复，过去的原话也会标为已忘，不会重新提炼。继续删除吗？')) return
    const r = await post('/persona/person/delete', { qq })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { back(); onChanged() }
  }
  const toggleNoMemory = async (enabled) => {
    const deleteExisting = enabled && confirm('以后不再留下这个人的记忆。要同时删除已有记忆吗？点「确定」删除；点「取消」保留已有记忆，但不再使用。')
    const r = await post('/persona/person/no-memory', { qq, enabled, deleteExisting })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { setEditing(false); await load(); onChanged() }
  }
  const traits = [['style', '说话方式'], ['persona', '性格'], ['handle', '怎么相处']]
  const notes = data.notes || []
  const live = notes.filter((m) => !memoryEnded(m))
  const old = notes.filter(memoryEnded)
  return h('div', { className: 'ab-pm-detail' },
    h('div', { className: 'ab-pm-back' }, h(Btn, { small: true, kind: 'ghost', onClick: back }, '← 返回名单')),
    h('div', { className: 'ab-pm-hero' },
      h(PersonFace, { p, big: true }),
      h('div', { className: 'body' },
        h('div', { className: 'ab-flex' },
          h('h3', null, personName(p)), p.isOwner ? h('span', { className: 'ab-pm-own' }, '主人') : null,
          h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, kind: 'ghost', onClick: rebuild }, '重写'),
          h(Btn, { small: true, onClick: () => setEditing(!editing) }, editing ? '收起' : '编辑')),
        h('div', { className: 'meta' }, 'QQ ' + qq + ' · ' + (p.lastActive ? memoryDate(p.lastActive) + ' 来过' : '最近没来过')),
        h('p', { className: cx('quote', !p.text && 'empty') }, p.text || 'ta对这个人还没有整体印象。'),
        (p.tags || []).length ? h('div', { className: 'ab-pm-trait' }, '标签：' + p.tags.join(' · ')) : null)),
    h(Card, { title: '是否留下记忆', desc: '讨厌 = 不爱搭理；不再记住 = 不留记忆。两者分别设置。消息仍照常进入聊天，她能看懂当下的对话。撤销后，以后的互动会恢复记忆。' },
      h(Row, { label: '不再记住', hint: p.isOwner ? '主人始终会被记住。' : p.noMemory ? '已停止形成人物记忆，已有记忆也不会带进聊天。' : '可以随时开启或撤销。' },
        h('input', { type: 'checkbox', role: 'switch', 'aria-label': '不再记住', checked: Boolean(p.noMemory && !p.isOwner), disabled: p.isOwner, onChange: (e) => toggleNoMemory(e.target.checked) })),
      !p.isOwner ? h(Btn, { small: true, kind: 'ghost', onClick: forgetPerson }, '删除这个人') : null,
      h(PersonMemoryReset, { qq, toast, onDone: () => { back(); return onChanged() } })),
    editing ? h(Card, { title: '编辑印象' },
      h('div', { className: 'ab-pm-form' }, PERSON_FIELDS.map(([key, label]) => h('label', { key, className: key === 'text' ? 'full' : '' }, label,
        h('textarea', { className: 'ab-textarea', rows: key === 'text' ? 3 : 2, value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })))),
      h('div', { className: 'ab-pm-trait', style: { marginTop: 10 } },
        h('div', { className: 'k' }, '标签（最多 8 个，每个 8 字）'),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6 } },
          form.tags.map((t) => h(Btn, { key: t, small: true, onClick: () => setForm({ ...form, tags: form.tags.filter((x) => x !== t) }) }, t + ' ×')),
          ...['喜欢', '讨厌'].filter((t) => !(p.isOwner && t === '讨厌')).map((t) => h(Btn, { key: t, small: true, onClick: () => { const rest = form.tags.filter((x) => x !== '喜欢' && x !== '讨厌'); if (!form.tags.includes(t) && rest.length >= 8) return toast('标签已满', 'err'); setForm({ ...form, tags: form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...rest, t] }) } }, t)),
          h('input', { className: 'ab-input sm', style: { minWidth: 0, maxWidth: '100%' }, value: tagInput, placeholder: '新标签', maxLength: 16, onChange: (e) => setTagInput(e.target.value) }),
          h(Btn, { small: true, onClick: () => { const t = tagInput.trim(); if (!t || [...t].length > 8 || form.tags.includes(t) || form.tags.length >= 8 || (p.isOwner && t === '讨厌')) return toast('标签重复、过长或已满', 'err'); setForm({ ...form, tags: [...form.tags.filter((x) => !(['喜欢', '讨厌'].includes(t) && ['喜欢', '讨厌'].includes(x))), t] }); setTagInput('') } }, '添加'))),
      h('div', { className: 'ab-flex', style: { marginTop: 10 } }, h(Btn, { kind: 'primary', disabled: !changed, onClick: save }, '保存'))) :
    h('div', { className: 'ab-pm-traits' }, traits.map(([key, label]) => h('div', { key, className: 'ab-pm-trait' },
      h('div', { className: 'k' }, label), h('div', { className: cx('v', !p[key] && 'empty') }, p[key] || '还不了解')))),
    data.shortTerm ? h(Card, { title: '刚才聊到哪' }, h('div', null, data.shortTerm.text)) : null,
    h(Card, { title: '私聊里的相处经验', desc: '私聊时优先用这里，上面的「说话方式」和「怎么相处」在群里用。' },
      h(InsightCard, { p: { key: 'qq:' + qq, list: data.insights || [] }, style: data.styles || [], toast, onSaved: () => load(true, Math.max(20, (data.notes || []).length)) })),
    (data.relations || []).length ? h(Card, { title: '人物关系' }, data.relations.map((r) => h('div', { key: r.id, className: 'ab-pm-fact' },
      h('span', { className: 'ab-pm-dot', 'aria-hidden': 'true' }),
      h('div', { className: 'main' }, h('div', { className: 'text' }, r.text), h('div', { className: 'sub' }, h('span', null, memoryDate(r.at)), h('span', null, gistSource(r.chatId)))),
      h('div', { className: 'ab-pm-acts' }, h('button', { type: 'button', className: 'ab-pm-link', disabled: relationEdit === r.id, onClick: () => editRelation(r) }, relationEdit === r.id ? '改…' : '改'), h('button', { type: 'button', className: 'ab-pm-link danger', onClick: async () => {
        if (!confirm('删除这条关系？')) return
        const res = await post('/memory/relations/delete', { id: r.id })
        toast(res.message, res.ok ? 'ok' : 'err')
        if (res.ok) await load(true, Math.max(20, (data.notes || []).length))
      } }, '删'))))) : null,
    h(Card, { title: `记得的事 ${data.notesLive ?? live.length}`.trim() },
      live.length ? live.map((m) => h(PersonaFact, { key: m.id, m, tiers: data.factTiers, toast, onChanged: () => load(true), onDeleted: removeNote, onEdited: editNote, onRestored: restoreNote })) : h(Empty, { text: '还没记住关于这个人的事。' }),
      notes.length < (data.notesTotal || 0) ? h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        h(Btn, { small: true, kind: 'ghost', disabled: notesBusy, onClick: loadMoreNotes }, notesBusy ? '加载中…' : `加载更多（已显示 ${notes.length}/${data.notesTotal}）`)) : null),
    data.gists.length ? h(Card, { title: '留下的感觉' }, h(GistLine, { list: data.gists, toast, onChanged: () => load(true), onDeleted: removeGist })) : null,
    old.length ? h('details', { className: 'ab-card' }, h('summary', { className: 'ab-small' }, `已过时的 ${data.notesOld ?? old.length} 条${old.length < (data.notesOld || 0) ? '（已显示 ' + old.length + '）' : ''}`),
      h('div', { style: { marginTop: 8 } }, old.map((m) => h(PersonaFact, { key: m.id, m, tiers: data.factTiers, toast, onChanged: () => load(true), onDeleted: removeNote, onEdited: editNote, onRestored: restoreNote })))) : null)
}

function PersonaFact({ m, tiers = [], toast, onChanged, onDeleted, onEdited, onRestored }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text || '')
  const [tierValue, setTierValue] = useState(m.tier)
  useEffect(() => { setText(m.text || ''); setTierValue(m.tier) }, [m.text, m.tier])
  const save = async () => {
    const r = await post('/memory/update', { id: m.id, text: text.trim(), ...(tierValue !== m.tier && tierValue !== undefined ? { tier: tierValue } : {}) })
    toast(r.ok ? '改好了' : r.message, r.ok ? 'ok' : 'err')
    if (!r.ok) return
    setEditing(false)
    if (onEdited) onEdited(m.id, text.trim())
    else await onChanged()
  }
  const remove = async () => {
    if (!confirm('删除这条？')) return
    const r = await post('/memory/delete', { id: m.id })
    toast(r.ok ? '删掉了' : r.message, r.ok ? 'ok' : 'err')
    if (r.ok) {
      if (onDeleted) onDeleted(m.id)
      else await onChanged()
    }
  }
  const restore = async () => {
    const r = await post('/memory/restore', { id: m.id })
    toast(r.ok ? '恢复了' : r.message, r.ok ? 'ok' : 'err')
    if (!r.ok) return
    if (onRestored) onRestored(m.id)
    else await onChanged()
  }
  const tierLabel = m.tierLabel || ({ 4: '短暂', 1: '琐碎', 5: '小事', 2: '一般', 3: '重要', 0: '永久', core: '永久' })[m.tier] || ''
  const tier = tierLabel + (m.tierDays !== null && m.tierDays !== undefined ? ` · ${m.tierDays}天` : '')
  const status = { hearsay: '听说', guess: '可能' }[m.status]
  return h('div', { className: cx('ab-pm-fact', memoryEnded(m) && 'old') },
    h('span', { className: cx('ab-pm-dot', m.tier !== undefined && m.tier !== 'core' && 't' + m.tier), 'aria-hidden': 'true' }),
    h('div', { className: 'main' },
      editing ? h('div', null,
        h('textarea', { className: 'ab-textarea', style: { width: '100%', boxSizing: 'border-box', minHeight: 60, fontFamily: 'inherit' }, value: text, onChange: (e) => setText(e.target.value) }),
        h('div', { className: 'ab-flex', style: { marginTop: 6 } },
          m.tier !== 'core' ? h('select', { className: 'ab-select', 'aria-label': '事实档位', value: tierValue ?? '', onChange: (e) => setTierValue(e.target.value === '' ? undefined : Number(e.target.value)) },
            m.tier === undefined ? h('option', { value: '' }, '沿用原有遗忘方式') : null,
            tiers.map((t) => h('option', { key: t.id, value: t.id }, t.label + (t.days === null ? '' : ` · ${t.days}天`)))) : null,
          h(Btn, { small: true, kind: 'primary', disabled: !text.trim(), onClick: save }, '保存'),
          h(Btn, { small: true, kind: 'ghost', onClick: () => { setText(m.text || ''); setTierValue(m.tier); setEditing(false) } }, '取消')))
        : h('div', { className: 'text' }, m.displayText || m.text),
      !editing ? h('div', { className: 'sub' },
        h('span', null, m.validityText || memoryDate(m.saidAt || m.at)),
        tier ? h('span', { className: 'ab-pm-tag' }, tier) : null,
        status ? h('span', { className: 'ab-pm-tag warn' }, status) : null,
        memoryEnded(m) && m.supersededText ? h('span', null, '现在是：' + m.supersededText) : null) : null,
      !editing ? h(RelatedMemories, { m }) : null),
    !editing ? h('div', { className: 'ab-pm-acts' },
      memoryEnded(m) ? h('button', { type: 'button', className: 'ab-pm-link', onClick: restore }, '恢复') : h('button', { type: 'button', className: 'ab-pm-link', onClick: () => setEditing(true) }, '改'),
      h('button', { type: 'button', className: 'ab-pm-link danger', onClick: remove }, '删')) : null)
}

/** 聊天梗概和看过内容共用时间线。 */

function GistLine({ list, toast, onChanged, onDeleted, showFrom }) {
  const remove = async (g) => {
    if (!confirm('删除这条' + gistLevel(g) + '？')) return
    const r = await post(g.kind === 'seen' ? '/memory/delete' : '/memory/gists/delete', { id: g.id })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) {
      if (onDeleted) onDeleted(g.id)
      else await onChanged()
    }
  }
  let day = ''
  return h('div', { className: 'ab-pm-tl' }, list.flatMap((g) => {
    const when = memoryDate(g.saidAt || g.at).split(' ')[0]
    const head = when !== day ? h('div', { key: 'd' + g.id, className: 'ab-pm-tl-day' }, when) : null
    day = when
    return [head, h('div', { key: g.id, className: cx('ab-pm-tl-item', Number(g.level) >= 2 && 'feel') },
      h('div', { className: 'main' }, h('div', { className: 'text' }, g.displayText || g.text),
        h('div', { className: 'from' }, [g.kind === 'seen' ? '看过的内容' : '', ...(g.platforms || []), showFrom && g.chatId ? gistSource(g.chatId) : ''].filter(Boolean).join(' · ')),
        h(RelatedMemories, { m: g })),
      h('div', { className: 'ab-pm-acts' }, h('button', { type: 'button', className: 'ab-pm-link danger', onClick: () => remove(g) }, '删')))]
  }))
}

function PersonaChats({ toast }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const load = async () => {
    const r = await getCached('/memory/chats')
    if (!r.ok) { setError(r.message || '群印象没读出来'); return }
    setError(''); setList(r.list || [])
  }
  useEffect(() => { load() }, [])
  if (error) return h('div', { className: 'ab-note err' }, error)
  if (list === null) return h(Empty, { icon: '⏳', text: '加载中…' })
  if (!list.length) return h(Card, { title: '还没有群印象' }, h(Empty, { text: 'ta在群里待一阵子，就会形成自己的印象。' }))
  return h('div', { className: 'ab-pm-groups' }, list.map((chat) => h(PersonaChatCard, { key: chat.chatId, chat, toast, onChanged: load })))
}

function PersonaChatCard({ chat, toast, onChanged }) {
  const fields = [['vibe', '气氛'], ['topics', '常聊什么'], ['impression', '印象']]
  const blank = () => Object.fromEntries(fields.map(([key]) => [key, chat[key] || '']))
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(blank)
  useEffect(() => { setForm(blank()) }, [chat.vibe, chat.topics, chat.impression])
  const save = async (values) => {
    const r = await post('/memory/chats/save', { chatId: chat.chatId, ...values })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { setEditing(false); await onChanged() }
  }
  const topics = String(chat.topics || '').split(/[、，,；;\s]+/).filter(Boolean)
  const name = chat.name || '群 ' + chat.chatId.slice(6)
  if (editing) return h('div', { className: 'ab-pm-group' },
    h('div', { className: 'name' }, name),
    h('div', { className: 'ab-pm-form' }, fields.map(([key, label]) => h('label', { key, className: 'full' }, label,
      h('textarea', { className: 'ab-textarea', rows: 2, value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })))),
    h('div', { className: 'ab-flex' }, h(Btn, { small: true, kind: 'primary', onClick: () => save(form) }, '保存'), h(Btn, { small: true, kind: 'ghost', onClick: () => { setForm(blank()); setEditing(false) } }, '取消')))
  return h('div', { className: 'ab-pm-group' },
    h('div', { className: 'name' }, name),
    h('div', { className: cx('vibe', !chat.vibe && 'empty') }, chat.vibe || '还说不上来是什么气氛'),
    topics.length ? h('div', { className: 'chips' }, topics.slice(0, 8).map((t) => h('span', { key: t, className: 'ab-pm-chip' }, t))) : null,
    chat.impression ? h('div', { className: 'note' }, chat.impression) : null,
    h('details', { className: 'ab-small' }, h('summary', null, `相处经验 ${(chat.insights || []).length} 条`),
      h('div', { style: { marginTop: 8 } }, h(InsightCard, { p: { key: chat.chatId, list: chat.insights || [] }, style: chat.styles || [], toast, onSaved: onChanged }))),
    h('div', { className: 'foot' }, h('span', null, memoryDate(chat.updatedAt) + ' 更新'),
      h('span', null, h('button', { type: 'button', className: 'ab-pm-link', onClick: () => setEditing(true) }, '编辑'),
        h('button', { type: 'button', className: 'ab-pm-link danger', onClick: () => { if (confirm('清空这个群的印象？')) return save({ vibe: '', topics: '', impression: '' }) } }, '清空'))))
}

function PersonaTimeline({ toast }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [chat, setChat] = useState('')
  const [level, setLevel] = useState('')
  const [kind, setKind] = useState('')
  const [platform, setPlatform] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [facets, setFacets] = useState({ chats: [], platforms: [] })
  const load = async (append = false) => {
    const offset = append && list ? list.length : 0
    const p = new URLSearchParams({ limit: '50', offset: String(offset) })
    if (chat) p.set('chatId', chat)
    if (level) p.set('level', level)
    if (kind) p.set('kind', kind)
    if (platform) p.set('platform', platform)
    const r = await getCached('/memory/timeline?' + p.toString())
    if (!r.ok) { setError(r.message || '时间轴没读出来'); return }
    setError('')
    const next = r.list || []
    setList((prev) => append ? [...(prev || []), ...next] : next)
    setHasMore(Boolean(r.hasMore))
    setTotal(Number(r.total) || 0)
    if (r.facets) setFacets({ chats: r.facets.chats || [], platforms: r.facets.platforms || [] })
  }
  const loadMore = async () => {
    if (busy || !hasMore) return
    setBusy(true)
    try { await load(true) } finally { setBusy(false) }
  }
  const removeGist = (id) => {
    const nextLoaded = Math.max(0, (list || []).length - 1)
    const nextTotal = Math.max(0, total - 1)
    setList((prev) => (prev || []).filter((g) => g.id !== id))
    setTotal(nextTotal)
    setHasMore(nextTotal > nextLoaded)
  }
  useEffect(() => { load(false) }, [chat, level, kind, platform])
  if (error) return h('div', { className: 'ab-note err' }, error)
  if (list === null) return h(Empty, { icon: '⏳', text: '加载中…' })
  const chats = facets.chats.length ? facets.chats : [...new Set(list.map((g) => g.chatId).filter(Boolean))]
  const platforms = facets.platforms.length ? facets.platforms : [...new Set(list.flatMap((g) => g.platforms || []))].sort()
  return h(Card, { title: '时间轴', desc: '聊过的梗概和看过的内容，都能在这里翻一翻。', right: h('div', { className: 'ab-pm-filters' },
    h('select', { className: 'ab-select', 'aria-label': '筛选经历类型', value: kind, onChange: (e) => { setKind(e.target.value); setLevel('') } },
      h('option', { value: '' }, '全部经历'), h('option', { value: 'gist' }, '聊天的梗概'), h('option', { value: 'seen' }, '看过的内容')),
    h('select', { className: 'ab-select', 'aria-label': '筛选平台', value: platform, onChange: (e) => setPlatform(e.target.value) },
      h('option', { value: '' }, '全部平台'), platforms.map((id) => h('option', { key: id, value: id }, id))),
    h('select', { className: 'ab-select', 'aria-label': '筛选聊天', value: chat, onChange: (e) => setChat(e.target.value) },
      h('option', { value: '' }, '全部聊天'), chats.map((id) => h('option', { key: id, value: id }, gistSource(id)))),
    h('select', { className: 'ab-select', 'aria-label': '筛选层级', value: level, disabled: kind === 'seen', onChange: (e) => setLevel(e.target.value) },
      h('option', { value: '' }, '全部'), h('option', { value: '1' }, '梗概'), h('option', { value: '2' }, '印象'))) },
  list.length ? h(GistLine, { list, toast, onChanged: () => load(false), onDeleted: removeGist, showFrom: !chat }) : h(Empty, { text: total ? '没有符合条件的记录。' : '还没有压缩过的记忆，流水到期后会慢慢出现。' }),
  hasMore ? h('div', { className: 'ab-flex', style: { marginTop: 8 } },
    h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: loadMore }, busy ? '加载中…' : `加载更多（已显示 ${list.length}/${total}）`)) : null)
}

/** 最近几轮她想起了什么、因为哪些词想起来的。 */

function RecallLog() {
  const [list, setList] = useState(null)
  const load = () => getCached('/memory/recalls?limit=10').then((r) => setList(r.list || []))
  useEffect(() => { load() }, [])
  return h(Card, { title: '最近想起了什么', desc: '每次回复前ta会按对方说的话翻记忆。这里能看到最近几次想起了哪几条、是因为哪几个词想起来的；想不起来的那次也会列出来。', right: h(Btn, { small: true, kind: 'ghost', onClick: () => { bustCache(); load() } }, '刷新') },
    !list ? h(Empty, { icon: '⏳', text: '加载中…' }) : list.length === 0 ? h(Empty, { icon: '🫧', text: '还没有记录（重启后从头记）。' }) :
      h('div', { className: 'ab-list' }, list.slice(0, 10).map((r, i) => h('div', { key: i, className: 'ab-li' },
        h('div', { className: 'meta' }, timeAgo(r.at), h('br'), h('span', { className: 'ab-small' }, String(r.where || '').replace(/^private:/, '私聊 ').replace(/^group:/, '群 '))),
        h('div', { className: 'body' },
          h('div', { className: 'ab-muted ab-small' }, '「' + r.query.slice(0, 60) + (r.query.length > 60 ? '…' : '') + '」'),
          r.hits.length ? r.hits.map((x) => h('div', { key: x.id, style: { marginTop: 3 } }, '· ' + x.text, h('span', { className: 'ab-muted ab-small' }, '  ← ' + (x.why.join('、') || '—') + ' · ' + x.score))) : h('div', { className: 'ab-muted', style: { marginTop: 3 } }, '这次什么都没想起来'))))))
}

// ═══════════════════════════════════════════════════════════
// 以下 7 个组件来自 feat/assoc-on-1.3beta（记忆星图 + 联想 + 折叠组）
// Fold / AssocPreview / smDraw / usePersisted / StarMap / AddStarForm / MemoryPage
// ═══════════════════════════════════════════════════════════
/**
 * 可折叠卡片。记忆页有八九组设置，全铺开要滚好几屏才能看到保存条；
 * 折起来只留标题 + 一行摘要，想改哪组点开哪组。
 * right（开关之类）会吃掉点击事件，点开关不会把整张卡折起来。
 */

function AssocPreview({ toast }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)
  const run = async () => {
    const text = q.trim()
    if (!text) { toast('先输入一句话', 'err'); return }
    setBusy(true)
    try {
      const r = await get('/memory/assoc/preview?q=' + encodeURIComponent(text))
      if (!r.ok) { toast(r.message || '预览失败', 'err'); setData(null); return }
      setData(r)
    } catch (e) { toast('预览失败：' + e.message, 'err') } finally { setBusy(false) }
  }
  const hopTag = (n) => (n ? (n === 1 ? '第 1 跳' : `第 ${n} 跳`) : '直接命中')
  return h(Card, { title: '联想预览', desc: '看看「A→B→C」实际会带出什么。这里只预览，不会把记忆算作被想起过。' },
    h('div', { className: 'ab-flex', style: { gap: 8 } },
      h('input', { className: 'ab-input', style: { flex: 1 }, placeholder: '比如：睡不好、考试、做饭', value: q,
        onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') run() } }),
      h(Btn, { kind: 'primary', small: true, disabled: busy, onClick: run }, busy ? '查询中…' : '预览')),
    data ? h('div', { style: { marginTop: 10 } },
      h('div', { className: 'ab-note' }, `${data.query}：直接命中 ${data.counts.direct} 条，1 跳 ${data.counts.hop1} 条，2 跳 ${data.counts.hop2} 条${data.counts.hop3 ? `，3 跳 ${data.counts.hop3} 条` : ''}（当前设置：${data.hops} 跳上限、最多 ${data.recall} 条）`),
      data.items.length === 0 ? h(Empty, { text: '没想起相关的事' }) : h('div', null,
        data.items.map((it) => h('div', { key: it.id, className: 'ab-row', style: { alignItems: 'flex-start' } },
          h('div', { className: 'ab-label', style: { flex: 1 } },
            h('b', null, it.text),
            h('small', null, hopTag(it.hop) + (it.hop ? `　分数 ${it.score}` : '') + (it.why ? `　${it.why}` : '')),
            it.via ? h('small', { className: 'ab-muted' }, '从「' + ((data.items.find((x) => x.id === it.via) || {}).text || it.via) + '」联想过来') : null),
          h('div', { className: 'ab-ctl' }, h('span', { className: 'ab-pm-tag' }, hopTag(it.hop)))))) ) : null)
}

/**
 * 画一帧星空。参数全是显式的，便于从 React 里调用。
 * 返回值是这一帧的命中表（星 / 星团 / 子星云）。
 */
// ═══════════════════════════════════════════════════════════════════════
// 记忆星图
//
// 渲染层（renderStarMap 及其常量）**原样搬自 memory-constellation 0.9.2
// 的 panel.js**（draw 函数 + tick 循环），只把 React 闭包改成显式参数。
// 那些注释是原作者反复调优留下的（为什么星尘不闪、为什么标签要粘滞、
// 为什么辉光只画亮星），照着写不可能达到同样质量，所以整段保留。
// ═══════════════════════════════════════════════════════════════════════

export { PersonaMemory, MemoryPlatforms, starPositions, PersonaGraph, RelatedMemories, PersonaWall, PersonMemoryReset, PersonaDetail, PersonaFact, GistLine, PersonaChats, PersonaChatCard, PersonaTimeline, RecallLog, AssocPreview }
