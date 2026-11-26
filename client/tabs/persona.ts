import { useState, useEffect, useRef } from '../core/react.ts'
import { API, get, post } from '../core/api.ts'
import { setPath } from '../core/format.ts'
import { navIcon } from '../core/icons.ts'
import { Btn, Card, Empty, Row, Seg, Select, Switch, cx, h } from '../core/ui.ts'
import { AvatarCard } from './connect.ts'

// 人格按【标题】分节：面板里拆开逐节编辑，保存时按原来的写法拼回一整段（文件格式不变）
const PSEC_HEAD = /^【([^】\n]{1,30})】\s*$/

const PSEC_SUGGEST = ['你的样子', '性格', '打字习惯', '情绪是活的', '你的生活', '和主人的关系', '绝对禁止']

// 每节一个颜色（跟着这一节走，挪位置颜色不变）。低饱和的雾色系，相邻的冷暖交替，深浅两种主题下都不刺眼：
// 青瓷、雾紫、琥珀、雾蓝、藕粉、苔绿、黛蓝、赭石、橄榄、紫藤
const PSEC_COLORS = ['#4f9a8c', '#8a7bc0', '#c08a4a', '#5f8fc7', '#c47a90', '#6f9f68', '#5c6fae', '#b9775a', '#8d9450', '#a173b5']

let psecSeq = 0

const psec = (title, text) => ({ k: ++psecSeq, title, text })

const splitPersona = (body) => {
  const out = [psec(null, '')]
  let cur = out[0]
  let buf = []
  const flush = () => { cur.text = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''); buf = [] }
  for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    // 复制粘贴来的人设常带看不见的零宽字符（行首一个 U+200B），认标题时不算它
    const m = PSEC_HEAD.exec(line.replace(/[​-‍﻿]/g, '').trim())
    if (m) { flush(); cur = psec(m[1].trim(), ''); out.push(cur) } else buf.push(line)
  }
  flush()
  return out
}

const joinPersona = (secs) => secs
  .map((s) => (s.title === null ? s.text.trim() : '【' + (s.title.trim() || '未命名') + '】\n' + s.text.replace(/\s+$/, '')))
  .filter(Boolean).join('\n\n')

const autoRows = (text) => Math.min(22, Math.max(3, String(text || '').split('\n').length + 1))

/** 一节设定：标题、正文、上下移、删除、AI 润色。润色后原版和润色版只显示一个，按钮来回切，选定一个另一个就丢掉。 */

function PersonaSection({ sec, lead, first, last, onChange, onMove, onDelete, onPolish, pending, onPick, onFlip }) {
  const showing = pending ? (pending.view === 'new' ? pending.text : sec.text) : sec.text
  const color = lead ? 'var(--ab-sea)' : PSEC_COLORS[sec.k % PSEC_COLORS.length]
  return h('div', { className: cx('ab-psec', lead && 'lead', pending && 'cmp'), style: { '--c': color } },
    h('div', { className: 'ab-psec-head' },
      lead
        ? h('div', { className: 'ab-psec-fixed' }, '开场', h('small', null, 'ta是谁，一两段话'))
        : h('input', { className: 'ab-psec-title', value: sec.title, placeholder: '这一节叫什么', maxLength: 30, onChange: (e) => onChange({ title: e.target.value.replace(/[【】\n]/g, '') }) }),
      h('span', { className: 'ab-psec-n' }, showing.length + ' 字'),
      h('div', { className: 'ab-psec-act' },
        lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往上移', disabled: first || !!pending, onClick: () => onMove(-1) }, navIcon('M12 19V5M6 11l6-6 6 6')),
        lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往下移', disabled: last || !!pending, onClick: () => onMove(1) }, navIcon('M12 5v14M6 13l6 6 6-6')),
        lead ? null : h('button', { type: 'button', className: 'ab-ibtn danger', title: '删掉这一节', disabled: !!pending, onClick: onDelete }, navIcon('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'))),
      pending
        ? null
        : h(AiButton, { onClick: onPolish, empty: !sec.text.trim() })),
    h('textarea', {
      value: showing, rows: autoRows(showing), readOnly: !!pending,
      placeholder: lead ? '你是「…」，一个真实存在的人，正在用手机 QQ 和对面聊天。' : '- 一条一行，短句就好',
      onChange: (e) => onChange({ text: e.target.value }),
    }),
    pending ? h('div', { className: 'ab-compare' },
      h('span', { className: 'ab-compare-tag' }, pending.view === 'new' ? 'AI 润色版' : '原版'),
      h('span', { className: 'ab-muted ab-small' }, pending.view === 'new' ? '和原版比：' + (pending.text.length - sec.text.length >= 0 ? '多 ' : '少 ') + Math.abs(pending.text.length - sec.text.length) + ' 字' : '还没改过的样子'),
      h('div', { className: 'ab-spacer' }),
      h('button', { type: 'button', className: 'ab-chip solid', onClick: onFlip }, pending.view === 'new' ? '看原版' : '看润色版'),
      h(Btn, { small: true, kind: 'primary', onClick: () => onPick(pending.view) }, pending.view === 'new' ? '用润色版' : '保留原版')) : null)
}

function AiButton({ onClick, empty }) {
  const [busy, setBusy] = useState(false)
  return h('button', {
    type: 'button', className: 'ab-aibtn', disabled: busy, title: empty ? '让 AI 按这一节的标题先写一版' : '让 AI 把这一节改得更具体、更像真人',
    onClick: async () => { setBusy(true); try { await onClick() } finally { setBusy(false) } },
  },
  busy ? h('i', { className: 'ab-spin' }) : navIcon('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'),
  h('span', null, busy ? '润色中' : empty ? 'AI 写一版' : 'AI 润色'))
}

const personaDraftKey = (id) => 'aurabot.persona.draft.' + id

function PersonaImageSettings({ image, disabled, onSave }) {
  const [note, setNote] = useState(image.note || '')
  useEffect(() => { setNote(image.note || '') }, [image.id, image.note])
  return h('div', { style: { marginTop: 12 } },
    h('label', { className: 'ab-flex', style: { gap: 8, marginBottom: 10 } },
      h('input', { type: 'checkbox', checked: image.reference !== false, disabled, onChange: (e) => onSave({ reference: e.target.checked }) }),
      h('span', null, '用于生图参考')),
    h('label', { className: 'ab-muted ab-small' }, '图片备注',
      h('input', { className: 'ab-input', style: { width: '100%', marginTop: 6 }, value: note, maxLength: 120, disabled, placeholder: '如：工作服、常服、Q版形象', onChange: (e) => setNote(e.target.value) })),
    h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, disabled: disabled || note === (image.note || ''), onClick: async () => { const result = await onSave({ note }); if (result?.images) setNote(result.images.find((item) => item.id === image.id)?.note || '') } }, '保存备注')))
}

function PersonaLook({ edit, patch, look, setLook, saved, st, draft, setDraft, toast }) {
  const [busy, setBusy] = useState('')
  const [models, setModels] = useState(null)
  const [modelError, setModelError] = useState('')
  const modelRequest = useRef(0)
  const userRevision = useRef(0)
  const fileRef = useRef(null)
  const replaceRef = useRef(null)
  const replaceId = useRef(null)
  const request = useRef(0)
  const latest = useRef(null)
  const model = draft.personaLook?.visionModel || { provider: '', model: '' }
  const modelKey = model.provider && model.model ? model.provider + '::' + model.model : ''
  const modelDirty = JSON.stringify(model) !== JSON.stringify(st.config.personaLook?.visionModel || { provider: '', model: '' })
  latest.current = { id: edit.id, appearance: edit.appearance, modelKey, imageHash: look.imageHash }
  const loadModels = async () => {
    const token = ++modelRequest.current
    setModels(null); setModelError('')
    const r = await get('/models')
    if (token !== modelRequest.current) return
    setModels(r.list || [])
    if (r.ok === false) setModelError(r.message || '模型列表读取失败')
  }
  useEffect(() => {
    loadModels()
    return () => { modelRequest.current++; request.current++ }
  }, [])
  const options = [{ value: '', label: '跟随聊天模型' }, ...(models || []).map((m) => ({ value: m.provider + '::' + m.model, label: m.name + (m.vision === true ? '（能看图）' : m.vision === false ? '（不看图）' : ''), group: m.provider }))]
  if (modelKey && !options.some((m) => m.value === modelKey)) options.push({ value: modelKey, label: modelKey + '（当前配置）' })
  const run = async (kind, action) => {
    const token = ++request.current
    setBusy(kind)
    try { return await action(() => token === request.current) }
    catch (e) { if (token === request.current) toast(e.message || '操作失败', 'err') }
    finally { if (token === request.current) setBusy('') }
  }
  const images = look.images || (look.hasImage ? [{ id: 'legacy', hash: look.imageHash }] : [])
  const maxImages = look.maxImages || 8
  const upload = (files, imageId?) => {
    if (!files.length || busy || !saved) return
    const replacing = imageId !== undefined
    run('upload', async (valid) => {
      if (!replacing && images.length + files.length > maxImages) throw new Error(`每个人格最多 ${maxImages} 张人设图，请减少选择数量`)
      if (files.some((file) => file.size > 5 * 1024 * 1024)) throw new Error('每张人设图最多 5MB')
      let completed = 0
      for (const file of files) {
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(new Error('图片读取失败'))
            reader.onabort = () => reject(new Error('图片读取已取消'))
            reader.readAsDataURL(file)
          })
          if (!valid()) return
          const r = await post('/persona/look/upload', { id: edit.id, data, ...(replacing ? { imageId } : { append: true }) })
          if (!valid()) return
          if (!r.ok) throw new Error(r.message)
          setLook(r.look)
          completed++
        } catch (error) {
          throw new Error(`${completed ? `已保存 ${completed} 张；` : ''}${error.message}`)
        }
      }
      toast(replacing ? '这张人设图已替换' : `已新增 ${completed} 张人设图`, 'ok')
    })
  }
  const describe = () => run('describe', async (valid) => {
    const snapshot = { ...latest.current }
    const rev = userRevision.current
    const r = await post('/persona/look/describe', { id: edit.id })
    if (!valid()) return
    if (!r.ok) throw new Error(r.message)
    if (rev !== userRevision.current || JSON.stringify(snapshot) !== JSON.stringify(latest.current) || r.imageHash !== snapshot.imageHash) {
      toast('图片、描述或模型已变化，本次解析结果未填入，请重新解析')
      return
    }
    patch({ appearance: r.text, appearanceSource: 'vision', appearanceDirty: true })
    toast('描述已填入，确认后点击「保存人格」', 'ok')
  })
  return h('div', { className: 'ab-persona-look', style: { marginTop: 16, padding: 20, border: '1px solid var(--ab-line)', borderRadius: 12 } },
    h('strong', null, '人设图与外貌'),
    h('p', { className: 'ab-muted ab-small' }, '人设图只供识图与画自己时参考，不直接进入聊天上下文；与左侧「面板头像」分别保存。上传和删图立即生效，外貌文字随「保存人格」保存。'),
    !saved ? h('p', { className: 'ab-muted' }, '请先保存新人格，再上传人设图。') : null,
    h('p', { className: 'ab-muted ab-small' }, `最多 ${maxImages} 张，每张 5MB。生成外貌描述时综合全部图片；生图仅使用已开启的参考图，并按服务支持的数量传入。`),
    h('p', { className: 'ab-muted ab-small' }, '参考开关即时保存；备注点「保存备注」后生效，并随实际使用的图片加入生图提示。只支持单图时取已开启的第一张，不支持参考图时使用外貌文字，工具会说明实际使用情况。'),
    h('div', { className: 'ab-look-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 16, margin: '16px 0' } },
      images.map((image, index) => h('div', { key: image.id || 'legacy', className: 'ab-look-image', style: { padding: 14, border: '1px solid var(--ab-line)', borderRadius: 10, minWidth: 0 } },
        h('img', { src: API + '/persona/look/image?id=' + encodeURIComponent(edit.id) + (image.id ? '&imageId=' + encodeURIComponent(image.id) : '') + '&v=' + encodeURIComponent(image.hash || ''), alt: `人设图 ${index + 1}`, style: { display: 'block', width: '100%', height: 180, objectFit: 'contain' } }),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 10 } }, `人设图 ${index + 1} · ${image.reference === false ? '未用于生图' : '已开启生图参考'}`),
        h(PersonaImageSettings, { key: image.id, image, disabled: !!busy || !saved, onSave: (settings) => run('configure', async (valid) => {
          const r = await post('/persona/look/configure', { id: edit.id, imageId: image.id, ...settings })
          if (!valid()) return
          if (!r.ok) throw new Error(r.message)
          setLook(r.look)
          toast(settings.note !== undefined ? '图片备注已保存' : '生图参考选择已保存', 'ok')
          return r.look
        }) }),
        h('div', { className: 'ab-flex ab-look-actions', style: { gap: 10, paddingTop: 12, paddingBottom: 4, flexWrap: 'wrap' } },
          h(Btn, { small: true, disabled: !!busy || !saved, onClick: () => { replaceId.current = image.id; replaceRef.current?.click() } }, '替换这张'),
          h(Btn, { small: true, kind: 'danger', disabled: !!busy || !saved, onClick: () => run('delete', async (valid) => {
            const r = await post('/persona/look/delete', { id: edit.id, imageId: image.id })
            if (!valid()) return
            if (!r.ok) throw new Error(r.message)
            setLook(r.look)
            toast('已删除这张人设图，其他图片和外貌文字保留', 'ok')
          }) }, '删除这张'))))),
    h('input', { ref: fileRef, type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' }, onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; upload(files) } }),
    h('input', { ref: replaceRef, type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' }, onChange: (e) => { const files = Array.from(e.target.files || []).slice(0, 1); e.target.value = ''; upload(files, replaceId.current) } }),
    h('div', { className: 'ab-flex', style: { padding: '4px 0 18px', gap: 12, flexWrap: 'wrap' } },
      h(Btn, { small: true, disabled: !saved || !!busy || images.length >= maxImages, onClick: () => fileRef.current?.click() }, busy === 'upload' ? '上传中…' : '添加人设图'),
      h('span', { className: 'ab-muted ab-small' }, `${images.length} / ${maxImages} 张 · ${images.filter((image) => image.reference !== false).length} 张已开启生图参考`)),
    h(Row, { label: '外貌解析模型', hint: '仅用于读取人设图，生成外貌描述。' }, h(Select, { value: modelKey, options, onChange: (value) => {
      userRevision.current++
      const [provider, ...rest] = String(value).split('::')
      setDraft((previous) => setPath(previous, 'personaLook.visionModel', { provider: value ? provider : '', model: value ? rest.join('::') : '' }))
    } })),
    h('div', { className: 'ab-muted ab-small', style: { margin: '0 0 14px', lineHeight: 1.7 } },
      h('div', null, '点击「从人设图生成描述」时，才会把全部人设图发送给这个模型。需要支持看图的模型。'),
      h('div', null, '这项选择只影响外貌解析，不会更换聊天模型或生图模型。所有人格共用此设置；更换后先点页面底部「保存设置」。')),
    models === null ? h('p', { className: 'ab-muted ab-small' }, '正在读取模型列表…') : null,
    modelError ? h('div', { className: 'ab-flex' }, h('span', { className: 'ab-muted ab-small' }, modelError), h(Btn, { small: true, onClick: loadModels }, '重试模型列表')) : null,
    h(Row, { label: '外貌描述', hint: '最多 2000 字，可直接手写或修改生成结果。点击「保存人格」后，她在聊天和画自己时会采用这段外貌设定。' }, h('textarea', { className: 'ab-textarea', value: edit.appearance || '', maxLength: 2000, onChange: (e) => { userRevision.current++; patch({ appearance: e.target.value, appearanceSource: 'manual', appearanceDirty: true }) } })),
    h('div', { className: 'ab-flex', style: { padding: '14px 0 4px', gap: 12, flexWrap: 'wrap' } }, h(Btn, { small: true, disabled: !saved || !look.hasImage || !!busy || modelDirty, onClick: describe }, busy === 'describe' ? '正在生成描述…' : '从人设图生成描述'),
      h('span', { className: 'ab-muted ab-small' }, modelDirty ? '外貌解析模型已更换，请先点页面底部「保存设置」。' : look.stale ? '图片已更新，可重新生成描述，也可手动修改后保存人格。' : edit.appearanceDirty ? '描述尚未保存，请确认后点「保存人格」。' : '生成结果先填入文本框，确认后点「保存人格」才生效。')))
}

function Persona({ st, toast, reload, draft, setDraft }) {
  const [list, setList] = useState(st.personas)
  const [current, setCurrent] = useState(st.config.persona.current)
  // 记住上次编辑的人格：切走标签页再回来还编辑同一个，而不是跳回正在用的那个
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('aurabot.persona.sel') || st.config.persona.current } catch (e) { return st.config.persona.current } })
  const [edit, setEdit] = useState(null) // { id, name, tags, secs }
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState({}) // 节的 k → { text, view: 'new' | 'old' } AI 润色还没选定的
  const [whole, setWhole] = useState(() => { try { return localStorage.getItem('aurabot.persona.whole') === '1' } catch (e) { return false } })
  // 上次没保存的草稿：进来时只提示「要不要恢复」，不自动覆盖当前内容
  const [restore, setRestore] = useState(null)
  const [look, setLook] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)
  const revision = useRef(0)
  const editRef = useRef(edit)
  editRef.current = edit
  useEffect(() => () => { loadSeq.current++; revision.current++ }, [])
  useEffect(() => { try { localStorage.setItem('aurabot.persona.sel', sel) } catch (e) {} }, [sel])
  const load = async (id) => {
    const token = ++loadSeq.current
    setLoadError('')
    const r = await get('/persona/get?id=' + encodeURIComponent(id))
    if (token !== loadSeq.current) return
    if (!r.ok) { setLoadError(r.message || '人格读取失败'); return }
    const server = { id: r.persona.id, name: r.persona.name, tags: (r.persona.tags || []).join('，'), secs: splitPersona(r.persona.body), appearance: r.look?.appearance || '', appearanceSource: r.look?.source || 'manual', appearanceDirty: false }
    let localDraft = null
    try { const raw = localStorage.getItem(personaDraftKey(id)); if (raw) { const d = JSON.parse(raw); if (d && d.id === id && typeof d.body === 'string' && (d.body !== r.persona.body || d.name !== server.name || d.tags !== server.tags || (typeof d.appearance === 'string' && d.appearance !== server.appearance))) localDraft = d } } catch (e) {}
    revision.current++
    setEdit(server)
    setLook(r.look || {})
    setDirty(false)
    setRestore(localDraft)
    setPending({})
  }
  useEffect(() => { load(sel); return () => { loadSeq.current++ } }, [sel])
  // 编辑中的草稿只写 localStorage（不动磁盘）；切标签/刷新后在下次进来时提示是否恢复
  useEffect(() => {
    if (!edit || !dirty) return
    try { localStorage.setItem(personaDraftKey(edit.id), JSON.stringify({ id: edit.id, name: edit.name, tags: edit.tags, body: joinPersona(edit.secs), appearance: edit.appearance, appearanceSource: edit.appearanceSource, at: Date.now() })) } catch (e) {}
  }, [edit, dirty])
  const restoreDraft = () => {
    if (!restore) return
    revision.current++
    setEdit({ ...edit, name: restore.name ?? edit.name, tags: restore.tags ?? edit.tags, secs: splitPersona(restore.body), appearance: restore.appearance ?? edit.appearance, appearanceSource: restore.appearanceSource || 'manual', appearanceDirty: typeof restore.appearance === 'string' })
    setDirty(true)
    setRestore(null)
    toast('已恢复上次的改动（还没保存，确认后点「保存人格」）', 'ok')
  }
  const discardDraft = () => {
    try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {}
    setRestore(null)
    toast('已丢弃上次没保存的改动')
  }
  const refresh = async () => { const r = await get('/personas'); if (r.ok) { setList(r.list); setCurrent(r.current) } }
  const body = edit ? joinPersona(edit.secs) : ''
  const waiting = Object.keys(pending).length
  const save = async () => {
    if (saving) return
    const rev = revision.current
    const id = edit.id
    setSaving(true)
    const r = await post('/persona/save', { id, name: edit.name, tags: edit.tags.split(/[,，\s]+/).filter(Boolean), body, ...(edit.appearanceDirty ? { appearance: edit.appearance || '', appearanceSource: edit.appearanceSource } : {}) })
    setSaving(false)
    toast(r.message || (r.ok ? '保存好了' : '没保存成功'))
    if (r.ok) {
      if (editRef.current?.id === id && revision.current === rev) {
        setDirty(false); setRestore(null)
        setEdit((previous) => ({ ...previous, appearanceDirty: false }))
        setLook((previous) => previous.imageHash === r.look?.imageHash ? { ...previous, stale: r.look.stale } : previous)
        try { localStorage.removeItem(personaDraftKey(id)) } catch (e) {}
      }
      refresh()
    }
  }
  const patch = (p) => { revision.current++; setEdit((previous) => ({ ...previous, ...p })); setDirty(true) }
  const setSecs = (secs) => patch({ secs })
  const updSec = (k, p) => setSecs(edit.secs.map((s) => (s.k === k ? { ...s, ...p } : s)))
  const moveSec = (i, d) => { const n = edit.secs.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSecs(n) }
  const delSec = (s) => { if (s.text.trim() && !confirm('删掉「' + (s.title || '未命名') + '」这一节？')) return; setSecs(edit.secs.filter((x) => x.k !== s.k)) }
  const addSec = (title) => setSecs([...edit.secs, psec(title, '')])
  const polish = async (s) => {
    const r = await post('/persona/polish', { name: edit.name, title: s.title === null ? '' : s.title, text: s.text, others: edit.secs.filter((x) => x.k !== s.k).map((x) => (x.title === null ? '开场' : x.title)) })
    if (!r.ok) { toast(r.message || '润色没成功', 'err'); return }
    if (!s.text.trim()) { updSec(s.k, { text: r.text }); toast('写好了，不满意就接着改', 'ok'); return }
    setPending({ ...pending, [s.k]: { text: r.text, view: 'new' } })
  }
  const pick = (s, view) => {
    const next = { ...pending }
    delete next[s.k]
    setPending(next)
    if (view === 'new') updSec(s.k, { text: pending[s.k].text })
  }
  const flip = (s) => setPending({ ...pending, [s.k]: { ...pending[s.k], view: pending[s.k].view === 'new' ? 'old' : 'new' } })
  const setMode = (w) => { if (w && waiting) { toast('先把 AI 润色的那几节选定一版', 'err'); return } setWhole(w); try { localStorage.setItem('aurabot.persona.whole', w ? '1' : '0') } catch (e) {} }
  const titles = edit ? edit.secs.map((s) => s.title) : []
  const suggest = PSEC_SUGGEST.filter((t) => !titles.includes(t))
  return h('div', { className: 'ab-persona' },
    h('div', { className: 'ab-plist' },
      list.map((p) => h('button', { key: p.id, type: 'button', className: cx('ab-pitem', sel === p.id && 'on'), onClick: () => { if (p.id === sel) return; loadSeq.current++; revision.current++; setEdit(null); setSel(p.id) } },
        h('div', { className: 'nm' }, p.name, p.id === current ? h('span', { className: 'ab-badge' }, '正在用') : null),
        h('div', { className: 'tg' }, (p.tags || []).join(' · ') || p.id + ' · ' + p.chars + ' 字'))),
      h(Btn, { kind: 'ghost', onClick: () => { const id = 'persona-' + Date.now().toString(36); loadSeq.current++; revision.current++; setEdit({ id, name: '新人格', tags: '', appearance: '', appearanceSource: 'manual', appearanceDirty: false, secs: splitPersona('你是……\n\n【打字习惯】\n- 短句、口语，一次只说一两句。') }); setLook({}); setRestore(null); setSel(id); setDirty(true); setPending({}) } }, '＋ 新建人格'),
      h(AvatarCard, { st, toast, reload }),
    ),
    edit ? h(Card, { title: '编辑人格', desc: '人格写在系统提示词的最前面，按节写更好改。离开不会自动保存；切标签/切页面会先记住草稿，下次进来会问你要不要恢复；输入框里 Ctrl+Z 可撤回。保存后大肥鱼下一轮回复起就按新的来。',
      right: h('div', { className: 'ab-flex' },
        edit.id !== current ? h(Btn, { small: true, onClick: async () => { const r = await post('/persona/use', { id: edit.id }); toast(r.message); refresh(); reload() } }, '设为当前') : null,
        edit.id !== current ? h(Btn, { small: true, kind: 'danger', onClick: async () => {
          if (!confirm('删掉这个人格？')) return
          // 有自己目录的人格（不是根目录那个，也不在待认领）才有单独的记忆和会话可删
          const own = !st.persona?.claimPending && edit.id !== st.persona?.dataOwner
          const withData = own && confirm('这个人格的记忆和会话记录也一起删掉吗？删了找不回来。\n选「取消」只删人格，记忆留着，以后用同一个 id 新建人格还能接上。')
          const r = await post('/persona/delete', { id: edit.id, withData })
          if (r.ok) { try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {} setList(r.list); setSel(current) } else toast(r.message) } }, '删除') : null) },
      restore ? h('div', { className: 'ab-flex', style: { marginTop: 12, padding: '8px 10px', border: '1px solid #4a4a55', borderRadius: 8, background: 'rgba(255,255,255,.04)' } },
        h('span', { className: 'ab-small' }, '发现上次没保存的人格改动（' + String(restore.body || '').length + ' 字' + (restore.at ? '，' + new Date(restore.at).toLocaleString() : '') + '）。要恢复吗？'),
        h('div', { className: 'ab-spacer' }),
        h(Btn, { small: true, kind: 'primary', onClick: restoreDraft }, '恢复'),
        h(Btn, { small: true, kind: 'ghost', onClick: discardDraft }, '丢弃')) : null,
      h(Row, { label: '名字' }, h('input', { className: 'ab-input', value: edit.name, onChange: (e) => patch({ name: e.target.value }) })),
      h(Row, { label: '标签', hint: '用逗号隔开' }, h('input', { className: 'ab-input', value: edit.tags, onChange: (e) => patch({ tags: e.target.value }) })),
      h(PersonaLook, { key: edit.id, edit, patch, look, setLook, saved: list.some((p) => p.id === edit.id), st, draft, setDraft, toast }),
      h('div', { className: 'ab-flex', style: { marginTop: 14 } },
        h(Seg, { value: whole ? 'whole' : 'secs', onChange: (v) => setMode(v === 'whole'), options: [{ value: 'secs', label: '分节' }, { value: 'whole', label: '整段' }] }),
        h('div', { className: 'ab-spacer' }),
        h('span', { className: 'ab-muted ab-small' }, (edit.secs.length - 1) + ' 节 · ' + body.length + ' 字')),
      whole
        ? h('textarea', { className: 'ab-textarea', style: { minHeight: 380, marginTop: 12 }, value: body, onChange: (e) => setSecs(splitPersona(e.target.value)) })
        : h('div', { className: 'ab-psecs' },
          edit.secs.map((s, i) => h(PersonaSection, {
            key: s.k, sec: s, lead: s.title === null, first: i <= 1, last: i === edit.secs.length - 1, pending: pending[s.k],
            onChange: (p) => updSec(s.k, p), onMove: (d) => moveSec(i, d), onDelete: () => delSec(s),
            onPolish: () => polish(s), onPick: (v) => pick(s, v), onFlip: () => flip(s),
          })),
          h('div', { className: 'ab-psec-add' },
            h('span', { className: 'ab-muted ab-small' }, '加一节：'),
            suggest.map((t) => h('button', { key: t, type: 'button', className: 'ab-chip', onClick: () => addSec(t) }, t)),
            h('button', { type: 'button', className: 'ab-chip solid', onClick: () => addSec('') }, '＋ 自己起名'))),
      h('div', { className: 'ab-flex', style: { marginTop: 14 } },
        waiting ? h('span', { className: 'ab-muted ab-small' }, '还有 ' + waiting + ' 节 AI 润色没选定，选好再保存') : null,
        h('div', { className: 'ab-spacer' }),
        h(Btn, { kind: 'primary', disabled: !dirty || !!waiting || saving, onClick: save }, saving ? '保存中…' : dirty ? '保存人格' : '已保存')),
    ) : h(Card, null, loadError ? h('div', null, h('p', { className: 'ab-muted' }, loadError), h(Btn, { onClick: () => load(sel) }, '重试加载人格')) : h(Empty, { icon: '⏳', text: '加载中…' })),
  )
}

/**
 * 按工作区控制「审批 / 提问」要不要上报到 QQ。
 * 工作区是 DSH 动态登记的，所以单独拉接口，不走配置表单的 draft。
 */

function NoticeWorkspaces({ toast }) {
  const [info, setInfo] = useState(null)
  const load = async () => {
    try { setInfo(await get('/notice/state')) } catch (e) { setInfo({ ok: false, workspaces: [] }) }
  }
  useEffect(() => { load() }, [])
  const toggle = async (kind, workspace, value) => {
    try {
      await post('/notice/toggle', { kind, workspace, value })
      await load()
    } catch (e) { toast(e.message, 'err') }
  }
  const list = info?.workspaces || []
  const rows = list.map((w) => h(Row, { key: w.path, label: w.name, hint: w.path + (w.sessions ? ` · ${w.sessions} 个会话` : '') },
    h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
      h('span', { className: 'ab-small ab-muted' }, '审批'), h(Switch, { on: w.approval, onChange: (v) => toggle('approval', w.path, v) }),
      h('span', { className: 'ab-small ab-muted' }, '提问'), h(Switch, { on: w.question, onChange: (v) => toggle('question', w.path, v) }))))
  return h(Card, { title: '按工作区上报', desc: '哪个工作区的活卡在授权或提问上，就把那条消息发到 QQ。只通知，不代答；改动立即生效。' },
    list.length === 0
      ? h('div', { className: 'ab-muted ab-small' }, info ? '这个 DSH 里还没登记过工作区。' : '读取中…')
      : rows)
}

export { PSEC_HEAD, PSEC_SUGGEST, PSEC_COLORS, psecSeq, psec, splitPersona, joinPersona, autoRows, PersonaSection, AiButton, personaDraftKey, PersonaImageSettings, PersonaLook, Persona, NoticeWorkspaces }
