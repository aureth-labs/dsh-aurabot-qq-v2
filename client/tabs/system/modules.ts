import React, { useState, useEffect } from '../../core/ui/react.ts'
import { API, get, post } from '../../core/api/api.ts'
import { copy, getPath, setPath } from '../../core/ui/format.ts'
import { PanelBoundary } from '../../core/nav.ts'
import { Btn, Card, Empty, Range, Row, Seg, Select, Switch, cx, h, useField } from '../../core/ui/ui.ts'

// ---------------- 扩展：模块 ----------------
const MOD_STATE = (m) => {
  if (m.safeSkipped) return { cls: 'dim', text: '安全模式，没加载' }
  if (!m.enabled) return { cls: 'dim', text: '关着' }
  if (m.running === 'user' && m.builtin) return { cls: 'mine', text: '用的是你的版本' }
  if (m.running === 'user') return { cls: 'mine', text: '在跑' }
  if (m.running === 'builtin' && m.fallback) return { cls: 'warn', text: '你的版本没加载成功，先用内置的' }
  if (m.running === 'builtin') return { cls: '', text: '在跑' }
  return { cls: 'err', text: m.error ? '没加载成功' : '没在跑' }
}

/** 一个模块一行：开关、状态、报错，能复制来改 / 用回内置的 / 重新加载。 */

function ModuleRow({ m, draft, setModules, toast, reload }) {
  const s = MOD_STATE(m)
  const [open, setOpen] = useState(false)
  const setMod = async (patch) => {
    const r = await post('/save', { modules: { [m.id]: { ...((draft.modules || {})[m.id] || {}), ...patch } } })
    if (r.ok === false) return toast(r.message, 'err')
    toast(patch.enabled === false ? `「${m.name}」关掉了` : patch.enabled ? `「${m.name}」打开了` : '好了', 'ok')
    setModules(r.modules)
    reload()
  }
  const act = async (path, body, okMsg) => {
    const r = await post(path, body)
    toast(r.message || okMsg, r.ok === false ? 'err' : 'ok')
    if (r.list) setModules(r.list)
    if (r.modules) setModules(r.modules)
    if (r.prompt && r.ok) copy(r.prompt, toast)
    reload()
    return r
  }
  const remove = async (path, action) => {
    if (!confirm(`${action}「${m.name}」？` + (m.builtin ? '删掉后会用回内置版本。' : ''))) return
    const purge = confirm('把它的数据和设置也清掉吗？确定=一起清掉；取消=留着')
    await act(path, { id: m.id, purge }, action === '卸载' ? '卸载好了' : m.builtin ? '副本删掉了，现在用内置的' : '删掉了')
  }
  const what = [m.tools.length ? '工具：' + m.tools.join('、') : '', m.commands.length ? '命令：' + m.commands.map((c) => '/' + c).join(' ') : ''].filter(Boolean).join('　')
  const errs = (m.error ? [{ label: '加载', message: m.error }] : []).concat(m.errors || [])
  return h('div', { className: 'ab-mod' },
    h('div', { className: 'main' },
      h('div', { className: 'nm' }, m.name, h('code', null, m.id),
        h('span', { className: cx('ab-badge', s.cls) }, s.text),
        m.kind === 'adapter' ? h('span', { className: 'ab-badge', title: '适配器插件：把某个平台接进框架' }, '适配器') : null,
        m.outdated ? h('span', { className: 'ab-badge warn', title: '你复制 / 替换时内置的是 ' + m.forkedFrom + '，现在是 ' + m.builtinVersion }, '内置版本更新了') : null),
      m.description ? h('div', { className: 'ds' }, m.description) : null,
      what ? h('div', { className: 'what' }, what) : null,
      errs.length ? h('div', { className: 'ab-note err', style: { marginTop: 6 } },
        h('div', { style: { cursor: 'pointer' }, onClick: () => setOpen(!open) }, (open ? '▾ ' : '▸ ') + errs.length + ' 条报错：' + String(errs[0].message).split('\n')[0].slice(0, 120)),
        open ? h('div', { className: 'ab-code' }, errs.map((e: any) => (e.at ? new Date(e.at).toLocaleTimeString() + ' ' : '') + (e.label || '') + '：' + e.message).join('\n\n')) : null) : null,
      h('div', { className: 'acts' },
        m.hasUser ? h(Btn, { small: true, onClick: () => post('/modules/open?id=' + encodeURIComponent(m.id)).then((r) => toast(r.message)) }, '打开文件夹') : null,
        m.hasUser ? h(Btn, { small: true, onClick: () => get('/modules/prompt?id=' + encodeURIComponent(m.id)).then((r) => copy(r.prompt, toast, '复制好了，粘给 DSH，把【】里那句换成你想要的')) }, '复制给 DSH 的话') : null,
        m.hasUser && !m.safeSkipped ? h(Btn, { small: true, onClick: () => act('/modules/reload', { id: m.id }, '重新加载好了') }, '重新加载') : null,
        m.hasUser && m.community ? h(Btn, { small: true, kind: 'danger', onClick: () => remove('/modules/community/remove', '卸载'), title: '从市场卸载，源码和本地改动会归档到 modules/.trash' }, '卸载') : null,
        m.hasUser && !m.community ? h(Btn, { small: true, kind: 'danger', onClick: () => remove('/modules/remove', m.builtin ? '删除副本' : '删除'), title: m.builtin ? '删掉你复制 / 改的版本，之后用回内置模块' : '删掉 modules/' + m.id + ' 和它的缓存' }, m.builtin ? '删除副本' : '删除') : null)),
    h('div', { className: 'side' },
      h(Switch, { on: m.enabled, onChange: (v) => setMod({ enabled: v }), title: m.enabled ? '关掉这个模块' : '打开这个模块' }),
      m.builtin && m.hasUser ? h('label', { className: 'ab-small ab-muted', style: { display: 'flex', alignItems: 'center', gap: 6 } }, '用内置的', h(Switch, { on: m.useBuiltin, onChange: (v) => setMod({ useBuiltin: v }) })) : null))
}

/** 模拟测试：不上 QQ 试模块。发出去的只截下来看，不真发。 */

function Simulate({ toast }) {
  const [as, setAs] = useState('owner')
  const [kind, setKind] = useState('private')
  const [text, setText] = useState('')
  const [reply, setReply] = useState('')
  const [out, setOut] = useState(null)
  const [tools, setTools] = useState([])
  const [tool, setTool] = useState('')
  const [args, setArgs] = useState('{}')
  const [tout, setTout] = useState(null)
  useEffect(() => { get('/modules/tools?as=' + as + '&kind=' + kind).then((r) => { const l = r.list || []; setTools(l); if (!l.some((t) => t.name === tool)) setTool(l[0] ? l[0].name : '') }) }, [as, kind])
  const cur = tools.find((t) => t.name === tool)
  const run = async () => { const r = await post('/modules/simulate', { as, kind, text, reply }); if (r.ok === false) return toast(r.message, 'err'); setOut(r) }
  const call = async () => {
    let a
    try { a = JSON.parse(args || '{}') } catch (e) { return toast('参数要是 JSON，比如 {"city":"北京"}', 'err') }
    const r = await post('/modules/tool', { as, kind, name: tool, args: a })
    if (r.ok === false) return toast(r.message, 'err')
    setTout(r)
  }
  const sentList = (sent) => (sent && sent.length ? h('div', { className: 'ab-code' }, sent.map((s) => '→ ' + s.chatId + '：' + s.text).join('\n')) : h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '没有发出任何消息'))
  return h(Card, { title: '模拟测试', desc: '不用上 QQ 就能试模块：这里发出去的消息只截下来显示，不会真发到 QQ。（模块直接调 api.onebot 的操作，比如禁言、发空间，是真的会执行的；会改设置的内置命令不执行。）' },
    h(Row, { label: '假装是', hint: '谁在说话、在哪儿说' },
      h('div', { className: 'ab-flex' },
        h(Seg, { value: as, options: [{ value: 'owner', label: '主人' }, { value: 'other', label: '别人' }], onChange: setAs }),
        h(Seg, { value: kind, options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }], onChange: setKind }))),
    h(Row, { label: '发一条消息', hint: '看哪个模块接管、命令回什么（/开头是命令）' },
      h('input', { className: 'ab-input', value: text, placeholder: '比如：早安，或 /weather 北京', onChange: (e) => setText(e.target.value) })),
    h(Row, { label: 'ta的回复', hint: '可选：假设ta这样回，看经过各个模块改写后最后发出去什么（可以用 ||| 分条、<voice>…</voice>）' },
      h('input', { className: 'ab-input', value: reply, placeholder: '比如：早呀|||今天也要加油', onChange: (e) => setReply(e.target.value) })),
    h('div', { className: 'ab-flex' }, h(Btn, { kind: 'primary', small: true, disabled: !text.trim() && !reply.trim(), onClick: run }, '模拟')),
    out ? h('div', { style: { marginTop: 8 } }, out.steps.map((s, i) => h('div', { key: i, className: 'ab-small' }, '· ' + s)), sentList(out.sent)) : null,
    h('div', { className: 'ab-section-title' }, '调用工具'),
    tools.length ? h('div', null,
      h(Row, { label: '工具', hint: cur ? cur.description : '' }, h(Select, { value: tool, options: tools.map((t) => ({ value: t.name, label: t.name })), onChange: (v) => { setTool(v); setArgs('{}'); setTout(null) } })),
      cur && cur.parameters && Object.keys(cur.parameters.properties || {}).length ? h('div', { className: 'ab-small ab-muted', style: { margin: '0 0 6px' } }, '参数：' + Object.entries(cur.parameters.properties).map(([k, v]: [string, any]) => k + (v.description ? '（' + v.description + '）' : '')).join('；')) : null,
      h('textarea', { className: 'ab-textarea', style: { minHeight: 50, fontFamily: 'ui-monospace,Consolas,monospace' }, value: args, onChange: (e) => setArgs(e.target.value) }),
      h('div', { className: 'ab-flex', style: { marginTop: 6 } }, h(Btn, { small: true, onClick: call, disabled: !tool }, '调用')),
      tout ? h('div', null, h('div', { className: 'ab-code' }, JSON.stringify(tout.result, null, 2)), sentList(tout.sent)) : null)
      : h('div', { className: 'ab-small ab-muted' }, '这个场合没有工具'))
}

/** 写模块的教程：随插件带着，连不上 GitHub 也能看；复制后可以直接粘给 DSH。 */

const TUTORIAL_URL = 'https://github.com/aureth-labs/dsh-aurabot-qq-mods/blob/main/docs/TUTORIAL.md'

function ModuleTutorial({ toast }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const open = (e) => {
    if (!e.target.open || text) return
    get('/modules/tutorial').then((r) => (r.ok ? setText(r.text) : setErr(r.message)))
  }
  return h('details', { className: 'ab-card', onToggle: open },
    h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '想自己写一个？提交教程'),
    h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '从零写一个模块并提交到市场。不会写代码也行：复制全文粘给 DSH，告诉它你想要什么。'),
    h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
      h(Btn, { small: true, kind: 'primary', disabled: !text, onClick: () => copy(text, toast, '教程复制好了') }, '一键复制'),
      h('a', { className: 'ab-small', href: TUTORIAL_URL, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上看')),
    err ? h('div', { className: 'ab-note warn' }, err) : null,
    text ? h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', margin: 0 } }, text) : (err ? null : h('div', { className: 'ab-small ab-muted' }, '加载中…')))
}

/** 模块市场：逛、搜、装、更新、卸载社区模块。安装前给用户看来源和能力，能力声明不是沙箱。 */

const CAP_LABEL = { network: '联网', filesystem: '读写本机文件', process: '启动其他程序', 'dynamic-code': '动态执行代码', 'plugin-config': '读写插件配置（含账号 Cookie）', 'plugin-internals': '使用插件内部接口' }

const CATEGORY_LABEL = { platform: '逛平台', social: '聊天互动', creative: '创作', desktop: '桌面', manage: '管理', tool: '工具' }

const capText = (m) => (m.capabilities || []).map((c) => CAP_LABEL[c] || c)
/**
 * 模块排序（纯函数，测试可直接调用）：
 * - default：保持索引里的原顺序
 * - hot：按 GitHub 下载次数，同分按名字
 * - latest：按发布时间（索引 publishedAt → GitHub Release 时间），没时间的保持原顺序排最后
 * - updated：按最近更新时间（索引 updatedAt → publishedAt → Release 时间），同上
 */

const marketTimeOf = (m, mode) => {
  const fields = mode === 'latest' ? [m.publishedAt, m.releasedAt, m.updatedAt] : [m.updatedAt, m.publishedAt, m.releasedAt]
  for (const value of fields) {
    const t = Date.parse(String(value || ''))
    if (Number.isFinite(t)) return t
  }
  return 0
}

const sortMarketModules = (list, mode) => {
  const arr = Array.isArray(list) ? list.slice() : []
  if (mode === 'hot') {
    return arr.sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0) || String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh'))
  }
  if (mode === 'latest' || mode === 'updated') {
    return arr.map((m, i) => ({ m, i, t: marketTimeOf(m, mode) }))
      .sort((a, b) => b.t - a.t || a.i - b.i)
      .map((x) => x.m)
  }
  return arr
}

function Market({ st, toast, reload, go }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [prog, setProg] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState('hot') // hot | latest | updated | default
  const load = (force?) => get('/modules/community' + (force ? '?force=1' : '')).then(setData)
  useEffect(() => { load() }, [])
  // 模块市场地址：下拉选官方源（GitHub / Gitee 镜像）或自定义。拉当前值与可选源，改完可保存或恢复默认。
  const [regUrl, setRegUrl] = useState('')
  const [regDef, setRegDef] = useState('')
  const [regSources, setRegSources] = useState([])
  const [regMode, setRegMode] = useState('')
  const loadReg = () => get('/panel/market/registry').then((r) => {
    if (!r.ok) return
    setRegUrl(r.registryUrl || '')
    setRegDef(r.default || '')
    setRegMode('')
    if (Array.isArray(r.sources) && r.sources.length) setRegSources(r.sources)
  })
  useEffect(() => { loadReg() }, [])
  const REG_SOURCE_FALLBACK = [
    { id: 'github', label: 'GitHub 官方源', url: 'https://raw.githubusercontent.com/aureth-labs/dsh-aurabot-qq-market-dev/market/market.json' },
    { id: 'pages', label: 'GitHub Pages', url: 'https://aureth-labs.github.io/dsh-aurabot-qq-market-dev/market.json' },
    { id: 'custom', label: '自定义', url: '' },
  ]
  const regList = regSources.length ? regSources : REG_SOURCE_FALLBACK
  const regClean = String(regUrl || '').trim().replace(/\/+$/, '')
  const regMatched = (regList.find((s) => s.id !== 'custom' && s.url && s.url.replace(/\/+$/, '') === regClean) || {}).id
  const regPreset = regMode || regMatched || (regClean ? 'custom' : 'github')
  const pickSource = (id) => {
    const s = regList.find((x) => x.id === id)
    setRegMode(id)
    setRegUrl(s && s.url ? s.url : '')
  }
  const regHint = regPreset === 'pages'
    ? '使用 GitHub Pages 的 V2 市场索引。'
    : regPreset === 'custom'
      ? '自定义地址：填指向 index.json 的完整 http(s) 链接；留空等于用 GitHub 官方源。'
      : 'GitHub 官方源：默认地址，国内访问 raw.githubusercontent.com 可能不稳。'
  const saveReg = async (override?) => {
    setBusy('reg')
    try {
      const value = typeof override === 'string' ? override : String(regUrl).trim()
      const r = await post('/panel/market/registry', { registryUrl: value })
      if (!r.ok) toast(r.message || '没成功', 'err')
      else { toast(r.message || '保存好了', 'ok'); loadReg(); load(true) }
    } catch (e) { toast(e.message) } finally { setBusy('') }
  }
  // 一直查进度：恢复备份、老用户迁移时模块在后台装，不是从这个页面点的
  useEffect(() => {
    let was = false
    const tick = () => get('/modules/community/progress').then((r) => {
      const now = r.progress || null
      setProg(now)
      if (was && !now) load()
      was = Boolean(now)
    })
    const t = setInterval(tick, busy ? 300 : 1000)
    tick()
    return () => clearInterval(t)
  }, [busy])
  const percent = prog && prog.total ? Math.min(100, Math.round(prog.received / prog.total * 100)) : 0
  const stageText = () => {
    if (prog.stage === 'index') return '读取模块列表…'
    if (prog.stage === 'install') return '解压安装…'
    if (prog.stage === 'start') return '启动模块…'
    return '下载中 ' + (prog.total ? percent + '%' : Math.round(prog.received / 1024) + ' KB')
  }
  const progText = (word) => (prog ? stageText() : word + '中…')
  const STAGE_BAR = { index: 10, install: 90, start: 95 }
  const progBar = prog ? h('div', { className: 'ab-card', style: { marginBottom: 12 } },
    h('div', { className: 'ab-flex', style: { justifyContent: 'space-between' } }, h('b', null, '正在安装「' + (prog.name || prog.id) + '」'), h('span', { className: 'ab-muted ab-small' }, stageText())),
    h('div', { style: { height: 6, borderRadius: 3, background: 'var(--ab-foam-2)', marginTop: 8, overflow: 'hidden' } },
      h('div', { style: { height: '100%', width: (STAGE_BAR[prog.stage] || Math.max(12, 10 + percent * 0.8)) + '%', background: 'var(--ab-sea)', transition: 'width .3s' } }))) : null
  const done = async (r) => {
    toast(r.message, r.ok ? 'ok' : 'err')
    await load()
    reload()
  }
  const install = async (m) => {
    const caps = capText(m).join('、') || '无'
    const why = '来源：社区模块库 dsh-aurabot-qq-mods\n版本：' + m.version + '\n作者：' + m.author + '\n能力：' + caps + '\n\n能力声明不是沙箱：模块和插件在同一进程运行。继续吗？'
    if (!confirm((m.installed ? '更新' : '安装') + '「' + m.name + '」？\n\n' + why)) return
    if (m.replacesBuiltin && !confirm('「' + m.name + '」会替换同名内置模块，确定吗？')) return
    setBusy(m.id)
    try { await done(await post('/modules/community/install', { id: m.id, confirmReplace: Boolean(m.replacesBuiltin) })) } finally { setBusy('') }
  }
  const remove = async (m) => {
    if (!confirm('卸载「' + m.name + '」？\n模块目录和本地改动会移到 modules/.trash。')) return
    const purge = confirm('把模块数据和设置也清掉吗？\n确定 = 清除数据和设置\n取消 = 保留数据和设置，重装还能用')
    setBusy(m.id)
    try { await done(await post('/modules/community/remove', { id: m.id, purge })) } finally { setBusy('') }
  }
  const list = (data && data.list) || []
  const stats = (data && data.downloads) || {}
  const counts = { all: list.length, installed: list.filter((m) => m.installed).length, update: list.filter((m) => m.update).length }
  const word = q.trim().toLowerCase()
  const cats = [...new Set(list.map((m) => m.category).filter(Boolean))]
  // 安装量只能从 GitHub 读，读不到时热度排序不可用；最新发布/最近更新不受影响
  const canHot = !stats.failed && list.some((m) => Number(m.downloads) > 0)
  const effectiveSort = sort === 'hot' && !canHot ? 'default' : sort
  const timeMode = effectiveSort === 'latest' || effectiveSort === 'updated' ? effectiveSort : ''
  const filtered = list.filter((m) => (!cat || m.category === cat) && (show === 'all' || (show === 'installed' && m.installed) || (show === 'update' && m.update)) && (!word || (m.name + ' ' + m.id + ' ' + (m.description || '') + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(word)))
  const shown = sortMarketModules(filtered, effectiveSort)
  const missingTimes = timeMode ? shown.filter((m) => !marketTimeOf(m, timeMode)).length : 0
  const dateTextOf = (m) => { const t = marketTimeOf(m, timeMode || 'latest'); return t ? new Date(t).toISOString().slice(0, 10) : '' }
  const repoUrl = (m) => /^https?:\/\//i.test(String(m.source || '')) ? m.source : ''
  const num = (n) => (Number(n) >= 10000 ? (Number(n) / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(Number(n) || 0))
  const openSettings = (m) => {
    const running = (st.modules || []).find((x) => x.id === m.id)
    return running && running.tab ? () => go(running.tab) : null
  }
  const chip = (id, label) => h('button', { key: id, type: 'button', className: cx('ab-chip', show === id && 'on'), onClick: () => setShow(id) }, label, h('span', { className: 'n' }, counts[id]))
  const card = (m) => {
    const settings = m.installed ? openSettings(m) : null
    const note = [m.delisted ? '已从市场下架' : '', m.foreign ? '有同名的自己写的文件夹，不会覆盖' : '', m.blocked].filter(Boolean).join(' · ')
    const url = repoUrl(m)
    const title = url
      ? h('a', { href: url, target: '_blank', rel: 'noreferrer', title: '打开仓库主页', style: { color: 'inherit', textDecoration: 'none' } }, m.name)
      : m.name
    return h('div', { key: m.id, className: 'ab-card', style: { display: 'flex', flexDirection: 'column' } },
      h('h3', null, title, m.update ? h('span', { className: 'ab-badge' }, '可更新') : null),
      h('div', { className: 'ab-small ab-muted' }, 'v' + (m.installed || m.version) + (m.update ? ' → v' + m.version : '')
        + (m.kind === 'adapter' ? ' · 适配器' : '')
        + (Number(m.api) >= 2 ? ' · 接口 v2' : '')
        + (CATEGORY_LABEL[m.category] ? ' · ' + CATEGORY_LABEL[m.category] : '')
        + (m.author ? ' · ' + m.author : '') + (m.license ? ' · ' + m.license : '')),
      canHot ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 2 } }, '下载 ' + num(m.downloads) + ' 次' + (m.delisted ? '' : ' · 含更新')) : null,
      timeMode && dateTextOf(m) ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 2 } }, (timeMode === 'updated' ? '最近更新 ' : '发布于 ') + dateTextOf(m)) : null,
      h('p', { className: 'ab-desc', style: { margin: '8px 0' } }, m.description),
      capText(m).length ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 10 } }, '会用到：' + capText(m).join('、')) : null,
      note ? h('div', { className: 'ab-note warn', style: { marginBottom: 10 } }, note) : null,
      h('div', { className: 'ab-flex', style: { marginTop: 'auto' } },
        !m.installed && !m.foreign && !m.delisted ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => install(m) }, busy === m.id ? progText('安装') : '安装') : null,
        m.update ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => install(m) }, busy === m.id ? progText('更新') : '更新') : null,
        settings ? h(Btn, { small: true, onClick: settings }, '去设置') : null,
        m.installed ? h(Btn, { small: true, kind: 'ghost', disabled: Boolean(busy), onClick: () => remove(m) }, '卸载') : null))
  }
  return h('div', { className: 'ab-grid' },
    progBar,
    // 市场地址是低频设置：默认折叠，点标题才展开，别占着市场上面一整块
    h(Card, { title: '模块市场地址', collapsible: true, defaultOpen: false, desc: '选官方源，或填自己的索引——自建索引、ghproxy 中转、内网部署都行。换好后市场会立即按新地址刷新。' },
      h(Row, { label: '索引源', hint: regHint },
        h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap', width: '100%' } },
          h('select', { className: 'ab-select', 'aria-label': '模块市场索引源', value: regPreset, onChange: (e) => pickSource(e.target.value) },
            regList.map((s) => h('option', { key: s.id, value: s.id }, s.label))),
          h('input', { className: 'ab-input', style: { flex: '1 1 320px', minWidth: 220 }, value: regUrl, placeholder: regDef || 'https://…/registry/index.json', onChange: (e) => { setRegMode('custom'); setRegUrl(e.target.value) } }))),
      h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        h(Btn, { small: true, disabled: busy === 'reg', onClick: () => saveReg() }, busy === 'reg' ? '保存中…' : '保存地址'),
        h(Btn, { small: true, disabled: busy === 'reg' || regPreset === 'github', onClick: () => { setRegMode('github'); setRegUrl(regDef || ''); saveReg(regDef || '') } }, '恢复默认 GitHub 源'))),
    h(Card, { title: '模块市场', desc: '给ta装更多本事。模块由社区提供、维护者审核后上架；它们和插件在同一进程运行，能接触账号配置，装之前看清下面列的能力。下载次数来自模块库 GitHub Releases（更新也算一次），只是热度参考。', right: h(Btn, { small: true, kind: 'ghost', onClick: () => load(true) }, '刷新') },
      h('div', { className: 'ab-flex' },
        h('input', { className: 'ab-input', placeholder: '搜模块', value: q, onChange: (e) => setQ(e.target.value) }),
        chip('all', '全部'), chip('installed', '已安装'), chip('update', '可更新'),
        canHot ? h('button', { type: 'button', className: cx('ab-chip', effectiveSort === 'hot' && 'on'), onClick: () => setSort((v) => (v === 'hot' ? 'default' : 'hot')), title: '按模块安装包在 GitHub 上的下载次数排序' }, '按热度') : null,
        h('button', { type: 'button', className: cx('ab-chip', effectiveSort === 'latest' && 'on'), onClick: () => setSort((v) => (v === 'latest' ? 'default' : 'latest')), title: '按模块当前版本的发布时间排序（索引 publishedAt，缺失时用 GitHub Release 时间）' }, '最新发布'),
        h('button', { type: 'button', className: cx('ab-chip', effectiveSort === 'updated' && 'on'), onClick: () => setSort((v) => (v === 'updated' ? 'default' : 'updated')), title: '按模块最近更新时间排序（索引 updatedAt，缺失时用发布时间）' }, '最近更新')),
      cats.length > 1 ? h('div', { className: 'ab-flex', style: { marginTop: 10 } }, ([''] as any[]).concat(cats as any[]).map((c) => h('button', { key: c || 'any', type: 'button', className: cx('ab-chip', cat === c && 'on'), onClick: () => setCat(c) }, c ? CATEGORY_LABEL[c] || c : '全部分类'))) : null,
      stats.failed && list.length ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '这次没读到下载次数（GitHub 接口连不上或额度用完了），按热度排不了，可以改用「最新发布 / 最近更新」。') : null,
      missingTimes ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '有 ' + missingTimes + ' 个模块没有发布时间/更新时间，按原顺序排在最后。') : null,
      ((data && data.revoked) || []).map((r) => h('div', { key: r.id, className: 'ab-note err', style: { marginTop: 10 } }, '「' + r.id + '」' + r.version + ' 已撤回：' + r.reason + '。建议关闭或卸载。'))),
    !data ? h(Empty, { icon: '⏳', text: '加载中…' }) : null,
    data && data.ok === false ? h('div', { className: 'ab-note warn' }, '市场打不开：' + data.message) : null,
    data && data.ok !== false && !shown.length ? h(Empty, { icon: '🐟', text: list.length ? '没有符合条件的模块' : '市场里还没有模块' }) : null,
    shown.length ? h('div', { className: 'ab-grid ab-market-grid' }, shown.map(card)) : null,
    h(ModuleTutorial, { toast }))
}

/** 扩展页：所有模块（内置的 + 市场装的 + 自己写的）、安全模式；写模块的工具收在最下面。 */

function Modules({ st, draft, setDraft, toast, reload, go }) {
  const [data, setData] = useState(null)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const f = useField(draft, setDraft)
  const load = () => get('/modules').then(setData)
  useEffect(() => { load() }, [])
  useEffect(() => { if (data && st.modules) setData((d) => ({ ...d, list: st.modules })) }, [JSON.stringify(st.modules)])
  const setModules = (list) => list && setData((d) => ({ ...d, list }))
  if (!data) return h(Empty, { icon: '⏳', text: '加载中…' })
  const list = data.list || []
  const builtin = list.filter((m) => m.builtin)
  const mine = list.filter((m) => !m.builtin && !m.community)
  const fromCommunity = list.filter((m) => m.community)
  const props = { draft, setModules, toast, reload: () => { reload(); load() } }
  const create = async () => {
    const r = await post('/modules/create', { id: newId.trim(), name: newName.trim() })
    if (!r.ok) return toast(r.message, 'err')
    setNewId(''); setNewName('')
    setModules(r.list)
    copy(r.prompt, toast, '建好了，「复制给 DSH 的话」已经复制好，粘给 DSH 让它帮你写')
    reload()
  }
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '插件运行方式', desc: 'v2 插件（export function apply(ctx)）怎么跑。改完点下面的「保存设置」生效。' },
      h(Row, {
        label: '指令处理完，还继续走中间件',
        hint: '开发中：默认关（和 Koishi 一致）——指令回完这条就结束，不再进中间件和模型。'
          + '打开后指令也照样往下传，适合「指令只做副作用、回复交给中间件」的写法；'
          + '副作用是有人发了正好和指令同名的内容时，指令会把消息「抢走」。',
      }, f.sw('middlewareAfterCommand'))),
    h(Card, { title: '已安装', right: h(Btn, { small: true, kind: 'primary', onClick: () => go('market') }, '逛模块市场'), desc: 'ta的每项本事都是一个模块：能单独关掉；能复制一份来改，改了就替换内置的；也能自己写新模块，让ta学会你想要的任何事。自己写的东西放在下面这个文件夹，插件升级不会动；改完保存几秒内自动生效，不用重启。不会写代码？点「复制给 DSH 的话」，粘给 DSH，说你想要什么。' },
      h('div', { className: 'ab-flex' },
        h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, data.dir),
        h(Btn, { small: true, onClick: () => post('/modules/open').then((r) => toast(r.message)) }, '打开文件夹'),
        h(Btn, { small: true, onClick: () => copy(data.prompt, toast, '复制好了，粘给 DSH，把【】里那句换成你想要的') }, '复制给 DSH 的话'),
        h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/modules/reload', {}); setModules(r.list); toast(r.message) } }, '重新检查')),
      h(Row, { label: '安全模式', hint: '打开后你写的模块一个都不加载，内置的全部恢复。出了问题先开它，看是不是你的模块引起的。' },
        h(Switch, { on: st.config.safeMode, onChange: async (v) => { const r = await post('/save', { safeMode: v }); toast(v ? '安全模式开了：只跑内置模块' : '安全模式关了', 'ok'); setModules(r.modules); reload() } })),
      st.config.safeMode ? h('div', { className: 'ab-note warn' }, '安全模式开着：你写的模块现在都没加载。') : null),
    fromCommunity.length ? h(Card, { title: '从市场装的（' + fromCommunity.length + '）' }, h('div', null, fromCommunity.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
    mine.length ? h(Card, { title: '自己写的（' + mine.length + '）' }, h('div', null, mine.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
    h(Card, { title: '内置模块（' + builtin.length + '）', desc: '关掉的模块：ta就没有这项本事，相关的标签页也会藏起来。连接、权限、人格、聊天这些是核心，不能关。' },
      h('div', null, builtin.map((m) => h(ModuleRow, { key: m.id, m, ...props })))),
    h('details', { className: 'ab-card' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '写模块的工具'),
      h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '自己写模块或排查问题时才用得上。'),
      h('div', { className: 'ab-grid' },
    h(Card, { title: '新建一个模块', desc: '从模板建一个能直接跑的例子（关键词自动回复 + 一个命令 + 一个工具），在它上面改。id 用小写英文，比如 weather。想改内置的本事，用下面内置模块那一行的「复制一份来改」。' },
      h('div', { className: 'ab-flex' },
        h('input', { className: 'ab-input', style: { maxWidth: 180 }, placeholder: 'id，如 weather', value: newId, onChange: (e) => setNewId(e.target.value.toLowerCase()) }),
        h('input', { className: 'ab-input', placeholder: '名字，如 查天气', value: newName, onChange: (e) => setNewName(e.target.value) }),
        h(Btn, { kind: 'primary', small: true, disabled: !newId.trim(), onClick: create }, '新建'))),
        h(Simulate, { toast }))),
  )
}

/** 自己写的模块的面板：自动表单 + 模块自己的 panel.js。 */

// saveOverride：不传就照旧直接 POST 保存（模块自己的面板页）；传了就用调用方的保存流程。
// 「生图」页把 dsh-image 嵌进「接口格式」时传草稿保存：那里的一切改动都要跟着「保存设置」一起落盘，
// 否则同一个面板在两处行为不一致（一处即时生效，一处等保存）。
function ExtPanel({ m, settings, draftSettings, setSettings, toast, reload, saveOverride }) {
  const [Comp, setComp] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    fetch(API + '/modules/panel?id=' + encodeURIComponent(m.id) + '&t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('读不到 panel.js')))).then((src) => {
      // 接口挂载位置跟服务端一致：内置模块（以及从内置搬出去的）接口在根路径，别的模块在自己 /ext/<id>/ 下。
      // 按老写法一律拼 /ext/<id>，内置模块面板里的 call('/x') 会去请求 /ext/<id>/x，直接 404。
      const base = m.routesAtRoot ? '' : '/ext/' + m.id
      const call = (p, body) => (body === undefined ? get(base + p) : post(base + p, body))
      const ui = { Card, Btn, Switch, Row, Empty, Select, Seg, Range }
      const C = new Function('React', 'h', 'ui', 'call', src)(React, h, ui, call)
      if (typeof C !== 'function') throw new Error('panel.js 最后要 return 一个组件（函数）')
      if (alive) setComp(() => C)
    }).catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [m.id, m.startedAt])
  if (err) return h('div', { className: 'ab-note err' }, '面板加载失败：' + err)
  if (!Comp) return h(Empty, { icon: '⏳', text: '加载中…' })
  const save = async (patch) => { if (typeof saveOverride === 'function') return saveOverride(patch); const r = await post('/save', { ext: { [m.id]: patch } }); toast(r.ok === false ? r.message : '保存好了', r.ok === false ? 'err' : 'ok'); reload() }
  return h(PanelBoundary, null, h(Comp, { settings, draftSettings, setSettings, save, toast, reload }))
}

/**
 * 可复用插件的实例列表（ext.<id>.instances）。
 *
 * 一份代码多份配置：每个实例自己一套参数，宿主按 instances 逐个 apply。
 * 没填的字段沿用主配置——所以这里只在实例上写「和主配置不一样」的值。
 */
function InstanceEditor({ m, instances, setInstances, toast }) {
  const [name, setName] = useState('')
  const settings = m.settings || []
  const defaults = m.defaults || {}
  const setOne = (index, patch) => setInstances(instances.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  const patch = (index, key, value) => setOne(index, { config: { ...(instances[index].config || {}), [key]: value } })
  const add = () => {
    const id = String(name || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) return toast('实例名要字母或数字开头，只能用小写字母、数字、- 和 _', 'err')
    if (instances.some((item) => String(item.id) === id)) return toast('这个实例名已经用了', 'err')
    setInstances([...instances, { id, enabled: true, config: {} }])
    setName('')
  }
  const field = (item, index, s) => {
    const value = (item.config || {})[s.key] ?? ''
    const hint = s.type === 'password' ? '留空 = 用主配置那一份' : (defaults[s.key] != null && value === '' ? '默认 ' + defaults[s.key] : (s.placeholder || ''))
    if (s.type === 'switch') return h(Switch, { on: (item.config || {})[s.key] === true, onChange: (v) => patch(index, s.key, v) })
    if (s.type === 'number') return h('input', { className: 'ab-input sm', type: 'number', value, min: s.min, max: s.max, step: s.step, onChange: (e) => patch(index, s.key, e.target.value === '' ? '' : Number(e.target.value)) })
    if (s.type === 'select') return h(Select, { value, options: (s.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)), onChange: (v) => patch(index, s.key, v) })
    if (s.type === 'textarea') return h('textarea', { className: 'ab-textarea', value, onChange: (e) => patch(index, s.key, e.target.value) })
    return h('input', { className: 'ab-input', type: s.type === 'password' ? 'password' : 'text', value, placeholder: hint, onChange: (e) => patch(index, s.key, e.target.value) })
  }
  return h(Card, { title: '实例', desc: '这份插件可以同时跑多份配置：每个实例一套参数，互不影响（适配器多账号就靠它）' },
    instances.length
      ? instances.map((item, index) => h('div', { key: String(item.id), className: 'ab-note', style: { marginBottom: 10 } },
        h('div', { className: 'ab-flex' },
          h('strong', null, '实例 · ' + item.id),
          h(Switch, { on: item.enabled !== false, onChange: (v) => setOne(index, { enabled: v }) }),
          h(Btn, { small: true, kind: 'danger', onClick: () => setInstances(instances.filter((_, i) => i !== index)) }, '删除')),
        settings.map((s) => h(Row, { key: s.key, label: s.label || s.key, hint: s.hint }, field(item, index, s))),
        settings.length ? h('div', { className: 'ab-small ab-muted' }, '没填的字段沿用上面主配置的值。') : null))
      : h('div', { className: 'ab-small ab-muted' }, '还没有额外实例。上面那份是主实例；要同时跑第二个账号，就在下面加一个实例。'),
    h('div', { className: 'ab-flex', style: { marginTop: 8 } },
      h('input', { className: 'ab-input', value: name, placeholder: '新实例名，比如 second', onChange: (e) => setName(e.target.value) }),
      h(Btn, { small: true, onClick: add }, '添加实例')))
}

function ExtPage({ st, draft, setDraft, toast, reload, mod, embedded }) {
  const m = (st.modules || []).find((x) => x.id === mod)
  const f = useField(draft, setDraft)
  if (!m) return h(Empty, { icon: '🧩', text: '这个模块没在跑了' })
  const base = 'ext.' + m.id + '.'
  const settings = { ...(m.defaults || {}), ...((st.config.ext || {})[m.id] || {}) }
  const draftSettings = { ...(m.defaults || {}), ...((draft.ext || {})[m.id] || {}) }
  const setSettings = (patch) => setDraft((previous) => ({ ...previous, ext: { ...previous.ext, [m.id]: { ...(previous.ext || {})[m.id], ...patch } } }))
  // 实例列表整块替换：数组用点路径写会变成 {"0":…} 对象，不能走 setPath
  const instances = Array.isArray((draft.ext || {})[m.id]?.instances) ? draft.ext[m.id].instances : []
  const setInstances = (next) => setDraft((previous) => ({ ...previous, ext: { ...previous.ext, [m.id]: { ...(previous.ext || {})[m.id], instances: next } } }))
  const field = (s) => {
    const p = base + s.key
    if (s.type === 'switch') return f.sw(p)
    if (s.type === 'number') return f.num(p, { min: s.min, max: s.max, step: s.step })
    if (s.type === 'select') return f.select(p, (s.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)))
    if (s.type === 'textarea') return h('textarea', { className: 'ab-textarea', value: getPath(draft, p) ?? '', placeholder: s.placeholder, onChange: (e) => setDraft(setPath(draft, p, e.target.value)) })
    if (s.type === 'password') return f.text(p, { type: 'password', placeholder: getPath(draft, p + 'Set') ? '已保存（不改就留空）' : s.placeholder || '' })
    return f.text(p, { placeholder: s.placeholder })
  }
  return h('div', { className: 'ab-grid' },
    ((m.settings || []).length || (m.errors || []).length || !m.panel) ? h(Card, { title: m.name, desc: m.description, right: h('span', { className: 'ab-badge mine' }, embedded ? '扩展模块 · ' + m.id : m.id) },
      (m.settings || []).map((s) => h(Row, { key: s.key, label: s.label || s.key, hint: s.hint }, field(s))),
      (m.settings || []).length ? h('div', { className: 'ab-small ab-muted' }, '改完点下面的「保存设置」。') : null,
      (m.errors || []).length ? h('div', { className: 'ab-note err', style: { marginTop: 8 } }, '最近的报错：' + m.errors[0].message) : null) : null,
    m.reusable ? h(InstanceEditor, { m, instances, setInstances, toast }) : null,
    m.panel ? h(ExtPanel, { m, settings, draftSettings, setSettings, toast, reload }) : null)
}

export { MOD_STATE, ModuleRow, Simulate, TUTORIAL_URL, ModuleTutorial, CAP_LABEL, CATEGORY_LABEL, capText, marketTimeOf, sortMarketModules, Market, Modules, ExtPanel, ExtPage }
