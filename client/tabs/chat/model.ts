import { useState, useEffect } from '../../core/ui/react.ts'
import { get, getCached, post } from '../../core/api/api.ts'
import { getPath, setPath } from '../../core/ui/format.ts'
import { fmtNextChange, isPeakAt, nextChangeAt } from '../../core/time/offpeak.ts'
import { Btn, Card, Empty, Row, Seg, Select, h, useField } from '../../core/ui/ui.ts'

// 和 src/features/companion.js 的 moodEffects 严丝合缝：心情区间 → 贴表情系数
const REACT_MOOD_BANDS = [['85 以上', 1.6], ['70–84', 1.25], ['50–69', 1], ['35–49', 0.5], ['35 以下', 0.3]]

// 音调存的是 '+20Hz' 这种字符串，滑条要数字；合法范围 ±80Hz（再往上 edge-tts 服务端会夹）
const pitchNum = (s) => {
  const m = /^([+-]?\d+)Hz$/i.exec(String(s || ''))
  return m ? Math.max(-80, Math.min(80, Number(m[1]))) : 0
}

const pitchText = (n) => (n < 0 ? '-' : '+') + Math.abs(n) + 'Hz'

const pitchLabel = (n) => (n === 0 ? '正常（+0Hz）' : (n > 0 ? '+' : '') + n + ' Hz')

function ChatModels({ draft, setDraft, list }) {
  const cm = draft.chatModels || { privateDefault: {}, groupDefault: {}, privates: {}, groups: {} }
  const [open, setOpen] = useState(false)
  const [add, setAdd] = useState({ kind: 'private', id: '', sel: '' })
  const key = (m) => m.provider + '::' + m.model
  const val = (s) => (s && s.provider && s.model ? s.provider + '::' + s.model : '')
  const toSel = (v) => { const [p, ...m] = v.split('::'); return v ? { provider: p, model: m.join('::'), reasoningEffort: '' } : { provider: '', model: '', reasoningEffort: '' } }
  const base = [{ value: '', label: '跟随全局模型', desc: '上面「聊天用的模型」' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider })))
  const optsFor = (v) => (v && !base.some((o) => o.value === v) ? base.concat([{ value: v, label: v.split('::').slice(1).join('::'), desc: '（DSH 里没找到）' }]) : base)
  const setCm = (patch) => setDraft(setPath(draft, 'chatModels', { ...cm, ...patch }))
  const rows = [['private', cm.privates || {}], ['group', cm.groups || {}]].flatMap(([kind, m]) => Object.entries(m).map(([id, sel]) => ({ kind, id, sel })))
  const label = (sel) => { const v = val(sel); const hit = (list || []).find((m) => key(m) === v); return hit ? hit.name : sel.model }
  const addRow = () => {
    if (!add.id || !add.sel) return
    const field = add.kind === 'private' ? 'privates' : 'groups'
    setCm({ [field]: { ...(cm[field] || {}), [add.id]: toSel(add.sel) } })
    setAdd({ ...add, id: '' })
  }
  const remove = (kind, id) => { const field = kind === 'private' ? 'privates' : 'groups'; const n = { ...(cm[field] || {}) }; delete n[id]; setCm({ [field]: n }) }
  // 思考强度：beta 的 chatEfforts 按「聊天 + 当前模型」各存一份，键是 JSON.stringify([provider, model])。
  const globalModel = draft.model || {}
  const EFFORTS = [
    { value: '', label: '跟随默认' },
    { value: 'low', label: '低（快）' },
    { value: 'high', label: '高' },
    { value: 'max', label: '最高' },
  ]
  const modelOf = (sel) => ({ provider: (sel && sel.provider) || globalModel.provider || '', model: (sel && sel.model) || globalModel.model || '' })
  const effortOf = (kind, id, sel) => {
    const m = modelOf(sel)
    if (!m.provider || !m.model) return ''
    return ((draft.chatEfforts || {})[`${kind}:${id}`] || {})[JSON.stringify([m.provider, m.model])] || ''
  }
  const setEffort = (kind, id, sel, eff) => {
    const m = modelOf(sel)
    if (!m.provider || !m.model) return
    const cid = `${kind}:${id}`
    const key = JSON.stringify([m.provider, m.model])
    const cur = { ...(draft.chatEfforts || {}) }
    const row = { ...(cur[cid] || {}) }
    if (eff) row[key] = eff
    else delete row[key]
    if (Object.keys(row).length) cur[cid] = row
    else delete cur[cid]
    setDraft(setPath(draft, 'chatEfforts', cur))
  }
  return h(Card, { title: '按聊天选模型 / 思考强度', desc: '顺序：这个私聊 > 这个群 > 所有私聊 / 所有群的默认 > 上面的全局模型。没选的一级就用下一级；选的模型在 DSH 里找不到时也自动退回。单个聊天的「思考强度」按「聊天 + 当前模型」各存一份（和 /effort 命令是同一份配置）。只有你能在这里改，聊天里的人换不了。换了之后从那个聊天的下一条消息起生效。' },
    h(Row, { label: '私聊默认模型' }, h(Select, { value: val(cm.privateDefault), width: 280, options: optsFor(val(cm.privateDefault)), onChange: (v) => setCm({ privateDefault: toSel(v) }) })),
    h(Row, { label: '群聊默认模型' }, h(Select, { value: val(cm.groupDefault), width: 280, options: optsFor(val(cm.groupDefault)), onChange: (v) => setCm({ groupDefault: toSel(v) }) })),
    h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, kind: 'ghost', onClick: () => setOpen(!open) }, (open ? '收起' : '展开') + '单个 QQ / 群的例外（' + rows.length + '）')),
    open ? h('div', { style: { marginTop: 8 } },
      rows.length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '还没有单独设置的 QQ 或群。') :
        rows.map((r) => h(Row, { key: r.kind + r.id, label: (r.kind === 'private' ? '私聊 ' : '群 ') + r.id },
          h('span', { className: 'ab-muted' }, label(r.sel)),
          h(Select, { value: effortOf(r.kind, r.id, r.sel), width: 140, options: EFFORTS, onChange: (v) => setEffort(r.kind, r.id, r.sel, v) }),
          h(Btn, { small: true, kind: 'ghost', onClick: () => remove(r.kind, r.id) }, '移除'))),
      h('div', { className: 'ab-flex' },
        h(Seg, { value: add.kind, onChange: (v) => setAdd({ ...add, kind: v }), options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群' }] }),
        h('input', { className: 'ab-input', placeholder: add.kind === 'private' ? 'QQ 号' : '群号', value: add.id, onChange: (e) => setAdd({ ...add, id: e.target.value.replace(/\D/g, '') }) }),
        h(Select, { value: add.sel, width: 220, options: base.filter((o) => o.value), placeholder: '选模型', onChange: (v) => setAdd({ ...add, sel: v }) }),
        h(Btn, { small: true, disabled: !add.id || !add.sel, onClick: addRow }, '添加'))) : null)
}

/** 模型页：DeepSeek 峰谷省钱模式（默认关，只影响后台模型调用时机，聊天回复不变）。 */

function CostCard({ draft, setDraft }) {
  const f = useField(draft, setDraft)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const off = !!getPath(draft, 'cost.offPeak')
  const holidays = getPath(draft, 'cost.offPeakHolidays') || []
  const peak = isPeakAt(now, holidays)
  const next = nextChangeAt(now, holidays)
  return h(Card, {
    title: 'DeepSeek 峰谷省钱模式',
    right: f.sw('cost.offPeak'),
    desc: '默认为关，现有行为不变。打开后只把「不着急的后台模型调用」尽量放到谷时，聊天回复不受影响。峰时 = 工作日北京时间 09:00–12:00、14:00–18:00；周末和法定节假日全天谷价，谷价约为峰价一半（以 DeepSeek 官网为准）。',
  },
    h(Row, { label: '现在的时段', hint: '按北京时间算；周末和下面填的节假日全天都算谷时' },
      h('span', { className: 'ab-small', style: { color: peak ? 'var(--ab-warn)' : 'var(--ab-ok)' } }, peak ? '峰时 · 省着用' : '谷时 · 可以跑'),
      next ? h('span', { className: 'ab-small ab-muted', style: { marginLeft: 8 } }, '下次切换 ' + fmtNextChange(next, now) + '（北京时间）') : null),
    off ? h(Row, { label: '峰时推迟什么', hint: '这些是额外的后台模型调用；聊天、工具、审批、定时任务本身不受影响，到点照常' },
      h('span', { className: 'ab-small ab-muted' }, '心情模型判断（退回关键词）/ 空闲提炼 / 记忆压缩 / 重复记忆合并 / 人物档案与说话风格整理 / 向量同步')) : null,
    off ? h(Row, { label: '法定节假日', hint: '一行一个 YYYY-MM-DD（北京时间）。中国法定节假日日期每年不同，这里不硬编码，按官网公布的放假日期自己填；填了当天全天按谷价' },
      f.list('cost.offPeakHolidays', { placeholder: '2026-10-01\n2026-10-02' })) : null,
  )
}

function Model({ draft, setDraft, toast }) {
  const [list, setList] = useState(null)
  const [ping, setPing] = useState({})
  useEffect(() => { getCached('/models').then((r) => setList(r.list || [])) }, [])
  const key = (m) => m.provider + '::' + m.model
  const cur = draft.model.provider && draft.model.model ? draft.model.provider + '::' + draft.model.model : ''
  const curModel = cur && list ? list.find((m) => key(m) === cur) : null
  // reasoning === null 表示 DSH 明确说这个模型不支持思考强度（本地 Ollama 之类）
  const noReasoning = Boolean(curModel && curModel.reasoning === null)
  // 视觉能力：自动时把 DSH 的声明显示出来，主人一眼能看出会不会降级
  const autoVision = curModel ? curModel.vision : undefined
  const visionHint = draft.model.vision === 'on'
    ? '强制当「能看图」；模型其实看不了的话，带图的那一轮会报错'
    : draft.model.vision === 'off'
      ? '强制当「看不懂」：收到图片只给一行文字提示，不会把图塞给模型'
      : autoVision === true
        ? '自动：DSH 说这个模型支持看图'
        : autoVision === false
          ? '自动：DSH 说这个模型看不了图，会自动降级成文字提示'
          : '自动：DSH 没声明，默认照发；真看不了就手动选「不支持」'
  const test = async (m) => {
    setPing({ ...ping, [key(m)]: '测速中…' })
    const r = await post('/model/ping', { provider: m.provider, model: m.model })
    setPing((p) => ({ ...p, [key(m)]: r.ok ? (r.ms / 1000).toFixed(1) + ' 秒' : '失败：' + (r.message || '') }))
  }
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '聊天用的模型', desc: '新建的 QQ 会话按这里的设置来；已有会话也可以在 DSH 里点开单独切换。聊天对速度很敏感，可以先点「测速」挑个快的。' },
      h(Row, { label: '思考强度', hint: noReasoning ? '这个模型不支持思考强度，会自动忽略' : '聊天建议「低」，回得快' }, h(Seg, { value: draft.model.reasoningEffort || 'low', disabled: noReasoning, onChange: (v) => setDraft(setPath(draft, 'model.reasoningEffort', v)), options: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }, { value: 'max', label: '最高' }] })),
      h(Row, { label: '视觉能力', hint: visionHint }, h(Seg, {
        value: draft.model.vision || 'auto',
        onChange: (v) => setDraft(setPath(draft, 'model.vision', v)),
        options: [{ value: 'auto', label: '自动' }, { value: 'on', label: '支持' }, { value: 'off', label: '不支持' }],
      })),
      h(Row, { label: '模型' },
        h(Select, {
          value: cur, width: 280,
          options: [{ value: '', label: '跟随 DSH 默认', desc: '和你在 DSH 里平时用的一样' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider }))),
          onChange: (v) => { const [p, ...m] = v.split('::'); setDraft(setPath(setPath(draft, 'model.provider', v ? p : ''), 'model.model', v ? m.join('::') : '')) },
        }),
        cur ? h(Btn, { small: true, onClick: () => test({ provider: draft.model.provider, model: draft.model.model }) }, '测速') : null,
        cur && ping[cur] ? h('span', { className: 'ab-muted ab-small' }, ping[cur]) : null),
    ),
    h(ChatModels, { draft, setDraft, list }),
    h(CostCard, { draft, setDraft }),
    h(Card, { title: '可用的模型', desc: '点「测速」会真的问一次模型（花一点点额度），看它回一句话要多久。' },
      list === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : list.length === 0 ? h(Empty, { text: 'DSH 没有列出模型' }) :
        h('table', { className: 'ab-table' }, h('tbody', null, list.map((m) => h('tr', { key: key(m) },
          h('td', null, m.name), h('td', { className: 'ab-muted' }, m.provider),
          h('td', null, ping[key(m)] || ''),
          h('td', { style: { textAlign: 'right' } }, h(Btn, { small: true, kind: 'ghost', onClick: () => test(m) }, '测速'), h(Btn, { small: true, kind: 'ghost', onClick: () => { setDraft(setPath(setPath(draft, 'model.provider', m.provider), 'model.model', m.model)); toast('选好了，记得保存') } }, '用这个')))))),
    ),
  )
}

/** 语音条变声：用「翻唱」页导入的 RVC 音色模型（TTS 后接一层 RVC）。
 *  flat=true 时不再自带卡片外框（由外层的折叠卡提供），避免卡片套卡片。
 *  get('/voice/song-voices') 只在本组件挂载时发一次，所以外层折叠卡收起时不挂载 = 不发请求。 */

function VoiceSongModel({ draft, setDraft, flat }) {
  const [s, setS] = useState(null)
  const f = useField(draft, setDraft)
  useEffect(() => { get('/voice/song-voices').then(setS).catch(() => setS({ ok: false, voices: [], message: '没查到翻唱音色' })) }, [])
  const voices = (s && s.voices) || []
  const rows = [
    h(Row, { key: 'v', label: '翻唱音色', hint: s && s.available === false ? (s.message || '翻唱环境还没装好，装好并导入音色后才能选') : '只列「翻唱」页导入过的 .pth 音色（带 index 的会标出来）' },
      f.select('voice.songVoice', [{ value: '', label: '不变声（TTS 原声）' }, ...voices.map((v) => ({ value: v.id, label: v.id + (v.hasIndex ? '（有 index）' : '') }))], { width: 280 })),
    h(Row, { key: 'p', label: '变调', hint: '模型是男声训练的、想变成女声一般 +12；不确定就 0' },
      f.num('voice.songPitch', { min: -24, max: 24 }), h('span', { className: 'ab-muted' }, ' 半音')),
    h('div', { key: 'n', className: 'ab-muted ab-small' }, !s ? '正在查翻唱音色…' : (s.available ? '变声要跑一次 RVC，会比普通语音慢几秒；单次变声失败会自动用原声。' : (s.message || '翻唱环境还没装好（面板「翻唱」页一键安装、导入音色后才能给语音条变声）'))),
  ]
  if (flat) return h('div', null, rows)
  return h(Card, { title: '语音条变声（用翻唱音色）', desc: '把ta说话的声音也换成「翻唱」页导入的 RVC 音色模型：先 TTS 念出来，再用同一个音色变声。默认不变声，直接用 TTS 原声；变声失败会自动回退原声，不影响发送。' }, rows)
}

/** 豆包语音（火山）：地址 / 请求头 / 请求体都内置好了，这里只挑音色、填 Key。 */
/** Breeze 云端音色：点一下拉列表，选中即填 voice id（不用去官网抄）。 */

export { REACT_MOOD_BANDS, pitchNum, pitchText, pitchLabel, ChatModels, CostCard, Model, VoiceSongModel }
