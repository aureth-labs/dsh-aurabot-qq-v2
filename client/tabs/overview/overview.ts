import { useState, useEffect, useRef, useCallback, Fragment } from '../../core/ui/react.ts'
import { API, get, post } from '../../core/api/api.ts'
import { chatLabel, fmtCost, fmtTokens, getPath } from '../../core/ui/format.ts'
import { LogLine } from '../../core/log.ts'
import { Btn, Card, Empty, Switch, cx, h } from '../../core/ui/ui.ts'
import { DebugChat } from '../system/system.ts'

/** 更新提示：GitHub 上有新版本时给「跟当前系统/形态对应」的命令、链接和更新按钮；刚更新完显示一次这次更新了什么。 */

function UpdateNotes({ st, toast }) {
  const [upd, setUpd] = useState(null)
  const [notes, setNotes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => {
    get('/update/check').then(setUpd).catch(() => {})
    let seen = null
    try { seen = localStorage.getItem('aurabot.seenVersion') } catch (e) {}
    if (seen && seen !== st.version) get('/changelog').then((r) => r.notes && setNotes(r.notes))
    // 第一次打开（新安装）不弹更新说明，直接记下当前版本
    else if (!seen) { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} }
  }, [st.version])
  const dismiss = () => { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} setNotes(null) }
  const copy = (text) => { try { navigator.clipboard.writeText(text); toast('复制好了', 'ok') } catch (e) { toast('复制失败，手动选中复制吧', 'err') } }
  const apply = async () => {
    if (!upd || busy) return
    if (!confirm('现在更新到 v' + upd.latest + '？更新完需要重启 DSH 才会生效，设置、人格、记忆都会保留。')) return
    setBusy(true)
    setResult(null)
    const r = await post('/update/apply')
    setBusy(false)
    setResult(r)
    toast(r.message || (r.ok ? '更新好了，重启 DSH 生效' : '更新没成功'), r.ok ? 'ok' : 'err')
  }
  const envText = upd && upd.platform ? (upd.platformLabel || upd.platform) + ' · ' + (upd.modeLabel || upd.mode) + '（profile: ' + upd.profile + '）' : ''
  return h(Fragment, null,
    notes ? h('div', { className: 'ab-note' },
      h('div', { className: 'ab-flex' }, h('b', null, '已更新到 v' + st.version), h('div', { className: 'ab-spacer' }), h(Btn, { small: true, kind: 'ghost', onClick: dismiss }, '知道了')),
      h('div', { style: { whiteSpace: 'pre-wrap', marginTop: 6 } }, notes)) : null,
    upd && upd.newer ? h('div', { className: 'ab-note warn' },
      h('div', null, h('b', null, '有新版本 v' + upd.latest), '（现在是 v' + upd.current + '）。', envText ? '当前环境：' + envText + '。' : '', '更新后重启 DSH，设置、人格、记忆都会保留。'),
      h('div', { className: 'ab-flex', style: { marginTop: 6 } },
        h('code', { style: { flex: '1 1 240px', fontSize: 11.5, wordBreak: 'break-all' } }, upd.command),
        h(Btn, { small: true, onClick: () => copy(upd.command) }, '复制'),
        h(Btn, { small: true, kind: 'primary', disabled: busy, onClick: apply }, busy ? '更新中…' : '立即更新'),
        h('a', { key: 'release', className: 'ab-btn sm', href: upd.tagUrl || upd.releaseUrl, target: '_blank', rel: 'noreferrer' }, '打开发布页')),
      result ? h('div', { className: 'ab-small', style: { marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: result.ok ? 'var(--dsw-alias-text-success, #2e7d32)' : 'var(--dsw-alias-text-danger, #c62828)' } },
        result.message, result.output ? '\n' + String(result.output).slice(-1200) : '') : null) : null)
}

// 老用户升级后：根目录里攒下的记忆和会话还没认领给哪个人格。认领前所有人格照旧共用这一份
function ClaimBanner({ st, toast }) {
  const [id, setId] = useState(() => ((st.personas || []).some((p) => p.id === 'dafeiyu') ? 'dafeiyu' : (st.personas || [])[0]?.id || ''))
  const [done, setDone] = useState(false)
  if (done || !st.persona?.claimPending) return null
  const claim = async () => {
    const name = ((st.personas || []).find((p) => p.id === id) || {}).name || id
    if (!confirm('把升级前的记忆和会话认领给「' + name + '」？之后其他人格从下一轮起用自己的记忆和会话（一开始是空的）。只能认领一次。')) return
    const r = await post('/persona/data-owner', { id })
    toast(r.message || (r.ok ? '认领好了' : '没认领成功'), r.ok ? 'ok' : 'err')
    if (r.ok) setDone(true)
  }
  return h('div', { className: 'ab-note warn' },
    '现在每个人格可以有自己的记忆和会话了。升级前攒下的记忆和会话属于哪个人格？认领之前，所有人格照旧共用这一份。',
    h('div', { className: 'ab-flex', style: { marginTop: 6, alignItems: 'center' } },
      h('select', { className: 'ab-select', 'aria-label': '认领给哪个人格', value: id, onChange: (e) => setId(e.target.value) },
        (st.personas || []).map((p) => h('option', { key: p.id, value: p.id }, p.name))),
      h(Btn, { small: true, kind: 'primary', onClick: claim }, '认领')))
}

const usageCurrencies = { CNY: '人民币', USD: '美元', EUR: '欧元', HKD: '港元', JPY: '日元', GBP: '英镑', SGD: '新加坡元', CAD: '加元', AUD: '澳元', CHF: '瑞士法郎' }

const usageCodes = Object.fromEntries(Object.entries(usageCurrencies).map(([code, label]) => [label, code]))

// Preserve custom tariff units when their ISO currency is unknown (e.g. credits or an ambiguous $).
const usageMoney = (amount, from, to, fx) => {
  const unit = String(from).trim().toUpperCase()
  const code = unit === '元' || unit === 'RMB' ? 'CNY' : usageCodes[unit] || unit
  if (!Object.hasOwn(usageCurrencies, code)) return fmtCost(amount, from) + '（原单位）'
  const origin = fx?.rates?.[code], target = fx?.rates?.[to]
  if (code === to || !(origin > 0 && target > 0)) return fmtCost(amount, code === 'CNY' ? '元' : usageCurrencies[code])
  return fmtCost(amount * (target / origin), to === 'CNY' ? '元' : usageCurrencies[to])
}

function UsageSummary({ sessions = {} }) {
  const [report, setReport] = useState(null)
  const [open, setOpen] = useState(false)
  const [precise, setPrecise] = useState(false)
  const [currency, setCurrency] = useState(() => {
    try { const c = localStorage.getItem('aurabot.usage.currency'); if (Object.hasOwn(usageCurrencies, c)) return c } catch {}
    return 'CNY'
  })
  const [range, setRange] = useState('all')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const request = useRef(null)
  const load = useCallback((selected, refreshFx = false) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setFailed(false)
    fetch(API + '/usage?range=' + selected + (refreshFx ? '&fx=refresh' : ''), { signal: controller.signal, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(r => { if (!r || r.ok === false || !r.current || !r.ranges) throw new Error(); if (!controller.signal.aborted) setReport(r) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
  }, [])
  useEffect(() => { load(range); return () => request.current?.abort() }, [range, load])
  const exact = n => Number(n || 0).toLocaleString('zh-CN')
  const tokens = n => precise ? exact(n) : fmtTokens(n)
  const tokenTitle = n => exact(n) + ' Tokens'
  const hit = r => r?.promptTokens ? (r.cacheHitRate * 100).toFixed(2) + '%' : '—'
  const price = r => {
    if (typeof r?.cost === 'number') return usageMoney(r.cost, report.currency, currency, report.fx)
    if (typeof r?.pricedCost === 'number') return usageMoney(r.pricedCost, report.currency, currency, report.fx) + '（另有 ' + exact(r.unpricedCalls) + ' 次未定价）'
    return '未定价'
  }
  const official = r => typeof r?.officialUSD === 'number' ? usageMoney(r.officialUSD, 'USD', currency, report.fx) + (r.officialMissing ? '（另有 ' + exact(r.officialMissing) + ' 次无报价）' : '') : '暂无报价'
  const money = r => r?.runs ? ' · 官方参考费用：' + official(r) + (typeof r.pricedCost === 'number' ? ' · 渠道估算：' + price(r) : '') : ''
  const total = report?.ranges.all
  const label = k => {
    const title = sessions[k]?.title
    return title ? title + ' · ' + chatLabel(k) : chatLabel(k)
  }
  const table = (rows, nameOf) => {
    if (!rows?.length) return h('p', { className: 'ab-muted' }, '这段时间没有已记录的用量。')
    const priced = rows.some(r => typeof (r.pricedCost ?? r.cost) === 'number')
    return h('div', { className: 'ab-usage-table', tabIndex: 0, 'aria-label': '用量明细，可横向滚动' },
      h('table', { className: 'ab-table num' },
        h('thead', null, h('tr', null, ['对话 / 来源', '已上报调用', '输入 Tokens', '输出 Tokens', '合计 Tokens', '缓存命中率', '官方参考费用', ...(priced ? ['渠道估算'] : [])].map(x => h('th', { key: x }, x)))),
        h('tbody', null, rows.map(r => h('tr', { key: r.key },
          h('td', null, nameOf(r.key)), h('td', null, exact(r.runs)),
          h('td', { title: tokenTitle(r.promptTokens) }, tokens(r.promptTokens)), h('td', { title: tokenTitle(r.completionTokens) }, tokens(r.completionTokens)),
          h('td', { title: tokenTitle(r.totalTokens) }, tokens(r.totalTokens)), h('td', null, hit(r)), h('td', null, official(r)),
          priced ? h('td', null, price(r)) : null)))))
  }
  const cur = report?.current
  return h('div', { className: 'ab-grid ab-usage' },
    h('button', { type: 'button', className: 'ab-card ab-usage-summary', 'aria-expanded': open, onClick: () => { setOpen(!open); if (!open) load(range, true) } },
      h('span', { className: 'ab-section-title' }, 'Tokens 用量'),
      h('strong', { className: 'ab-usage-number', title: total ? tokenTitle(total.totalTokens) : undefined }, total ? tokens(total.totalTokens) : busy ? '读取中…' : '暂时无法读取'),
      h('span', null, '近 90 天 · 缓存命中率 ' + hit(total) + money(total)),
      h('span', { className: 'ab-muted' }, open ? '收起明细 ↑' : '查看明细 →')),
    open ? h(Card, { title: '用量明细', right: h(Btn, { small: true, onClick: () => load(range, true), disabled: busy }, busy ? '读取中…' : '刷新'),
      desc: '只统计服务已上报的 Tokens。' },
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6 } },
        [['all','近 90 天'],['today','今天'],['yesterday','昨天'],['7','近 7 天'],['30','近 30 天']].map(([value,name]) =>
          h('button', { key: value, type: 'button', className: cx('ab-btn',range === value && 'primary'), 'aria-pressed': range === value, onClick: () => setRange(value) }, name))),
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 } },
        h('label', { className: 'ab-flex', style: { alignItems: 'center', gap: 6 } }, '显示币种',
          h('select', { className: 'ab-select', value: currency, onChange: e => {
            const c = e.target.value; setCurrency(c); try { localStorage.setItem('aurabot.usage.currency', c) } catch {}
          } }, Object.entries(usageCurrencies).map(([c, label]) => h('option', { key: c, value: c }, label + ' · ' + c)))),
        h('button', { type: 'button', className: 'ab-btn', 'aria-pressed': precise, onClick: () => setPrecise(!precise) }, precise ? '使用简写' : '显示精确数字')),
      failed ? h('div', { className: 'ab-note warn', role: 'alert' }, '暂时没能读取最新用量，请点刷新重试。' + (report ? '当前仍显示上次结果。' : '')) : null,
      report?.writeFailed ? h('div', { className: 'ab-note warn', role: 'alert' }, '用量暂未保存成功；重启可能丢失最近的记录。') : null,
      busy || report?.range !== range ? h('p', { className: 'ab-muted', role: 'status' }, busy ? '正在读取所选时段…' : '请刷新以读取所选时段。') : cur ? h(Fragment, null,
        h('div', { className: 'ab-note', title: tokenTitle(cur.totalTokens) }, '合计 ' + tokens(cur.totalTokens) + ' Tokens · 命中率 ' + hit(cur) + money(cur)),
        h('details', { style: { marginTop: 12 } }, h('summary', null, '群和私聊'), table(cur.byChat, label)),
        h('details', { style: { marginTop: 12 } }, h('summary', null, '记忆用量'),
          cur.byMemoryTask?.length ? table(cur.byMemoryTask, k => k) : h('p', { className: 'ab-muted' }, '这段时间没有单列的记忆用量。旧版未区分的记录仍在原分类里。')),
        h('details', { style: { marginTop: 12 } }, h('summary', null, '按来源查看'),
          cur.background?.runs ? h('p', { className: 'ab-muted' }, '后台任务：' + tokens(cur.background.totalTokens) + ' Tokens（已计入合计）') : null,
          table(cur.byModule, k => k)),
        h('details', { style: { marginTop: 12 } }, h('summary', null, '按模型查看'), table(cur.byModel, k => k))) : null,
      h('details', { className: 'ab-muted ab-small', style: { marginTop: 12 } }, h('summary', null, '统计口径与价目'),
        h('p', null, '官方参考费用按原厂标准 API 价（美元）折算，中转按同价。价目核对：' + (report?.referenceDate || '—') + '。外部搜索、生图等单独计费。'),
        report?.fx?.date ? h('p', null, '换算汇率：欧洲央行 · ' + report.fx.date) : null,
        h('p', null, '按北京时间分日。输入含缓存读写，命中率按输入 Tokens 计算。',
          report?.startedAt ? ' 后台用量自 ' + new Date(report.startedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' 起记录。' : ''))) : null)
}

function Overview({ st, toast, go }) {
  const cfg = st.config
  const s = st.stats || {}
  const conn = st.onebot.state === 'connected'
  const quick = (p, body = {}) => async () => { const r = await post(p, body); toast(r.message || (r.ok ? '好了' : '没成功')) }
  return h('div', { className: 'ab-grid' },
    h(UpdateNotes, { st, toast }),
    h(ClaimBanner, { st, toast }),
    !cfg.enabled ? h('div', { className: 'ab-note warn' }, '总开关是关着的：大肥鱼现在不会收也不会发任何 QQ 消息。准备好了就在右上角打开。') : null,
    cfg.enabled && cfg.debug ? h('div', { className: 'ab-note warn' },
      '现在是调试：她会照常思考回复，但既不发到 QQ，也不写任何记忆和聊天流水 —— 只出现在日志里。调试期间的对话不会被明天的记忆整理吸收，也不会影响正式上线后的她。',
      h('div', { className: 'ab-flex', style: { marginTop: 6, alignItems: 'center' } },
        h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/debug/session'); toast(r.message || (r.ok ? '好了' : '没建好'), r.ok ? 'ok' : 'err') } }, '新建 / 打开调试会话'),
        h('span', { className: 'ab-muted ab-small' }, '去左侧栏「Aurabot · QQ」工作区打开它，直接在输入框里跟她说话'))) : null,
    cfg.enabled && cfg.debug ? h(Card, { title: '调试对话', desc: '在这里直接跟她说话：走她的人格和工具，但不经过 QQ、不写记忆。和左侧栏那个调试会话是同一个会话。' }, h(DebugChat, { toast })) : null,
    cfg.enabled && !cfg.debug && cfg.dryRun ? h('div', { className: 'ab-note' }, '现在是试运行：她会照常思考回复，但只写进日志，不会真的发到 QQ。注意试运行**会照常写记忆**；只想试人格、不想留痕迹请切到「调试」。') : null,
    st.outbox && st.outbox.count ? h('div', { className: 'ab-note warn' }, `网关还没就绪：已有 ${st.outbox.count} 条消息排队，连接后会自动补发。`) : null,
    cfg.enabled && !conn ? h('div', { className: 'ab-note err' }, '还没连上 OneBot' + (st.onebot.problem ? '：' + st.onebot.problem + '。' : '。去「连接」标签检查地址和令牌。') + ' ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); go('connect') } }, '去连接 →')) : null,
    st.outbox && st.outbox.count ? h('div', { className: 'ab-note warn' }, `网关还没就绪：已有 ${st.outbox.count} 条消息排队，连接后会自动补发。`) : null,
    h('div', { className: 'ab-grid ab-g4' },
      [['今天收到', s.received, '📥'], ['今天发出', s.sent, '📤'], ['语音条', s.voice, '🎙️'], ['表情包', s.stickers, '😺']].map(([l, n, ic]) => h('div', { key: l, className: 'ab-card ab-stat' }, h('span', { className: 'ic', 'aria-hidden': true }, ic), h('div', { className: 'n' }, n || 0), h('div', { className: 'l' }, l))),
    ),
    h(UsageSummary, { sessions: st.sessions }),
    h('div', { className: 'ab-grid ab-g2' },
      h(Card, { title: 'ta现在', desc: '心情会随聊天起伏，过一阵子慢慢回到平常。' },
        h('div', { className: 'ab-flex', style: { marginBottom: 8 } }, h('b', null, st.mood.label), h('span', { className: 'ab-muted' }, st.mood.value + ' / 100')),
        h('div', { className: 'ab-mood' }, h('i', { style: { width: Math.max(4, st.mood.value) + '%' } })),
        h('div', { className: 'ab-kv', style: { marginTop: 14 } },
          h('span', null, '表情库'), h('span', null, st.stickers.count + ' 张'),
          h('span', null, '下一篇日记'), h('span', null, cfg.diary.enabled ? (st.diary.next || '今天写完了') : '没开'),
          h('span', null, '人格'), h('span', null, (st.personas.find((p) => p.id === cfg.persona.current) || {}).name || cfg.persona.current),
          h('span', null, 'QQ 会话'), h('span', null, Object.keys(st.sessions || {}).filter((k) => !k.startsWith('system:')).length + ' 个（在侧栏「Aurabot · QQ」工作区里）'),
        ),
      ),
      h(Card, { title: '快捷操作', desc: '试一试ta是不是活着。这些操作会真的发到 QQ（试运行时只写日志）。' },
        h('div', { className: 'ab-flex' },
          h(Btn, { kind: 'primary', onClick: quick('/test-send') }, '给主人发一条自测'),
          h(Btn, { onClick: quick('/purpose/fire') }, '让ta现在来找你'),
          h(Btn, { onClick: quick('/diary/run', { visibility: 'self' }) }, '写一篇日记（仅自己可见）'),
        ),
        h('p', { className: 'ab-muted ab-small', style: { marginTop: 12, marginBottom: 0 } }, '想看ta和每个人聊了什么、调了什么工具：点 DSH 侧栏「Aurabot · QQ」工作区里对应的会话，也可以直接在会话里插话。'),
        h('div', { className: 'ab-flex', style: { marginTop: 10 } },
          h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('把现在所有 QQ 会话归档、让ta从头开始聊？（旧会话在侧栏的归档里还能找到）')) return; const r = await post('/sessions/reset'); toast(r.message) } }, '重新开始所有 QQ 会话')),
      ),
    ),
    h(RecentLogs, { go }),
  )
}

/**
 * 「管理功能」页：把散在各页的可选功能收在一处，按四类状态展示。
 * 判定来源 = 阶段一 bootstrap 摘要（boot.modules：enabled/running/availability/error）+ 对应配置键。
 * 四类：ready（正常可用）→ 去设置；blocked（启用但平台受限/启动失败）→ 原因 + 排障入口；
 *       off（用户停用）→ 启用入口；absent（未安装）→ 安装入口。
 */

const MANAGE_FEATURES = [
  { key: 'voice', label: '语音', desc: '让她用语音条说话：<voice> 标出来的部分会变成语音。', tab: 'voice', flag: 'voice.enabled', cli: 'voice' },
  { key: 'stickers', label: '表情包', desc: '会挑合适的表情一起发，也能认出你发的表情。', tab: 'stickers', flag: 'stickers.enabled', cli: 'stickers' },
  { key: 'imagegen', label: '生图', desc: '按描述画图发给你。', tab: 'imagegen', flag: 'imageGen.enabled', cli: 'imagegen' },
  { key: 'song', label: '翻唱', desc: '用 RVC 翻唱一段发给你。', tab: 'song', flag: 'song.enabled', cli: 'song' },
  { key: 'pet', label: '桌宠', desc: '桌面上的悬浮窗形象，和 QQ 里是同一个她。', tab: 'pet', cli: 'pet' },
  { key: 'diary', label: '空间日记', desc: '自己写日记、发到空间说说。', tab: 'diary', flag: 'diary.enabled', cli: 'diary' },
  { key: 'platform', label: '内容平台', desc: '逛 B站 / 抖音 / 小黑盒，看内容也能互动。', tab: 'bili', cli: ['bili', 'douyin', 'heybox'] },
  { key: 'purpose', label: '目的引擎', desc: '像人一样主动找你说话：攒素材 → 立目标 → 到点来找你。', tab: 'speakup', flag: 'ext.purpose.enabled', cli: 'purpose' },
  { key: 'autotelic', label: '自驱引擎（实验）', desc: '观察→回味→决策→行动→沉淀，v5 重写，实验性功能。', tab: 'autotelic', flag: 'ext.autotelic.enabled', cli: 'autotelic' },
]

function Manage({ st, boot, toast, go, reload, draft }) {
  const mods = (boot && boot.modules) || st.modules || []
  // 启用/停用沿用现有保存流程：成功才用回执里的模块表刷新导航，失败就地提示
  const setEnabled = async (id, on) => {
    const r = await post('/save', { modules: { [id]: { ...((draft.modules || {})[id] || {}), enabled: on } } })
    if (r.ok === false) return toast(r.message || '没改成', 'err')
    toast(on ? '已启用' : '已停用', 'ok')
    reload()
  }
  const find = (id) => mods.find((m) => m && m.id === id)
  const rows = MANAGE_FEATURES.map((f) => {
    const ids = Array.isArray(f.cli) ? f.cli : [f.cli]
    const ms = ids.map(find).filter(Boolean)
    const cfgOn = f.flag ? getPath(st.config, f.flag) !== false && Boolean(getPath(st.config, f.flag)) : true
    const anyRunning = ms.some((m) => m.running)
    const anyError = ms.find((m) => m.availability === 'error')
    const userOff = ms.length ? ms.every((m) => m.enabled === false) : false
    const absent = !ms.length || ms.every((m) => m.availability === 'unloaded')
    // 平台受限：模块声明了 platforms，但当前连接里没有它支持的平台
    const plats = ms.flatMap((m) => m.platforms || [])
    const conns = ((boot && boot.connections) || []).map((c) => String(c.platform || '').toLowerCase())
    const limited = plats.length > 0 && conns.length > 0 && !plats.some((p) => conns.includes(String(p).toLowerCase()))
    let kind = 'ok'
    let reason = ''
    if (absent) { kind = 'absent' }
    else if (anyError) { kind = 'blocked'; reason = anyError.error || '启动时出错了' }
    else if (ms.some((m) => m.enabled !== false) && !anyRunning) { kind = 'blocked'; reason = '已启用，但没在运行' }
    else if (limited && anyRunning) { kind = 'blocked'; reason = '已启用，但当前连接的平台不支持（需要 ' + plats.join(' / ') + '）' }
    else if (userOff || !cfgOn) { kind = 'off' }
    const badge = { ok: ['ok', '可用'], blocked: ['warn', '受限'], off: ['', '已停用'], absent: ['', '未安装'] }[kind]
    return { f, kind, reason, badge, ms, userOff }
  })
  // 卡片网格：每项一张卡（头部=名称+状态徽标 / 正文=说明与原因 / 底部=操作区）。
  // 行为与行式布局时完全一致：kind 判定、按钮文案、/save 流程都没动，只换 DOM 结构与样式。
  const section = (title, desc, list) => (list.length ? h(Card, { title, desc }, h('div', { className: 'ab-manage-grid' }, list.map(({ f, kind, reason, badge, ms }) => h('div', {
    key: f.key,
    className: cx('ab-manage-card', kind === 'blocked' && 'is-blocked', kind === 'off' && 'is-off', kind === 'absent' && 'is-absent'),
  },
  // 头部两端对齐：左=名称+徽标，右=启用开关（开关逻辑与之前完全一致，只是位置从操作区挪上来）
  h('div', { className: 'ab-manage-head' },
    h('span', { className: 'ab-manage-name' }, f.label, h('span', { className: cx('ab-badge', badge[0]) }, badge[1])),
    ms.length ? h('span', { style: { flexShrink: 0 } }, h(Switch, {
      on: ms.some((m) => m.enabled !== false),
      onChange: (v) => setEnabled(ms[0].id, v),
      title: '启用 / 停用这个功能',
    })) : null),
  h('div', { className: 'ab-manage-desc' }, f.desc),
  reason ? h('div', { className: 'ab-note warn ab-manage-reason' }, reason) : null,
  h('div', { className: 'ab-manage-acts' },
    h(Btn, { small: true, kind: kind === 'ok' ? 'primary' : undefined, onClick: () => go(f.tab) }, kind === 'ok' ? '去设置' : '打开设置'),
    kind === 'blocked' ? h(Btn, { small: true, onClick: () => go('logs') }, '看日志排障') : null,
    kind === 'absent' ? h(Btn, { small: true, onClick: () => go('market') }, '去安装') : null))))) : null)
  return h('div', { className: 'ab-grid' },
    h('div', { className: 'ab-note' }, '这里汇总所有可选功能，按状态分组。想更细地调参数，点「去设置」进各自页面。'),
    section('正常可用', '已启用并在运行的功能。', rows.filter((r) => r.kind === 'ok')),
    section('需要处理', '已启用但没跑起来：可能是启动失败，或当前连接的平台不支持。', rows.filter((r) => r.kind === 'blocked')),
    section('已停用', '你手动关掉的功能，点开关就能重新启用。', rows.filter((r) => r.kind === 'off')),
    section('未安装', '还没装上的功能，去模块市场装，或在内置页里打开。', rows.filter((r) => r.kind === 'absent')),
  )
}

/** 「关于」页：三张通栏大卡（这是谁 / 加入我们 / 核心开发者），贡献者与许可默认折叠。
 *  只读展示，没有设置项。「核心开发者」写死三个人；「贡献者」里的头像墙走 contrib.rocks 自动更新，
 *  文字名单取自 GitHub contributors 与版本说明（含没有 commit 的反馈者）。
 *  仓库已从个人账号迁到 aureth-labs 组织：主仓 + 模块仓（模块市场/桌宠素材都在模块仓）。 */

function About({ st }) {
  const repo = 'https://github.com/aureth-labs/dsh-aurabot-qq'
  const mods = 'https://github.com/aureth-labs/dsh-aurabot-qq-mods'
  const gh = (name) => h('a', { key: 'gh-' + name, href: 'https://github.com/' + name, target: '_blank', rel: 'noreferrer' }, '@' + name)
  // 兜底名单：接口读不到时用这份；平时优先用 /about/contributors 动态拉取（GitHub contributors）
  const fallbackCoders = ['accomplish07zrh-eng', 'baihengaead', 'RookieApe-tao', 'GitNekopedia', 'Chsw-CC', 'chsw', 'Emotionana', 'Nightc-c', 'Fallen-plum-blossom']
  const reporters = ['cxin21', 'zhuyi314', '38213063', 'HuaGyuu', 'CYyare', 'yunxirumo', 'XiongYachao']
  const [remote, setRemote] = useState(null)
  useEffect(() => {
    let alive = true
    get('/about/contributors').then((r) => { if (alive && r && r.ok && Array.isArray(r.list) && r.list.length) setRemote(r) })
    return () => { alive = false }
  }, [])
  const coders = remote ? remote.list.map((x) => x.login) : fallbackCoders
  // 头像墙每天换一个查询参数，避免浏览器/CDN 按 3 天缓存卡住不更新
  const wallSrc = 'https://contrib.rocks/image?repo=aureth-labs/dsh-aurabot-qq&v=' + new Date().toISOString().slice(0, 10)
  const kv = (rows) => h('div', { className: 'ab-kv' }, rows.flatMap(([k, v]) => [h('span', { key: k }, k), h('span', { key: k + '-v' }, v)]))
  const copyGroup = (e) => { try { navigator.clipboard.writeText('1130575035'); e.target.textContent = '已复制'; setTimeout(() => { e.target.textContent = '复制' }, 1500) } catch (error) {} }
  // 核心开发者：仓库创建者 + 两位主要贡献者（只展示头像与名字，不标具体模块）
  const devs = ['accomplish07zrh-eng', 'baihengaead', 'RookieApe-tao']
  const dev = (n) => h('div', { key: 'dev-' + n, className: 'ab-dev' },
    h('div', { className: 'av' }, n.slice(0, 1).toUpperCase(),
      h('img', { src: 'https://github.com/' + n + '.png?size=96', alt: n, loading: 'lazy', referrerPolicy: 'no-referrer', onError: (e) => { e.currentTarget.style.display = 'none' } })),
    h('div', { className: 'who' },
      h('a', { className: 'nm', href: 'https://github.com/' + n, target: '_blank', rel: 'noreferrer', title: n }, '@' + n)))
  const fold = (title, open, children) => h('details', { key: title, className: 'ab-about-sum' },
    h('summary', null, title, h('i', { className: 'chev', 'aria-hidden': true }, '▶')),
    h('div', { className: 'inner' }, children))
  return h('div', { className: 'ab-grid' },
    h(Card, { className: 'ab-about-lead', title: 'Aurabot · 住在 QQ 里的 AI 伙伴「大肥鱼」🐟', desc: 'v' + st.version + ' · 面板 API v' + (st.apiVersion || '?') },
      h('p', null, '一个 DeepSeek Harness 插件，由 aureth-labs 组织维护，经 OneBot v11 适配器接入 QQ。聊天、语音、表情包、日记这些是插件自带的本事；桌宠、抖音、小黑盒、群管这些本事在「模块市场」一键安装，模块本体都在模块仓库里，也可以自己写。'),
      h('div', { className: 'ab-flex', style: { marginTop: 14 } },
        h('a', { key: 'repo', className: 'ab-btn sm', href: repo, target: '_blank', rel: 'noreferrer' }, 'GitHub 主仓库'),
        h('a', { key: 'mods', className: 'ab-btn sm', href: mods, target: '_blank', rel: 'noreferrer' }, '模块仓库'),
        h('a', { key: 'doc', className: 'ab-btn sm', href: repo + '/blob/main/docs/USER-MANUAL.md', target: '_blank', rel: 'noreferrer' }, '用户手册'),
      ),
      h('p', { className: 'ab-muted ab-small', style: { marginTop: 10, marginBottom: 0 } }, '项目分两个仓库：主仓 dsh-aurabot-qq 放插件本体；模块仓 dsh-aurabot-qq-mods 放模块市场的社区模块和桌宠素材包。'),
    ),
    h(Card, { className: 'ab-about-lead', title: '加入我们', desc: '交流、报 bug、提代码都在这儿。' },
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 12 } },
        h('span', { key: 'qq', className: 'ab-about-chip' }, 'QQ 交流群 ', h('b', null, '1130575035'),
          h('button', { key: 'cp', type: 'button', className: 'ab-btn sm', onClick: copyGroup }, '复制')),
        h('a', { key: 'issue', className: 'ab-btn sm', href: repo + '/issues', target: '_blank', rel: 'noreferrer' }, '报 bug / 提需求'),
        h('a', { key: 'pr', className: 'ab-btn sm', href: repo + '/pulls', target: '_blank', rel: 'noreferrer' }, '提代码（PR）'),
        h('a', { key: 'modpr', className: 'ab-btn sm', href: mods + '/pulls', target: '_blank', rel: 'noreferrer' }, '提交模块（模块仓库 PR）'),
      ),
      h('p', { className: 'ab-muted ab-small', style: { marginTop: 12 } }, '提 issue / PR 前先翻一下有没有重复；群里问问题时尽量带上「日志」页的报错和版本号。'),
    ),
    h(Card, { className: 'ab-about-lead', title: '核心开发者', desc: '从第一行代码到现在，主要靠这三位在写。' },
      h('div', { className: 'ab-devs' }, devs.map(dev)),
      h('p', { className: 'ab-muted ab-small', style: { marginTop: 12, marginBottom: 0 } }, '仓库现由 aureth-labs 组织维护，由 @accomplish07zrh-eng 创建；点名字进 GitHub 主页，其余帮忙的见下面「贡献者」。'),
    ),
    fold('贡献者（' + (coders.length + reporters.length) + ' 人）', false,
      h('div', null,
        // 头像墙由 contrib.rocks 按仓库提交记录自动生成，有新人提交就会自己更新，不用改代码
        h('a', { key: 'wall', className: 'ab-contrib', href: repo + '/graphs/contributors', target: '_blank', rel: 'noreferrer', title: '在 GitHub 上查看贡献者列表' },
          h('img', { src: wallSrc, alt: '贡献者头像墙', loading: 'lazy', referrerPolicy: 'no-referrer', onError: (e) => { e.currentTarget.style.display = 'none' } })),
        h('p', { className: 'ab-muted ab-small', style: { marginTop: 0, marginBottom: 12 } }, '上面这排头像由 contrib.rocks 按提交记录自动更新（地址每天换一次，避免被浏览器缓存卡住）；下面「写代码的」名单从 GitHub contributors 实时拉取，读不到时用内置名单兜底。'),
        h('div', { style: { marginBottom: 8 } }, h('b', { style: { fontSize: 13 } }, '写代码的')),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 8 } },
          coders.map((n) => h('span', { key: n, className: 'ab-pill' }, gh(n)))),
        h('div', { style: { margin: '12px 0 8px' } }, h('b', { style: { fontSize: 13 } }, '报问题、提建议的')),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 8 } },
          reporters.map((n) => h('span', { key: n, className: 'ab-pill' }, gh(n)))),
        h('p', { className: 'ab-muted ab-small', style: { marginTop: 12, marginBottom: 0 } }, '名单来自 GitHub contributors 与版本说明（CHANGELOG.md）；「导航布局」「群头衔回复过滤」两个社区扩展的思路也做进了面板和聊天中枢，一并谢过。'),
      )),
    fold('许可与鸣谢', false,
      h('div', null,
        kv([
          ['插件代码', h('span', { key: 'mit' }, 'MIT License（见仓库 LICENSE）')],
          ['「大肥鱼」形象', h('span', { key: 'cc' }, 'CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享）')],
          ['参考插件', h('span', { key: 'yuu' }, gh('Yuuyuko-uu'), ' 的 dsh-qq-bridge / speak-up / mood / memory（MIT，只借鉴踩坑经验）')],
          ['其他署名', h('span', { key: 'tp' }, 'qq-bridge / QSH、surfcore purpose-engine 等，见 THIRD-PARTY-NOTICES.md')],
        ]),
        h('p', { className: 'ab-muted ab-small', style: { marginTop: 12, marginBottom: 0 } }, '素材包体积大（50MB+），不进本仓库：放独立模块仓 ', h('a', { href: mods, target: '_blank', rel: 'noreferrer' }, 'aureth-labs/dsh-aurabot-qq-mods'), ' 的 pet-pack/，插件缺包时会按设置里的地址自动下载落位。'),
      )),
  )
}

function RecentLogs({ go }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => get('/logs?limit=8&level=info').then((r) => alive && setItems(r.entries || []))
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return h(Card, { title: '最近动态', right: h(Btn, { kind: 'ghost', small: true, onClick: () => go('logs') }, '全部日志 →') },
    items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h(Empty, { text: '还没有动静' }) :
      h('div', { className: 'ab-logs', style: { maxHeight: 240 } }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
}

export { UpdateNotes, ClaimBanner, usageCurrencies, usageCodes, usageMoney, UsageSummary, Overview, MANAGE_FEATURES, Manage, About, RecentLogs }
