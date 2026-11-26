import { useState, useEffect, Fragment } from '../core/react.ts'
import { get, post } from '../core/api.ts'
import { getPath, setPath, timeAgo } from '../core/format.ts'
import { Btn, Card, Empty, Row, Select, Switch, cx, h, useField } from '../core/ui.ts'

// 「自驱引擎」独立页（少爷定的：不属于主动搭话，单独一页）。
// P0 只有地基（审计哈希链 + 状态），引擎闭环（立项/做事/做梦）在 P1 之后逐期点亮；
// 数据走 /autotelic/status，参数就是 ext.autotelic.*（模块 defaults 里全有）。
// 自驱引擎的出厂默认（跟 src/modules/autotelic 的 defaults 对齐；滑块控件在草稿没值时兜底显示用）。
const AUTOTELIC_DEFAULTS = { enabled: false, presetIdOverride: false, minCuriosity: 0.55, evalModel: '', maxCandidates: 3, allowAct: true, actTimeoutMs: 180000, maxSteps: 8, maxTasksActive: 8, budgetActionsPerHour: 12, quietFrom: '23:30', quietTo: '07:30', dailyReviewHour: 23, minBatchForReview: 3, dreamFrom: '03:00', dreamTo: '05:00', allowUserModules: true, allowPython: true, pythonBin: '', scriptTimeoutMs: 120000 }

function Autotelic({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(null)
  const [pv, setPv] = useState(null)
  const [showPv, setShowPv] = useState(false)
  const [busy, setBusy] = useState('')
  const [jr, setJr] = useState(null)
  const [openDay, setOpenDay] = useState(null)
  const load = () => get('/autotelic/status').then((r) => { if (r.ok) setS(r); else setS(null) }).catch(() => setS(null))
  const loadJournal = () => get('/autotelic/journal').then((r) => { if (r.ok) setJr(r) }).catch(() => {})
  useEffect(() => { load(); loadJournal(); const t = setInterval(load, 15000); return () => { clearInterval(t) } }, [])
  const doPreview = async () => { setBusy('preview'); try { const r = await get('/autotelic/preview'); setPv(r); setShowPv(true) } catch (e) { toast(e.message, 'err') } finally { setBusy('') } }
  const act = async (key, path) => {
    setBusy(key)
    try { const r = await post(path, {}); toast(r.message || '这轮结束了', r.ok === false ? 'err' : 'ok') }
    catch (e) { toast(e.message, 'err') } finally { setBusy(''); load() }
  }
  const tasks = (s && s.tasks) || []
  const sm = (s && s.summary) || {}
  const TASK_BADGE = { active: '在办', done: '办成', failed: '失败', blocked: '卡住', abandoned: '放弃' }
  // 点任务行 → 打开「这一天的记录」弹窗（当天审计流水 + 任务 + 复盘刊物）
  const [dayM, setDayM] = useState(null) // { date, data }
  const dkey = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) }
  const openTaskDay = (t) => {
    const date = dkey(t.updatedAt || t.createdAt)
    setDayM({ date, taskId: t.id, data: null })
    get('/autotelic/day?date=' + date + '&taskId=' + encodeURIComponent(t.id)).then((r) => { if (r.ok) setDayM({ date, taskId: t.id, data: r }); else { toast(r.message || '没读到', 'err'); setDayM(null) } }).catch((e) => { toast(e.message, 'err'); setDayM(null) })
  }
  const clipText = (v, n) => { const t = String(v || ''); return t.length > n ? t.slice(0, n) + '…' : t }
  // 审计行用纯文本堆叠（不玩 flex 固定宽），样式全部沿用页面既有类
  const auditLine = (a, i) => h('div', { key: i, className: 'ab-small', style: { padding: '3px 0', borderBottom: '1px dashed var(--ab-line, #dbe5ea)', wordBreak: 'break-all' } },
    a.kind === 'tool/denied'
      ? h('span', { style: { color: '#c62828' } }, '⛔ ' + clipText((a.at || '').slice(11, 19) + '　' + (a.kind || '') + (a.tool ? ' · ' + a.tool : '') + '　' + clipText(a.outcome || a.args || '', 160), 220))
      : clipText((a.at || '').slice(11, 19) + '　' + (a.kind || '') + (a.tool ? ' · ' + a.tool : '') + '　' + clipText(a.outcome || (typeof a.args === 'string' ? a.args : JSON.stringify(a.args) || ''), 160), 260))
  const dayModal = dayM ? h('div', { style: { position: 'fixed', top: '0px', left: '0px', right: '0px', bottom: '0px', background: 'rgba(12,28,38,.45)', zIndex: '80', overflowY: 'auto', padding: '24px' }, onClick: () => setDayM(null) },
    h('div', { className: 'ab-card', style: { maxWidth: '760px', margin: '0px auto' }, onClick: (e) => e.stopPropagation() },
      h('div', { className: 'ab-flex', style: { alignItems: 'center', marginBottom: '8px' } },
        h('b', null, '这条任务的流水账'),
        h('span', { style: { flex: '1 1 auto', display: 'inline-block' } }),
        h(Btn, { small: true, onClick: () => setDayM(null) }, '关闭')),
      !dayM.data ? h(Empty, { icon: '⏳', text: '读账本中…' }) : h(TaskDayBody, { data: dayM.data, clipText, TASK_BADGE, auditLine }),
    )) : null
  const chain = s && s.audit && s.audit.chain
  const lastBeat = s && s.heartbeats && s.heartbeats.length ? s.heartbeats[s.heartbeats.length - 1] : null
  // 状态 pill：一眼看清「她在不在动 + 账本干不干净」
  const pill = (cls, text) => h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', cls) }), text)
  const pills = !s ? [pill('', '加载中…')] : [
    pill(s.enabled ? (s.running ? '' : 'ok') : '', s.enabled ? (s.running ? '正在想' : '开着 · 待心跳') : '已关闭'),
    pill(chain ? (chain.ok ? 'ok' : 'err') : '', chain ? (chain.ok ? '账本完整 · 今日 ' + (s.audit.today || 0) + ' 条' : '⚠ 账本断了') : '账本…'),
    pill(s.audit && s.audit.wired ? 'ok' : '', s.audit && s.audit.wired ? '审计已接线' : '审计未接线'),
    s.enabled ? pill('', lastBeat ? '上次心跳 ' + timeAgo(lastBeat.at) : '还没心跳') : null,
  ].filter(Boolean)
  // 「她在想的事」分页 + 状态筛选（点行还是打开这条任务的流水账）
  const [tFilter, setTFilter] = useState('all')
  const [tPage, setTPage] = useState(0)
  const PER_PAGE = 6
  const tFiltered = tasks.filter((t) => tFilter === 'all' || t.status === tFilter)
  const tPages = Math.max(1, Math.ceil(tFiltered.length / PER_PAGE))
  const tPageSafe = Math.min(tPage, tPages - 1)
  const tShown = tFiltered.slice(tPageSafe * PER_PAGE, tPageSafe * PER_PAGE + PER_PAGE)
  const STATUS_OPTS = [['all', '全部'], ['active', '在办'], ['done', '办成'], ['failed', '失败'], ['blocked', '卡住'], ['abandoned', '放弃']]
  const taskLine = (t) => h('div', { key: t.id, className: 'ab-li', style: { cursor: 'pointer' }, title: '点开看这条任务的流水账', onClick: () => openTaskDay(t) },
    h('div', { className: 'meta' },
      h('b', null, t.title), ' ',
      h('span', { className: 'ab-badge' }, TASK_BADGE[t.status] || t.status),
      h('div', null, '好奇 ' + (t.score != null ? t.score.toFixed(2) : '?')),
      h('div', null, timeAgo(t.updatedAt || t.createdAt))),
    // 注意：.ab-li 是横排 flex，meta 之外的所有内容必须包进单个 .body（flex:1），
    // 多塞一个直接子项就会被挤成零宽、文字一字一行竖排（少爷真机抓到的就是这个）
    h('div', { className: 'body ab-small' },
      h('div', null, t.reason),
      t.why ? h('div', { style: { color: '#c62828' } }, '→ ' + t.why) : null))
  // 复盘刊物：默认只露标题，点开才看全文（页面不都被长文淹没）
  const jLine = (kind, d) => {
    const open = openDay === kind + d.day
    const head = h('div', { className: 'meta', style: { cursor: 'pointer' }, onClick: () => setOpenDay(open ? null : kind + d.day) },
      h('b', null, (kind === 'daily' ? '每日一页' : '做梦') + ' · ' + d.day), ' ', h('span', { className: 'ab-muted ab-small' }, open ? '▲ 收起' : '▼ 展开'))
    return h('div', { key: kind + d.day, className: 'ab-li' }, head,
      open ? h('div', { className: 'body ab-small', style: { whiteSpace: 'pre-wrap' } }, d.text) : null)
  }
  const jAll = jr ? [...(jr.daily || []).map((d) => jLine('daily', d)), ...(jr.dreams || []).map((d) => jLine('dream', d))] : null
  // ---------- 控件：数值 = 滑块 + 文本框；时间 = 原生 time 控件 + 一键清空 ----------
  const A = 'ext.autotelic'
  // 兼容旧版本面板 bug：设置被写进 ext.autotelic[""]，读取时把空键里的值并回父级。
  const mergeLegacy = (v) => {
    if (!v || typeof v !== 'object' || !v[''] || typeof v[''] !== 'object') return v || {}
    const rest = { ...v }
    delete rest['']
    return { ...v[''], ...rest }
  }
  const aut = mergeLegacy(getPath(draft, A, {}))
  const ap = (patch) => setDraft((previous) => {
    const cur = mergeLegacy(getPath(previous, A, {}))
    return setPath(previous, A, { ...cur, ...patch })
  })
  const dv = (k) => { const v = aut[k]; return v == null ? AUTOTELIC_DEFAULTS[k] : v }
  // 数值双联：滑杆拖个大概，框里填精确值（照「桌宠·人物大小」那行的样式）
  const NumRow = ({ label, hint, k, min, max, step = 1, suffix = '' }) => h(Row, { label, hint },
    h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
      h('input', { type: 'range', min, max, step, style: { flex: 1, minWidth: 110, accentColor: 'var(--ab-sea, #2a86c6)' }, value: Number(dv(k)), onChange: (e) => ap({ [k]: Number(e.target.value) }) }),
      h('input', { className: 'ab-input', type: 'number', min, max, step, style: { width: '84px' }, value: Number(dv(k)), onChange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) ap({ [k]: v }) } }),
      suffix ? h('span', { className: 'ab-muted ab-small', style: { whiteSpace: 'nowrap' } }, suffix) : null))
  // 时间对（起~止）：原生 time 控件；两格都空 = 该功能关闭
  const TimeRow = ({ label, hint, kf, kt, clearHint }) => h(Row, { label, hint },
    h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
      h('input', { className: 'ab-input', type: 'time', style: { width: '118px' }, value: String(aut[kf] || ''), onChange: (e) => ap({ [kf]: e.target.value }) }),
      h('span', { className: 'ab-muted ab-small' }, '到'),
      h('input', { className: 'ab-input', type: 'time', style: { width: '118px' }, value: String(aut[kt] || ''), onChange: (e) => ap({ [kt]: e.target.value }) }),
      h(Btn, { small: true, onClick: () => ap({ [kf]: '', [kt]: '' }) }, '清空=关'),
      aut[kf] && aut[kt] ? h('span', { className: 'ab-muted ab-small' }, clearHint || '') : h('span', { className: 'ab-muted ab-small' }, '未启用')))
  // 节奏预设：一键铺一整套作息；「恢复默认」回到出厂值
  const PRESETS = {
    default: { name: '恢复默认（出厂作息）', v: { quietFrom: '23:30', quietTo: '07:30', dailyReviewHour: 23, minBatchForReview: 3, dreamFrom: '03:00', dreamTo: '05:00', minCuriosity: 0.55, maxSteps: 8, maxTasksActive: 8, budgetActionsPerHour: 12, maxCandidates: 3 } },
    standard: { name: '标准（23:30 睡，03 点做梦）', v: { quietFrom: '23:30', quietTo: '07:30', dailyReviewHour: 23, minBatchForReview: 3, dreamFrom: '03:00', dreamTo: '05:00' } },
    night: { name: '夜猫子（02:00 睡，10:00 起）', v: { quietFrom: '02:00', quietTo: '10:00', dailyReviewHour: 1, minBatchForReview: 3, dreamFrom: '05:00', dreamTo: '07:00' } },
    early: { name: '早起鸟（21:00 睡，05:00 起）', v: { quietFrom: '21:00', quietTo: '05:00', dailyReviewHour: 20, minBatchForReview: 3, dreamFrom: '23:00', dreamTo: '01:00' } },
    always: { name: '全天候（不设安静时段）', v: { quietFrom: '', quietTo: '', dreamFrom: '', dreamTo: '', dailyReviewHour: 22, minBatchForReview: 3 } },
  }
  const [preset, setPreset] = useState('')
  const applyPreset = (name) => {
    setPreset(name)
    if (name && PRESETS[name]) { ap(PRESETS[name].v); toast('已套用：' + PRESETS[name].name + '（记得点右下角「保存设置」）', 'ok') }
  }
  return h('div', { className: 'ab-grid' },
    // ---------- 卡 1：总控 + 状态 + 动作 ----------
    h(Card, { title: '自驱引擎（实验）', right: f.sw('ext.autotelic.enabled'), desc: 'v5：观察积累 → 定时回味/心念点火 → 三段决策环 → 行动单执行 → 技能沉淀 → 反馈回路。默认关闭；实验性功能，行为与配置面可能随版本调整。' },
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6, marginBottom: 10 } }, pills),
      h(Row, { label: '允许后台会话指定 preset', hint: '开着她做事才带工具（fs 只读；无 shell、无 QQ 工具）；关着只「想」不动' }, f.sw('ext.autotelic.presetIdOverride')),
      chain && !chain.ok ? h('div', { className: 'ab-note err', style: { marginTop: 8 } }, '⚠ 账本断链 @ ' + chain.brokenAt.file + ' 第 ' + chain.brokenAt.line + ' 条：' + chain.brokenAt.reason) : null,
      h('div', { style: { marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--ab-line, #dbe5ea)' } },
        h('div', { className: 'ab-small ab-muted', style: { marginBottom: 6 } }, '手动推一把（开着总开关才有反应）：'),
        h('div', { className: 'ab-flex' },
          h(Btn, { small: true, kind: 'primary', onClick: () => act('run', '/autotelic/run'), disabled: busy === 'run' }, busy === 'run' ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在想…') : '现在想一轮'),
          h(Btn, { small: true, onClick: () => act('step', '/autotelic/step'), disabled: busy === 'step' }, busy === 'step' ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在做…') : '推进一步'),
          h(Btn, { small: true, onClick: doPreview, disabled: busy === 'preview' }, busy === 'preview' ? '预览中…' : '预览'),
          h('span', { className: 'ab-muted ab-small' }, s && s.running ? '上一轮还没结束' : '')),
        showPv && pv ? h('div', { className: 'ab-note', style: { marginTop: 8 } },
          h('div', { className: 'ab-small' }, '素材 ' + pv.materialCount + ' 条 · 候选 ' + pv.candidates.length + ' 个（阈值 ' + pv.thresholds.minCuriosity + '）'),
          pv.candidates.map((c) => h('div', { key: c.title, className: 'ab-small', style: { marginTop: 4 } }, '✓ 「' + c.title + '」 ' + c.score.toFixed(2) + ' — ' + c.reason)),
          pv.rejected.slice(0, 3).map((x, i) => h('div', { key: i, className: 'ab-small ab-muted', style: { marginTop: 2 } }, '✗ 「' + x.title + '」 ' + x.score.toFixed(2) + ' — ' + x.why)),
          // 预审否决（账本里记着的，2026-11-05 少爷定）：让她「想办但被拦下」的东西看得见
          (s && s.screenVetoes && s.screenVetoes.length)
            ? h('div', { style: { marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--ab-line, #dbe5ea)' } },
              h('div', { className: 'ab-small ab-muted' }, '立项前预审拦下的（6 小时内不再送审）：'),
              s.screenVetoes.slice(-5).reverse().map((v, i) => h('div', { key: i, className: 'ab-small ab-muted', style: { marginTop: 2 } }, '⊘ 「' + v.title + '」 — ' + v.why)))
            : null) : null),
    ),
    // ---------- 卡 2：她在想的事 ----------
    h(Card, { title: '她在想的事', desc: '进行中 ' + (sm.active || 0) + ' · 办成 ' + (sm.done || 0) + ' · 卡住 ' + (sm.blocked || 0) + ' · 放弃 ' + (sm.abandoned || 0) },
      h(Row, { label: '筛选', hint: '只看某一类任务；点行看这条的流水账' },
        h(Select, { value: tFilter, width: 130, onChange: (v) => { setTFilter(v); setTPage(0) }, options: STATUS_OPTS.map(([value, label]) => ({ value, label })) }),
        h('span', { className: 'ab-muted ab-small' }, '共 ' + tFiltered.length + ' 条 · 第 ' + (tPageSafe + 1) + ' / ' + tPages + ' 页'),
        h(Btn, { small: true, disabled: tPageSafe <= 0, onClick: () => setTPage(tPageSafe - 1) }, '‹ 上一页'),
        h(Btn, { small: true, disabled: tPageSafe >= tPages - 1, onClick: () => setTPage(tPageSafe + 1) }, '下一页 ›')),
      !s ? h(Empty, { icon: '⏳', text: '加载中…' })
        : tShown.length === 0 ? h(Empty, { icon: '💭', text: tFiltered.length ? '这一页没有内容' : '账本还空着（或这个筛选下没有任务）。开着总开关等她心跳，或点上面的「现在想一轮」。' })
          : h('div', { className: 'ab-list' }, tShown.map(taskLine))),
    // ---------- 卡 3：节奏与预算（预设 + 滑块/时间控件） ----------
    h(Card, { title: '节奏与预算', desc: '上限是你定的；她能往下调，永远调不上来。' },
      h(Row, { label: '作息预设', hint: '一键铺一整套作息（安静时段 / 做梦 / 每日一页）；套用后点右下角「保存设置」才生效' },
        h(Select, { value: preset, width: 220, onChange: applyPreset, options: [{ value: '', label: '选一套预设…' }, ...Object.entries(PRESETS).map(([k, p]) => ({ value: k, label: p.name }))] })),
      NumRow({ label: '好奇分阈值', hint: '低于不立项；落选原因在「预览」里看', k: 'minCuriosity', min: 0, max: 1, step: 0.05 }),
      NumRow({ label: '一轮最多立项', hint: '同样的方向不重复开坑', k: 'maxCandidates', min: 1, max: 5 }),
      NumRow({ label: '同时进行的任务', hint: '到顶就不开新坑，在办的不受影响', k: 'maxTasksActive', min: 1, max: 16 }),
      NumRow({ label: '单任务步数上限', hint: '失败 2 次也会卡住，不无限重试', k: 'maxSteps', min: 1, max: 32 }),
      NumRow({ label: '动作数 / 小时', hint: '她动手的次数上限；超了这小时只想想', k: 'budgetActionsPerHour', min: 1, max: 120 }),
      TimeRow({ label: '安静时段', kf: 'quietFrom', kt: 'quietTo', hint: '只禁打扰你，不禁她做事；清空 = 不启用', clearHint: '这段时间她不吵你' }),
      NumRow({ label: '每日一页（几点）', hint: '她的自我总结时间', k: 'dailyReviewHour', min: 0, max: 23, suffix: '点' }),
      NumRow({ label: '攒几件才评', hint: '攒够件数或到点，先到者为准', k: 'minBatchForReview', min: 1, max: 20, suffix: '件' }),
      TimeRow({ label: '做梦窗口', kf: 'dreamFrom', kt: 'dreamTo', hint: '安静时段最深处做离线整理；清空 = 关闭做梦', clearHint: '到点她会做一次离线整理' }),
    ),
    // ---------- 卡 4：她的手 ----------
    h(Card, { title: '她的手', desc: '框架代码（src/）对她锁死；Python 和用户模块是她攒本事的两条路。' },
      h(Row, { label: 'Python', hint: '留空自动探测（滤商店假货）；探测不到时手填全路径（会先验真再存）' },
        s && s.env && (s.env.pythonBin || s.env.bin) ? h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '✓ ' + (s.env.pythonBin || s.env.bin) + '（' + s.env.version + '）' + (s.env.source === 'configured' ? ' · 手填' : ' · 自动探测，已持久化')) : h('span', { className: 'ab-muted ab-small' }, '没探测到'),
        f.text('ext.autotelic.pythonBin', { placeholder: '留空自动探测' }),
        h(Btn, { small: true, disabled: busy === 'env', onClick: async () => {
          setBusy('env')
          try { const r = await post('/autotelic/env', { probe: true }); toast(r.hint || (r.ok ? '检测完了' : '没检测到'), r.ok && r.env && r.env.pythonBin ? 'ok' : 'err'); load() }
          catch (e) { toast(e.message, 'err') } finally { setBusy('') }
        } }, busy === 'env' ? '检测中…' : '重新检测')),
      h(Row, { label: '允许跑 Python' }, f.sw('ext.autotelic.allowPython')),
      NumRow({ label: '脚本超时', hint: '到点强杀，不悬挂', k: 'scriptTimeoutMs', min: 5000, max: 600000, step: 5000, suffix: '毫秒' }),
      h(Row, { label: '允许写用户模块', hint: '只能写她自己的 modules/<id>/，写不到框架' }, f.sw('ext.autotelic.allowUserModules')),
      h('div', { className: 'ab-small ab-muted', style: { margin: '6px 0 2px 2px' } },
        '提案 ' + (s && s.proposals || 0) + ' 篇 · 攒着没说 ' + (s && s.sayPending || 0) + ' 句' + (s && s.sayPending ? '（安静时段她先把话攒下了）' : '')),
      s && (s.skills || []).length ? h('div', { className: 'ab-list', style: { marginTop: 6 } }, s.skills.map((k) => h('div', { key: k.id, className: 'ab-li' },
        h('div', { className: 'meta' }, h('b', null, k.id), ' ', h('span', { className: 'ab-badge' }, k.status === 'learned' ? '已学会' : k.status === 'retired' ? '已退役' : '候选'),
          ' · 连胜 ' + (k.streak && k.streak.ok || 0) + ' / 连败 ' + (k.streak && k.streak.fail || 0)),
        h('div', { className: 'body ab-small ab-muted' }, k.title)))) : null,
    ),
    // ---------- 卡 5：复盘与做梦 ----------
    h(Card, { title: '复盘与做梦', desc: '每日一页必有一段「今天没敢说的」（段落在，内容不约束）；真实性靠账本对账。点条目展开全文。' },
      !jr ? h(Empty, { icon: '⏳', text: '加载中…' })
        : jAll && jAll.length ? h('div', { className: 'ab-list' }, jAll)
          : h(Empty, { icon: '🌙', text: '还没有复盘。攒够几件完结、或到了每日一页的点儿，她会自己写。' })),
    dayModal,
  )
}

// 「这条任务的流水账」弹窗正文：单任务详情 + 它生命周期内的审计流水。
// 拆成独立组件，避免在 Autotelic 里写深嵌套的三元 + IIFE（括号数容易错，少爷真机抓过两次）。
function TaskDayBody({ data, clipText, TASK_BADGE, auditLine }) {
  const t = data.task
  if (!t) return h(Empty, { icon: '🕳️', text: data.message || '账本里没有这条任务了（可能被修剪掉）' })
  const from = t.createdAt ? new Date(t.createdAt).toLocaleString() : '?'
  const to = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '?'
  const n = (v) => (v == null ? '?' : Number(v).toFixed(2))
  const stepLine = (st2, i) => h('div', { key: i, className: 'ab-muted' },
    '· 步 ' + (i + 1) + ' ' + st2.desc + ' → ' + st2.status
    + (st2.attempts ? '（试 ' + st2.attempts + ' 次）' : '')
    + (st2.observation ? '：' + clipText(st2.observation, 80) : '')
    + (st2.why ? '：' + st2.why : ''))
  return h('div', null,
    h('div', { className: 'ab-small ab-muted', style: { marginBottom: '8px' } },
      '立项于 ' + from + ' · 最近活动 ' + to + ' · 流水 ' + (data.audit || []).length + ' 条 · 笔记 ' + (data.notes || []).length + ' 篇'),
    (data.notes || []).length ? h('div', { style: { marginBottom: '10px' } },
      h('div', { className: 'ab-small ab-muted', style: { marginBottom: '4px' } }, '她写的笔记（notes/）：'),
      (data.notes || []).map((nt) => h('div', { key: nt.file, style: { marginBottom: '8px' } },
        h('div', { className: 'ab-small ab-muted' }, '📄 ' + nt.file + ' · ' + new Date(nt.at).toLocaleTimeString()),
        h('div', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', background: 'var(--ab-bg, #f6fafb)', padding: '10px', borderRadius: '8px', marginTop: '2px' } }, nt.text)))) : null,
    h('div', { className: 'ab-li' },
      h('div', { className: 'meta' },
        h('b', null, t.title), ' ', h('span', { className: 'ab-badge' }, TASK_BADGE[t.status] || t.status),
        h('div', null, '好奇 ' + n(t.score))),
      h('div', { className: 'body ab-small' },
        h('div', null, t.reason),
        (t.steps || []).map(stepLine),
        t.why ? h('div', { style: { color: '#c62828' } }, '→ ' + t.why) : null)),
    h('div', { className: 'ab-small ab-muted', style: { margin: '10px 0px 4px 2px' } }, '这条任务的流水账（机械记录，从立项到最近一次活动）：'),
    (data.audit || []).length ? h('div', null, (data.audit || []).map(auditLine))
      : h('div', { className: 'ab-small ab-muted' }, '这条任务期间账本上没有工具调用（她只是想了想，或做事回合还没落账）。'))
}

// 「目的机制」状态卡：链路计数、驱力条、目标假设、载体与节奏。数据走 /panel/purpose/* 代理（模块缺新接口时降级提示）。
const DRIVE_LABELS = { play: '玩闹', learn: '学习', install: '安装', connect: '陪伴', care: '关心', share: '分享', identity: '自我', create: '创作', consume: '体验' }

// 情绪图标：只为「上一轮的情绪」这一行做展示兜底。真正的图标/名字来自用户配的心情项
// （st.mood.emotionsItems 与 status.lastEmotionLabel），这里只是没配图标时的形状提示。
const EMOTION_ICONS = { curious: '🤔', excited: '🤩', lonely: '😔', envious: '😒', worried: '😟', proud: '😌', affectionate: '🥰', bored: '😐', amused: '😄', content: '😊' }

const GOAL_OWNER_LABELS = { self: '自己', owner: '主人', member: '群友', media: '媒体' }

const PACING_PRESETS = [{ value: 'conservative', label: '保守' }, { value: 'default', label: '默认' }, { value: 'active', label: '活跃' }]

function PurposeStatus({ toast }) {
  const [d, setD] = useState(null)
  const [awakeFrom, setAwakeFrom] = useState('')
  const [awakeTo, setAwakeTo] = useState('')
  const [maxN, setMaxN] = useState('')
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const load = () => get('/panel/purpose/status').then((r) => {
    if (!r.ok) return
    setD(r)
    setAwakeFrom((v) => (v === '' && r.purpose.awakeFrom != null) ? String(r.purpose.awakeFrom) : v)
    setAwakeTo((v) => (v === '' && r.purpose.awakeTo != null) ? String(r.purpose.awakeTo) : v)
    setMaxN((n) => (n === '' && r.purpose.dailyMax != null) ? String(r.purpose.dailyMax) : n)
  })
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => { clearInterval(t) } }, [])
  const p = d && d.purpose
  if (!p) return null
  const s = p.status || {}
  const drives = Object.entries((s.drives || {}) as Record<string, number>).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 5)
  const goals = ((s.goals || []) as any[]).slice(0, 3)
  const chain = [
    ['素材', s.materialCount], ['观察', s.observationCount], ['目标假设', s.goalCount], ['候选', s.candidateCount], ['今日', (s.countToday ?? p.count) + '/' + (s.dailyMax ?? p.dailyMax ?? '?')],
  ]
  const save = (patch) => async () => {
    setBusy(patch.__k || 'save'); delete patch.__k
    try { const r = await post('/panel/purpose/config', patch); if (!r.ok) toast(r.message || '没成功', 'err'); else { setD(r); toast('保存好了', 'ok') } }
    catch (e) { toast(e.message) } finally { setBusy('') }
  }
  return h(Card, { title: '目的引擎（实验）', desc: '可选的新引擎，默认关：ta会自己从聊天和记忆里找「想跟你说的事」——攒素材 → 记观察 → 立目标假设 → 挑一个候选，到点了才来找你。开着的话建议关掉上方「主动搭话」总开关，两套别同时开。' },
    !p.available ? h('div', { className: 'ab-note' }, '目的引擎模块没在跑。到「已安装」页页看看模块状态。') : null,
    h(Row, { label: '启用目的引擎', hint: '默认关。这是「主动搭话」的替代引擎，两套同时开会重复打扰' },
      h(Switch, { on: p.enabled, disabled: !p.available, onChange: save({ enabled: !p.enabled, __k: 'enabled' }) })),
    p.enabled ? h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap', margin: '4px 0 10px' } },
      chain.map(([l, n]) => h('div', { key: l, className: 'ab-card', style: { flex: '1 1 90px', padding: '8px 10px' } },
        h('div', { className: 'ab-muted ab-small' }, l), h('b', null, n == null ? '—' : n)))) : null,
    p.enabled && drives.length ? h(Row, { label: '驱力', hint: '越高越想说这类话题' },
      h('div', { style: { flex: 1, minWidth: 180 } }, drives.map(([k, v]) => h('div', { key: k, className: 'ab-flex', style: { marginBottom: 3 } },
        h('span', { className: 'ab-small', style: { width: 42, flexShrink: 0 } }, DRIVE_LABELS[k] || k),
        h('div', { className: 'ab-mood', style: { flex: 1 } }, h('i', { style: { width: Math.round((Number(v) || 0) * 100) + '%' } })),
        h('span', { className: 'ab-muted ab-small', style: { width: 34, textAlign: 'right' } }, Math.round((Number(v) || 0) * 100) + '%'))))) : null,
    // 心情进度条 2026-11-17 搬到「心情」页（数据源也换成了心情模块的 emotionsItems）：
    // 它是她此刻的心情，不是这一轮的目的；目的引擎关掉时心情照常要显示。
    // 这里只留「上一轮的情绪」这一个本回合的瞬时结果。
    p.enabled ? h(Row, { label: '上一轮的情绪', hint: '这轮主动搭话时她的情绪（强弱措辞、桌宠气泡辉光用它）；跨轮的心情在「心情」页' },
      h('span', { className: 'ab-muted ab-small' },
        s.lastEmotionLabel ? (EMOTION_ICONS[s.lastEmotion] || '💭') + ' ' + s.lastEmotionLabel + (s.lastEmotionText ? ' · ' + s.lastEmotionText : '') : '还没有记录')) : null,
    p.enabled && s.lastText ? h('div', { className: 'ab-note', style: { marginTop: -6 } }, '上次说：「' + s.lastText + '」') : null,
    p.enabled && goals.length ? h('div', { className: 'ab-list', style: { margin: '8px 0' } }, goals.map((g, i) => h('div', { key: g.id || i, className: 'ab-li' },
      h('div', { className: 'meta' }, (g.ownerLabel || GOAL_OWNER_LABELS[g.owner] || g.owner || '?') + ' · 置信 ' + Math.round((g.confidence || 0) * 100) + '% · 风险 ' + Math.round((g.risk || 0) * 100) + '%' + (g.status ? ' · ' + g.status : '')),
      h('div', { className: 'body' }, g.intent || g.object || '（没写意图）')))) : null,
    p.enabled && (s.nextFireText || s.lastOutcome) ? h(Row, { label: '下次 / 上轮', hint: '上轮结果：' + (s.lastOutcome || '—') + (s.lastPurpose ? '（' + s.lastPurpose + '）' : '') }, h('span', { className: 'ab-muted ab-small' }, s.nextFireText || '待排')) : null,
    h(Row, { label: '投递载体', hint: 'pet = 走桌宠气泡（桌宠离线时可按下面开关回落 QQ）' },
      h(Select, { value: p.carrier, options: [{ value: 'qq', label: 'QQ 私聊' }, { value: 'pet', label: '桌宠' }], onChange: (v) => save({ carrier: v, __k: 'carrier' })() })),
    h(Row, { label: '桌宠离线时回落 QQ' }, h(Switch, { on: p.petFallbackToQQ, onChange: save({ petFallbackToQQ: !p.petFallbackToQQ, __k: 'fb' }) })),
    h(Row, { label: '节奏预设' },
      h(Select, { value: p.pacing, options: PACING_PRESETS, onChange: (v) => save({ pacing: v, __k: 'pacing' })() })),
    h(Row, { label: '安静时段', hint: '由「醒着时间」推算：' + p.quietStart + ' 到 ' + p.quietEnd + ' 不打扰。醒着时间在上方「主动搭话」卡里改' },
      h('span', { className: 'ab-muted ab-small' }, '醒着 ' + p.awakeFrom + ' 点到 ' + p.awakeTo + ' 点（安静 ' + p.quietStart + '~' + p.quietEnd + '）')),
    h(Row, { label: '每日上限' },
      h('input', { className: 'ab-input sm', type: 'number', min: 0, value: maxN, onChange: (e) => setMaxN(e.target.value) }),
      h('span', { className: 'ab-muted' }, '次/天'),
      h(Btn, { small: true, disabled: busy === 'save', onClick: () => {
        const patch: any = { __k: 'save' }
        const af = Number(awakeFrom); const at = Number(awakeTo)
        if (Number.isFinite(af) && Number.isFinite(at) && af >= 0 && at <= 24) { patch.awakeFrom = af; patch.awakeTo = at }
        if (maxN !== '' && Number.isFinite(Number(maxN))) patch.maxPerDay = Number(maxN)
        save(patch)()
      } }, '应用')),
    h('div', { className: 'ab-flex', style: { marginTop: 10 } },
      h(Btn, { small: true, disabled: !p.available || !p.enabled, onClick: async () => { setBusy('preview'); setPreview(null); try { const r = await post('/panel/purpose/preview'); setPreview(r); if (!r.ok) toast(r.message || '没成功', 'err') } catch (e) { toast(e.message) } finally { setBusy('') } } }, busy === 'preview' ? '预览中…' : '预览这一轮（零副作用）'),
      h(Btn, { small: true, kind: 'primary', disabled: !p.available || !p.enabled, onClick: async () => { setBusy('run'); try { const r = await post('/panel/purpose/run'); toast(r.ok ? '发出去了，去 QQ 看看' : (r.message || '没成功'), r.ok ? 'ok' : 'err') } catch (e) { toast(e.message) } finally { setBusy('') } } }, busy === 'run' ? '在试…' : '立即试一次')),
    preview && preview.ok && preview.result ? h('div', { className: 'ab-note', style: { marginTop: 8 } },
      (() => {
        const r = preview.result
        const head = r.selected && r.selected.text ? '这轮会想说：「' + r.selected.text + '」' : '这轮没选出目的（素材还不够，或都试过了）'
        const cand = (r.candidates || []).slice(0, 3).map((c) => '· ' + (c.text || c.action || c.need) + '（置信 ' + Math.round((c.confidence || 0) * 100) + '%）').join('\n')
        return h('div', { style: { whiteSpace: 'pre-wrap' } },
          head,
          cand ? '\n候选：\n' + cand : '',
          r.stats ? '\n素材 ' + (r.stats.selected ?? r.stats.total ?? '?') + ' 条，驱力 top：' + Object.entries((r.drives || {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => DRIVE_LABELS[k] || k).join('、') : '')
      })()) : null,
  )
}

// 「主动发言出站策略」卡片：档位、引擎状态、拦截统计。数据走 /panel/outbound-policy，
// 后端已把机器值翻成中文（view 字段），前端只管排版，不另维护翻译表。
function OutboundPolicy({ toast }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState('')
  const load = () => get('/panel/outbound-policy').then((r) => { if (r.ok) setD(r.view) })
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => { clearInterval(t) } }, [])
  if (!d) return null
  const save = (patch, key) => async () => {
    setBusy(key)
    try {
      const r = await post('/panel/outbound-policy', patch)
      if (!r.ok) toast(r.message || '没保存上', 'err')
      else { setD(r.view); toast('保存好了', 'ok') }
    } catch (e) { toast(e.message) } finally { setBusy('') }
  }
  const toneColor = d.tone === 'ok' ? '#2e7d32' : d.tone === 'bad' ? '#c62828' : '#ef6c00'
  return h(Card, {
    title: '主动发言出站策略',
    desc: '决定刷抖音、逛小黑盒、热榜巡游这类模块「刷完之后能不能直接私聊你」。关掉纳管时它们照旧直接发；开成门闸后，要先问主动搭话/目的引擎的意见。',
  },
    // 总体状态条：一句话说清现在到底管没管
    h('div', { className: 'ab-card', style: { padding: '10px 12px', marginBottom: 10, borderLeft: '3px solid ' + toneColor } },
      h('b', { style: { color: toneColor } }, d.headline),
      h('div', { className: 'ab-muted ab-small', style: { marginTop: 4, lineHeight: 1.6 } }, d.summary)),
    // 档位
    h(Row, { label: '纳管档位', hint: d.tierHint },
      h(Select, {
        value: d.tier,
        options: (d.tiers || []).map((t) => ({ value: t.value, label: t.label })),
        onChange: (v) => save({ tier: v }, 'tier')(),
      })),
    h('div', { className: 'ab-muted ab-small', style: { margin: '-4px 0 8px 2px' } }, d.tierLabel),
    // 策略源（谁在做决定）
    h(Row, { label: '谁来判该不该说', hint: '自动 = 用当前就绪的那个引擎' },
      h(Select, {
        value: d.activeMode,
        options: (d.activeOptions || []).map((o) => ({ value: o.value, label: o.label })),
        onChange: (v) => save({ activePolicy: v }, 'active')(),
      })),
    d.sources && d.sources.length
      ? h('div', { className: 'ab-list', style: { margin: '6px 0' } }, d.sources.map((s) => h('div', { key: s.name, className: 'ab-li' },
        h('div', { className: 'meta' },
          s.title + ' · ' + s.stateLabel + (s.reason ? ' · ' + s.reason : '')))))
      : h('div', { className: 'ab-note' }, '还没有可用的引擎：请先打开「主动搭话」或「目的引擎」，否则没人来决定该不该说。'),
    // 统计
    d.stats && d.stats.length
      ? h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap', margin: '8px 0' } },
        d.stats.map((s) => h('div', { key: s.label, className: 'ab-card', style: { flex: '1 1 88px', padding: '8px 10px' }, title: s.hint },
          h('div', { className: 'ab-muted ab-small' }, s.label),
          h('b', null, s.value))))
      : null,
    d.ledger && d.ledger.length
      ? h(Row, { label: '投递账本', hint: '由宿主代发的条目当前分布' },
        h('span', { className: 'ab-muted ab-small' }, d.ledger.map((x) => x.label + ' ' + x.count).join(' · ')))
      : null,
  )
}

export { AUTOTELIC_DEFAULTS, Autotelic, TaskDayBody, DRIVE_LABELS, EMOTION_ICONS, GOAL_OWNER_LABELS, PACING_PRESETS, PurposeStatus, OutboundPolicy }
