import { useState, useEffect } from './../core/react.ts'
import { API, get, post } from './../core/api.ts'
import { timeAgo } from './../core/format.ts'
import { Btn, Card, Empty, Row, Select, Switch, cx, h } from './../core/ui.ts'

// 「桌宠」面板卡：状态、装客户端、专注模式、心跳、表情预览。数据走 /panel/pet/* 代理，模块没装好时给引导。
const PET_MOODS = [{ key: 'idle', label: '😐 平常' }, { key: 'happy', label: '😄 开心' }, { key: 'shy', label: '😳 害羞' }, { key: 'sad', label: '😢 委屈' }, { key: 'angry', label: '😠 生气' }, { key: 'sleepy', label: '😴 困了' }, { key: 'think', label: '🤔 想事' }, { key: 'love', label: '🥰 喜欢你' }]

// 行为动作全表（面板「试一下」）：与社区模块 pet 的 index.mjs 里的 BEHAVIOR_ACTIONS / BEHAVIOR_DEFERRED 一一对应。
// tier：1 = 第一批已开放；2 = 第二批图标动作（服务端隔离区，可一键归还）；3 = 第三批暂未实现（点了客户端回执 refused:not-implemented）。
const PET_BEHAVIOR_ACTIONS = [
  { action: 'chase_cursor', name: '追鼠标', effect: '扑过去追着你的鼠标跑，追到后按住指针 5 秒再松开', tier: 1 },
  { action: 'wander', name: '溜达', effect: '自己溜达到屏幕另一头', tier: 1 },
  { action: 'idle_anim', name: '小动作', effect: '随便播一段小动作（摇尾巴、眨眼这类），不移动', tier: 1 },
  { action: 'steal_cursor', name: '叼鼠标', effect: '冲到鼠标位置叼住，带着鼠标同步跑到一个随机位置（也可由 AI 指定坐标）再松口', tier: 1 },
  { action: 'say', name: '说一句', effect: '只冒个气泡说句话，不做动作', tier: 1 },
  { action: 'drag_icon', name: '叼图标', effect: '叼起桌面图标搬到另一个位置放下（默认随机落点，不填图标名就随机挑一个）', tier: 2 },
  { action: 'hide_icon', name: '收图标', effect: '把桌面图标收进隔离区，随时可以放回去', tier: 2 },
  { action: 'nudge_window', name: '推窗口', effect: '把窗口一路推到屏幕边界外（只剩一条边），人和窗口一起走，5 秒后再一起拉回原位', tier: 3 },
  { action: 'close_window', name: '关窗口', effect: '跑到窗口右上角，优雅关掉（等于点右上角 X，另有独立安全开关）', tier: 3 },
]

// 回执展示口径：played / refused / failed 是客户端 /playback 回的三种终态，pending 是刚下发还没回。
const PET_RECEIPT_VIEW = {
  played: { icon: '✅', word: '演完了', color: 'var(--ab-ok)' },
  refused: { icon: '🚫', word: '被拦下', color: 'var(--ab-warn)' },
  failed: { icon: '❌', word: '没演成', color: 'var(--ab-err)' },
  pending: { icon: '⏳', word: '等回执', color: 'var(--ab-sub)' },
  other: { icon: '·', word: '', color: 'var(--ab-sub)' },
}
/** 解析 behavior.json 的 recent 一行：`chase_cursor → played`、`hide_icon → refused（not-implemented）`、`say → 下发（等回执）`。 */

function parseBehaviorReceipt(line) {
  const m = /^([a-z_]+)\s*→\s*(.+)$/.exec(String(line || '').trim())
  if (!m) return null
  const rest = m[2].trim()
  const status = /^played\b/.test(rest) ? 'played' : /^refused\b/.test(rest) ? 'refused' : /^failed\b/.test(rest) ? 'failed' : /下发/.test(rest) ? 'pending' : 'other'
  const i = rest.indexOf('（')
  const why = i >= 0 ? rest.slice(i + 1).replace(/）\s*$/, '') : ''
  return { action: m[1], status, why, text: rest }
}

function PetPanel({ toast }) {
  const [pet, setPet] = useState(null)
  const [purpose, setPurpose] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  // 碎碎念 / 干活状态的本地编辑态（数字与文案池要「应用」才提交；开关、下拉即点即存）
  const [ws, setWs] = useState(null)
  // 行为动作卡：状态（/behavior/status）+ 隔离区清单（/behavior/icon/quarantine）+ 点完立刻给反馈的本地回执
  const [bh, setBh] = useState(null)
  // 行为与安全的本地编辑态：数字/白名单要「应用」才提交（开关即点即存）。null = 还没动过，直接用服务端值。
  const [bcfg, setBcfg] = useState(null)
  // 人物大小倍率的本地编辑态（0.5~2，点「保存」才下发）
  const [scVal, setScVal] = useState(null)
  // 物理三参数（重力/弹力/动作频率）的本地编辑态：null = 还没动过，直接用服务端下发值；
  // 改过就用本地值（改了一半别被 8 秒轮询冲掉），点各自的「保存」才下发
  const [ph, setPh] = useState(null)
  const [bhErr, setBhErr] = useState('')
  const [quar, setQuar] = useState(null)
  const [quarErr, setQuarErr] = useState('')
  const [pend, setPend] = useState({})
  // 素材包下载地址的本地编辑态：null = 跟着服务端当前值显示，改过就用本地值
  const [pkUrl, setPkUrl] = useState(null)
  // Electron 下载镜像的本地编辑态（同上；留空 = 用内置默认 npmmirror）
  const [emUrl, setEmUrl] = useState(null)
  // 对话框（pet 1.0.5）配置草稿：快捷键/关键字/数字/城市要「保存」才下发，开关即点即存
  const [cc, setCc] = useState(null)
  // 语音对讲（pet 1.2.0）配置草稿：热键/地址/音色/数字要「保存」才下发，开关与下拉即点即存。
  // 独立草稿，不跟对话框的 cc 抢状态；null = 跟着服务端下发的 pet.voiceTalk 走。
  const [cac, setCac] = useState(null)
  const load = async () => {
    const [pr, pu] = await Promise.all([get('/panel/pet/status'), get('/panel/purpose/status')])
    if (pr.ok) { setPet(pr.pet); setWs((old) => old || (pr.pet && pr.pet.whisper ? { ...pr.pet.whisper } : null)) }
    if (pu.ok) setPurpose(pu.purpose)
    setLoaded(true)
  }
  // 第二批接口（隔离区）没好时只记一条兜底文案，卡片照常渲染不炸
  const loadBehavior = async () => {
    const [br, qr] = await Promise.all([get('/panel/pet/behavior/status'), get('/panel/pet/behavior/quarantine')])
    if (br.ok && br.behavior) { setBh(br.behavior); setBhErr('') } else setBhErr(br.message || '接口没有响应')
    if (qr.ok) { setQuar(Array.isArray(qr.items) ? qr.items : []); setQuarErr('') } else setQuarErr(qr.message || '接口没有响应')
  }
  useEffect(() => { load(); loadBehavior(); const t = setInterval(() => { load(); loadBehavior() }, 8000); return () => { clearInterval(t) } }, [])
  const online = Boolean(pet && (pet.online ?? pet.presence?.online))
  const installed = Boolean(pet && (pet.installed ?? true))
  const state = !pet ? '未安装' : online ? '在线' : '离线'
  const dotCls = !pet ? '' : online ? 'ok' : 'err'
  const carrier = purpose?.carrier || 'qq'
  // status() 的 focus 是布尔值，不是 {enabled} 对象（#152，RookieApe-tao）
  const focus = Boolean(pet && pet.focus === true)
  const heart = pet && (pet.lastSeenAt || pet.heartbeatAt || pet.presence?.lastSeenAt)
  const moods = Array.isArray(pet?.moods) && pet.moods.length ? pet.moods : PET_MOODS
  const moodLabel = (m) => typeof m === 'string' ? (PET_MOODS.find((x) => x.key === m) || { label: m }).label : (m.label || m.key)
  // Electron 三键：安装状态看 status.electronInstalled（electron.exe 在不在）；运行状态复用心跳（在线 = 在跑）
  const electronInstalled = Boolean(pet && (pet.electronInstalled ?? false))
  const portReady = pet ? pet.portReady !== false : false
  // 客户端生成物对账（服务端 status.client）：缺 behavior.js 这类「旧壳」会让行为层静默失效
  const clientInfo = (pet && pet.client) || null
  const clientBad = Boolean(clientInfo && clientInfo.installed && !clientInfo.healthy)
  const act = async (key, path, okMsg) => {
    setBusy(key)
    try {
      const r = await post(path, {})
      const res = r.result && typeof r.result === 'object' ? r.result : r
      if (r.ok === false || res.ok === false) toast(res.message || r.message || '没成功', 'err')
      else toast(res.message || okMsg, 'ok')
    } catch (e) { toast(e.message) } finally { setBusy(''); load() }
  }
  // 桌宠页下方的设置：统一走 /panel/pet/config（写 ext.pet.*）
  const savePet = async (patch, okMsg?) => {
    setBusy('cfg')
    try {
      const r = await post('/panel/pet/config', patch)
      if (!r.ok) toast(r.message || '没成功', 'err')
      else { toast(okMsg || '保存好了', 'ok'); if (r.pet && r.pet.whisper) setWs({ ...r.pet.whisper }) }
    } catch (e) { toast(e.message) } finally { setBusy(''); load() }
  }
  const work = (pet && pet.work) || null
  // ---------- 对话框（pet 1.0.5，模块库里的 petChat）：文本/数字走草稿 + 保存，开关即点即存 ----------
  const chatCfg = (pet && pet.chat) || null
  const cg = (k, fallback) => (cc && cc[k] != null ? cc[k] : (chatCfg ? chatCfg[k] : fallback))
  const setCg = (k, v) => setCc((old) => ({ ...(old || {}), [k]: v }))
  const saveChat = async (patch, msg) => { await savePet(patch, msg); setCc(null) }
  const hotkeyStateText = !chatCfg ? '' : chatCfg.hotkeyState === 'registered' ? '当前已注册：' + (chatCfg.hotkey || '—')
    : chatCfg.hotkeyState === 'failed' ? '注册失败：这个组合键被别的程序占用了，换一个试试'
      : '当前未注册（没填或对话框关着）'
  // 可编辑字段用本地编辑态（改了一半别被轮询冲掉），实时字段（thinking/today/nextAt/上次说了什么）用服务端的
  const liveW = (pet && pet.whisper) || null
  const whisper = (liveW || ws) ? {
    ...(liveW || {}),
    ...(ws ? { enabled: ws.enabled, source: ws.source, minMinutes: ws.minMinutes, maxMinutes: ws.maxMinutes, maxPerDay: ws.maxPerDay, pauseOnPetCarrier: ws.pauseOnPetCarrier, lines: ws.lines } : {}),
  } : null
  const nextIn = whisper && whisper.nextAt ? Math.max(0, Math.round((whisper.nextAt - Date.now()) / 60000)) : null
  const nextText = nextIn == null ? '' : nextIn <= 0 ? '马上' : nextIn < 60 ? nextIn + ' 分钟后' : nextIn < 1440 ? Math.round(nextIn / 60) + ' 小时后' : (Math.round(nextIn / 144) / 10) + ' 天后'
  const workEnabled = pet ? pet.workEnabled !== false : true
  // ---------- 行为动作：状态行文案、回执映射、三个动作（试一下 / AI 开关 / 放回去） ----------
  const bRecent = bh && Array.isArray(bh.recent) ? bh.recent : []
  const bDisabled = new Set((bh && Array.isArray(bh.disabledActions) ? bh.disabledActions : []))
  // recent 只留最近 8 条且带时间以外的全部信息：取该动作最后一次出现的那行
  const bLatest = (action) => {
    let line = ''
    for (const x of bRecent) { const r = parseBehaviorReceipt(x); if (r && r.action === action) line = x }
    return line
  }
  const receiptOf = (action) => {
    const line = bLatest(action)
    const p = pend[action]
    // 点完的 20 秒内、回执还没变 → 先显示「已下发」，别让按钮像没反应
    if (p && Date.now() - p.at < 20000 && (!line || line === p.base)) return { ...PET_RECEIPT_VIEW.pending, raw: '刚下发，等桌宠回执' }
    if (!line) return null
    const r = parseBehaviorReceipt(line)
    if (!r) return { ...PET_RECEIPT_VIEW.other, word: line, raw: line }
    const v = PET_RECEIPT_VIEW[r.status] || PET_RECEIPT_VIEW.other
    if (r.status === 'other') return { ...v, word: r.text, raw: line }
    return { ...v, why: r.why, raw: line }
  }
  const bNextIn = bh && bh.nextAt ? Math.round((bh.nextAt - Date.now()) / 60000) : null
  const bNextText = bNextIn == null ? '还没排程' : bNextIn <= 0 ? '马上' : bNextIn < 60 ? '约 ' + bNextIn + ' 分钟后' : bNextIn < 1440 ? '约 ' + Math.round(bNextIn / 60) + ' 小时后' : '约 ' + Math.round(bNextIn / 144) / 10 + ' 天后'
  const tryAction = async (action) => {
    const base = bLatest(action)
    setPend((old) => ({ ...old, [action]: { base, at: Date.now() } }))
    try {
      // 面板通道：不直连模块的 /behavior，走宿主的 /panel/pet/behavior 代理（和碎碎念/专注模式同一套）
      const r = await post('/panel/pet/behavior', { action, force: true })
      if (!r.ok) {
        setPend((old) => { const n = { ...old }; delete n[action]; return n })
        toast(r.message || '没演成', 'err')
      } else toast(r.message || '已下发', 'ok')
    } catch (e) { toast(e.message) } finally { setTimeout(loadBehavior, 1500) }
  }
  const toggleAction = async (action, on) => {
    try {
      const r = await post('/panel/pet/behavior/actions', { action, on })
      if (!r.ok) toast(r.message || '没保存', 'err')
      else {
        setBh((old) => (old ? { ...old, disabledActions: Array.isArray(r.disabledActions) ? r.disabledActions : [] } : old))
        toast(on ? '这个动作重新交给 AI 了' : '这个动作不给 AI 用了（「试一下」不受影响）', 'ok')
      }
    } catch (e) { toast(e.message) } finally { loadBehavior() }
  }
  const restoreIcon = async (id) => {
    try {
      const r = await post('/panel/pet/behavior/restore', { id })
      toast(r.message || (r.ok ? '放回去了' : '没放回去'), r.ok ? 'ok' : 'err')
    } catch (e) { toast(e.message) } finally { loadBehavior() }
  }
  // 第三批：关窗后「补偿道歉」——心情回一点，并标记最近一条未道歉的记录
  const apologize = async () => {
    try {
      const r = await post('/panel/pet/behavior/apologize', {})
      toast(r.message || (r.ok ? 'ta道了歉' : '没道歉'), r.ok ? 'ok' : 'err')
    } catch (e) { toast(e.message) } finally { loadBehavior() }
  }
  // 行为与安全：c = 本地草稿（改了一半别被 8 秒轮询冲掉）|| 服务端真值
  const c = bcfg || bh || {}
  const saveBehCfg = async (patch, msg) => { await savePet(patch, msg); setBcfg(null); loadBehavior() }
  // ---------- 物理三参数（重力/弹力/动作频率）的草稿读写：null = 跟着服务端值走 ----------
  const pv = (k, fallback) => (ph && ph[k] != null ? ph[k] : fallback)
  const setPv = (k, v) => setPh((old) => ({ ...(old || {}), [k]: v }))
  // 只清掉刚保存的那一项的草稿，别把另外两项改了一半的输入一起冲掉
  const clearPv = (k) => setPh((old) => {
    if (!old) return null
    const next = { ...old }
    delete next[k]
    return Object.keys(next).length ? next : null
  })
  // 桌宠设置的写入通道：**优先走 /panel/pet/config**（宿主里专门给桌宠卡片开的那条白名单通道）。
  // 白名单里已登记这六项（见 src/host.js /panel/pet/config 的 petGravity/petRestitution/
  // petAnimRate/petShowBalance/petClickChase/petTeaseChase），正常情况走的就是这条正规路。
  // 下面保留的 /save 回退**不是**主路径，而是「宿主白名单未同步」时的兼容退路：
  // 用户装的模块比面板新时，会撞上「模块已有新设置键、宿主白名单还没补」的窗口期，
  // 那会儿 /panel/pet/config 会以「没有可保存的字段」失败；有这条退路，控件不会在窗口期变成假控件。
  // /save 是面板给扩展模块写设定的既有通用通道（{ ext: { 模块id: {...} } }），
  // mergeFromPanel 深合并、normalize 只保留 ext 下的对象、不会丢未知键；
  // 两条路最终都落到 ext.pet 这同一个地方，模块 api.settings() 读的就是它。
  // 【教训 · 三处必须同步】模块 settings 新增键 → 本文件控件 + 宿主白名单 + 模块 defaults，缺一即假控件。
  const savePetSetting = async (patch, okMsg) => {
    let r = await post('/panel/pet/config', patch)
    if (!r || r.ok === false) r = await post('/save', { ext: { pet: patch } })
    if (r && r.ok !== false) { toast(okMsg || '保存好了', 'ok'); return true }
    toast((r && r.message) || '没成功', 'err')
    return false
  }
  // ---------- 语音对讲（pet 1.2.0）独立配置：从 pet.voiceTalk 读，写入仍走 savePetSetting ----------
  // 服务端 status() 下发 pet.voiceTalk（hotkey/engine/rvc/rvcVoice/maxChars/asrUrl/sovitsUrl/
  // micDeviceId/speakerDeviceId/asrReady/asrReason）。老模块只下发 pet.call 时兼容读取，
  // 两者都没有时用安全默认值兜底照常渲染，这样模块升级顺序不同也不会白屏；
  // 保存即写 ext.pet.call*（引擎等沿用 call* 键）+ ext.pet.voiceHotkey，宿主白名单见 host.js /panel/pet/config。
  const CALL_DEFAULTS = { hotkey: 'Alt+Space', engine: 'native', rvc: false, rvcVoice: '', maxChars: 120, asrUrl: 'http://127.0.0.1:8000', sovitsUrl: 'http://127.0.0.1:9880', micDeviceId: '', speakerDeviceId: '', asrReady: null, asrReason: '' }
  // 优先读新快照 pet.voiceTalk，老模块只有 pet.call 时兼容读取；状态字段（asrReady/asrReason）只在新快照里
  const voiceTalk = pet?.voiceTalk || pet?.call || {}
  const callCfg = { ...CALL_DEFAULTS, ...voiceTalk }
  const cacVal = (k) => (cac && cac[k] != null ? cac[k] : callCfg[k])
  const setCacVal = (k, v) => setCac((old) => ({ ...(old || {}), [k]: v }))
  const saveCall = async (patch, msg) => { const ok = await savePetSetting(patch, msg); if (ok) setCac(null); return ok }
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '桌宠', desc: '把「大肥鱼」请到桌面上：一个小小的ta待在屏幕角落，主动搭话走气泡；你也可以点ta聊天。' },
    h('div', { className: 'ab-flex', style: { marginBottom: 8 } },
      h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', dotCls) }), state),
      h('span', { className: 'ab-muted ab-small' }, heart ? '上次心跳 ' + timeAgo(heart) : loaded ? '还没有心跳记录' : '加载中…')),
    h(Row, { label: '投递载体联动', hint: '在「主动搭话」页的目的机制卡里切换；现在是「' + (carrier === 'pet' ? '桌宠' : 'QQ 私聊') + '」' },
      h('span', { className: 'ab-muted ab-small' }, carrier === 'pet'
        ? (online ? '主动搭话正走桌宠气泡' : purpose?.petFallbackToQQ === false ? '桌宠离线，且已关闭回落：现在不会主动搭话' : '桌宠离线，主动搭话会回落到 QQ')
        : '主动搭话走 QQ 私聊，桌宠只显示气泡不发')),
    h(Row, { label: '专注模式', hint: '开着时ta不弹气泡、也不主动搭话（学习/开会不被打扰）' },
      h(Switch, { on: focus, onChange: async (v) => { setBusy('focus'); try { const r = await post('/panel/pet/focus', { enabled: v }); if (!r.ok) toast(r.message || '没成功', 'err'); else toast(v ? '专注模式开了' : '专注模式关了', 'ok') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })),
    // 只有 1.0.3 以上的桌宠模块才支持缩放
    pet?.scale != null ? h(Row, { label: '人物大小', hint: '0.5~2 倍，1 = 原始大小。拖滑块或在框里填数都可以，点保存后桌宠会自己整窗缩放（拖拽/甩抛物理跟着对齐），不用重启' },
      h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
        h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, style: { flex: 1, minWidth: 120, accentColor: 'var(--ab-sea, #2a86c6)' }, value: Number(scVal == null ? (pet?.scale || 1) : scVal), onChange: (e) => setScVal(e.target.value) }),
        h('input', { className: 'ab-input', type: 'number', min: 0.5, max: 2, step: 0.05, style: { width: 84 }, value: scVal == null ? (pet?.scale || 1) : scVal, onChange: (e) => setScVal(e.target.value) }),
        h('span', { className: 'ab-muted ab-small', style: { whiteSpace: 'nowrap' } }, '倍'),
        h(Btn, { small: true, disabled: busy === 'scale', onClick: async () => { const v = Number(scVal == null ? (pet?.scale || 1) : scVal); if (!(v >= 0.5 && v <= 2)) { toast('大小要填 0.5 ~ 2 之间的数', 'err'); return } setBusy('scale'); try { await savePet({ petScale: Math.round(v * 20) / 20 }, '人物大小已保存'); setScVal(null) } finally { setBusy(''); load() } } }, busy === 'scale' ? '保存中…' : '保存'))) : null,
    // 只有 1.0.4 以上的桌宠模块才支持松手落地开关（老模块不显示，免得拨了没反应）
    pet?.releaseLand != null ? h(Row, { label: '松手后落地', hint: '开：拖动松手后按甩出速度抛出去、落回屏幕底部（带 Q 弹挤压）。关：松手停在哪就在哪，不抛也不落' },
      h(Switch, { on: pet.releaseLand !== false, onChange: async (v) => { setBusy('land'); try { await savePet({ petReleaseLand: v }, v ? '松手落地已开启' : '松手落地已关闭：松手停在哪就在哪') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })) : null,
    // ============================================================
    // 【教训 · 面板是硬编码的，不是按模块 settings 自动渲染的】
    // 桌宠是**内置模块**，它的 settings 数组（模块侧 declarative 声明）在面板里根本不会生成表单——
    // 面板只给「用户自己从模块市场装的扩展模块」按 settings 渲染卡片。所以模块那边加了
    // 设置项、defaults 也齐、/config 也下发，用户在面板上照样一个字都看不到：
    //   **模块 settings 里新增一个键，必须同时在宿主这里补一个写入白名单（/panel/pet/config）
    //     和一个本文件里的控件，否则就是「后端有、面板看不见」的半截功能。**
    //   三处必须同步：模块 defaults/settings 声明 + 宿主 /panel/pet/config 白名单 + 本文件控件；
    //   缺任何一处都是「假控件」（看得见、点了存不进去，轮询还会把值弹回去）。
    // 下面这六项（重力/弹力/动作频率/查看余额/点击追鼠标/晃鼠标勾引追）就是 1.0.14 新加的，
    // 全部用 pet 顶层实际下发的字段做守卫（老模块 1.0.13 及以前不会有这些字段）：
    //   pet.physics?.gravity、pet.physics?.restitution、pet.animRate、
    //   pet.balanceEnabled、pet.clickChase、pet.teaseChase
    // 老模块下这一整段都不渲染，免得给用户看一堆拨了没反应的假控件。
    // ============================================================
    pet?.physics?.gravity != null ? h(Row, { label: '重力', hint: '下落加速度，越小飘得越久、越大落得越快（默认 1400）' },
      h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
        h('input', { type: 'range', min: 200, max: 4000, step: 50, style: { flex: 1, minWidth: 120, accentColor: 'var(--ab-sea, #2a86c6)' }, value: Number(pv('gravity', pet.physics.gravity)), onChange: (e) => setPv('gravity', e.target.value) }),
        h('input', { className: 'ab-input', type: 'number', min: 200, max: 4000, step: 50, style: { width: '84px' }, value: pv('gravity', pet.physics.gravity), onChange: (e) => setPv('gravity', e.target.value) }),
        h(Btn, { small: true, disabled: busy === 'grav', onClick: async () => { const v = Number(pv('gravity', pet.physics.gravity)); if (!(v >= 200 && v <= 4000)) { toast('重力要填 200 ~ 4000 之间的数', 'err'); return } setBusy('grav'); try { const ok = await savePetSetting({ petGravity: Math.round(v) }, '重力已保存'); if (ok) clearPv('gravity') } finally { setBusy(''); load() } } }, busy === 'grav' ? '保存中…' : '保存'))) : null,
    pet?.physics?.restitution != null ? h(Row, { label: '弹力', hint: '落地反弹保留速度比例，越大越 Q 弹（默认 0.78）' },
      h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
        h('input', { type: 'range', min: 0.3, max: 0.95, step: 0.01, style: { flex: 1, minWidth: 120, accentColor: 'var(--ab-sea, #2a86c6)' }, value: Number(pv('restitution', pet.physics.restitution)), onChange: (e) => setPv('restitution', e.target.value) }),
        h('input', { className: 'ab-input', type: 'number', min: 0.3, max: 0.95, step: 0.01, style: { width: '84px' }, value: pv('restitution', pet.physics.restitution), onChange: (e) => setPv('restitution', e.target.value) }),
        h(Btn, { small: true, disabled: busy === 'rest', onClick: async () => { const v = Number(pv('restitution', pet.physics.restitution)); if (!(v >= 0.3 && v <= 0.95)) { toast('弹力要填 0.3 ~ 0.95 之间的数', 'err'); return } setBusy('rest'); try { const ok = await savePetSetting({ petRestitution: Math.round(v * 100) / 100 }, '弹力已保存'); if (ok) clearPv('restitution') } finally { setBusy(''); load() } } }, busy === 'rest' ? '保存中…' : '保存'))) : null,
    pet?.animRate != null ? h(Row, { label: '动作频率', hint: '动画节奏倍率，>1 更活泼（默认 1）' },
      h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
        h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, style: { flex: 1, minWidth: 120, accentColor: 'var(--ab-sea, #2a86c6)' }, value: Number(pv('animRate', pet.animRate)), onChange: (e) => setPv('animRate', e.target.value) }),
        h('input', { className: 'ab-input', type: 'number', min: 0.5, max: 2, step: 0.1, style: { width: '84px' }, value: pv('animRate', pet.animRate), onChange: (e) => setPv('animRate', e.target.value) }),
        h('span', { className: 'ab-muted ab-small', style: { whiteSpace: 'nowrap' } }, '倍'),
        h(Btn, { small: true, disabled: busy === 'anim', onClick: async () => { const v = Number(pv('animRate', pet.animRate)); if (!(v >= 0.5 && v <= 2)) { toast('动作频率要填 0.5 ~ 2 之间的数', 'err'); return } setBusy('anim'); try { const ok = await savePetSetting({ petAnimRate: Math.round(v * 10) / 10 }, '动作频率已保存'); if (ok) clearPv('animRate') } finally { setBusy(''); load() } } }, busy === 'anim' ? '保存中…' : '保存'))) : null,
    // 查看余额 / 点击追鼠标 / 晃鼠标勾引追：三个开关，即点即存（跟「松手后落地」同一个范式）
    pet?.balanceEnabled != null ? h(Row, { label: '查看余额', hint: '开 = 右键菜单显示「查看余额」（读当前 DeepSeek 账户余额）；默认开' },
      h(Switch, { on: pet.balanceEnabled !== false, onChange: async (v) => { setBusy('bal'); try { await savePetSetting({ petShowBalance: v }, v ? '右键菜单会显示「查看余额」' : '右键菜单不再显示「查看余额」') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })) : null,
    pet?.clickChase != null ? h(Row, { label: '点击追鼠标', hint: '开 = 点她会扑上来抓鼠标；默认关（不抓鼠标）' },
      h(Switch, { on: pet.clickChase === true, onChange: async (v) => { setBusy('click'); try { await savePetSetting({ petClickChase: v }, v ? '点击会追鼠标了' : '点击不再抓鼠标') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })) : null,
    pet?.teaseChase != null ? h(Row, { label: '晃鼠标勾引追', hint: '开 = 在她跟前晃鼠标她会扑上来；默认关（不抓鼠标）' },
      h(Switch, { on: pet.teaseChase === true, onChange: async (v) => { setBusy('tease'); try { await savePetSetting({ petTeaseChase: v }, v ? '晃鼠标会勾引她追了' : '晃鼠标不再勾引她') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })) : null,
    // 只有 pet 1.0.5 以上的模块才有对话框（老模块不显示这些行，免得拨了没反应）
    chatCfg ? h('div', { style: { marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--ab-line, #dbe5ea)' } },
      h('div', { className: 'ab-small ab-muted', style: { marginBottom: 2 } },
        '对话框：ta 自己的小窗，只在桌面里聊，永不发 QQ。现在 ' + (chatCfg.enabled ? (chatCfg.windowOpen ? '开着' : '开着（窗没开）') : '关着')
        + (chatCfg.thinking ? ' · 正在想上一句' : '') + (chatCfg.historyCount ? ' · 历史 ' + chatCfg.historyCount + ' 条' : '')),
      h(Row, { label: '开启对话框', hint: '关掉后快捷键会一起注销；开着才能用快捷键/右键菜单唤出小窗' },
        h(Switch, { on: chatCfg.enabled !== false, onChange: async (v) => { setBusy('chat-on'); try { await savePet({ petChatEnabled: v }, v ? '对话框已开启' : '对话框已关闭（快捷键已注销）') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })),
      h(Row, { label: '对话框快捷键', hint: '全局快捷键，按一次开、再按一次关（如 Alt+P）。留空 = 不启用。' + hotkeyStateText },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(200px, 100%)' }, placeholder: 'Alt+P', value: cg('hotkey', ''), onChange: (e) => setCg('hotkey', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveChat({ petChatHotkey: String(cg('hotkey', '')).trim() }, '快捷键已保存：桌宠会立刻重新注册') } }, '保存'))),
      h(Row, { label: '关闭关键字', hint: '在对话框里发送这句话 → 直接关窗、不请求模型。留空 = 不启用关键字关闭' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(200px, 100%)' }, placeholder: '关闭', value: cg('closeKeyword', ''), onChange: (e) => setCg('closeKeyword', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveChat({ petChatCloseKeyword: String(cg('closeKeyword', '')).trim() }, '关闭关键字已保存') } }, '保存'))),
      h(Row, { label: '失焦自动收起', hint: '点别处（小窗失焦）时自动关掉对话框' },
        h(Switch, { on: chatCfg.blurHide !== false, onChange: async (v) => { setBusy('chat-blur'); try { await savePet({ petChatBlurHide: v }, v ? '失焦会收起' : '失焦不再收起') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } })),
      h(Row, { label: '历史条数 / 保留天数', hint: '只存桌宠本地（不进 QQ、不进工作区）。超限从头部截断；天数填 0 = 永久保留' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', type: 'number', min: 10, max: 2000, style: { width: 96 }, value: cg('maxEntries', 200), onChange: (e) => setCg('maxEntries', e.target.value) }),
          h('span', { className: 'ab-muted ab-small' }, '条'),
          h('input', { className: 'ab-input', type: 'number', min: 0, max: 3650, style: { width: 96 }, value: cg('retentionDays', 30), onChange: (e) => setCg('retentionDays', e.target.value) }),
          h('span', { className: 'ab-muted ab-small' }, '天'),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveChat({ petChatMaxEntries: Number(cg('maxEntries', 200)), petChatRetentionDays: Number(cg('retentionDays', 30)) }, '历史设置已保存') } }, '保存'))),
      h(Row, { label: '天气城市', hint: '填城市名（如 上海）才接入天气，进对话框和碎碎念的「现在」；留空 = 不接入' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(200px, 100%)' }, placeholder: '留空 = 不接入', value: cg('weatherCity', ''), onChange: (e) => setCg('weatherCity', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveChat({ petWeatherCity: String(cg('weatherCity', '')).trim() }, '天气城市已保存') } }, '保存'),
          chatCfg.weather ? h('span', { className: 'ab-muted ab-small' }, '现在：' + chatCfg.weather) : null))) : null,
    clientBad ? h('div', { className: 'ab-note warn', style: { marginTop: 8 } },
      h('div', null, '⚠ 客户端和插件版本对不上：' + (clientInfo.message || '需要重新生成')),
      clientInfo.missing && clientInfo.missing.length ? h('div', { className: 'ab-small', style: { marginTop: 4 } }, '缺文件：' + clientInfo.missing.join('、') + '（缺 behavior.js 时行为层整个不生效，只打日志）') : null,
      clientInfo.needsRestart ? h('div', { className: 'ab-small', style: { marginTop: 4 } }, 'Electron 现在在跑：重新生成后要「停止桌宠」再「启动桌宠」才生效') : null) : null,
    h('div', { className: 'ab-flex', style: { marginTop: 10 } },
      h(Btn, { small: true, disabled: busy === 'dl', onClick: async () => { setBusy('dl'); try { const r = await post('/panel/pet/download'); if (!r.ok) toast(r.message || '没成功', 'err'); else toast(clientBad ? '客户端已重新生成，重启 Electron 后生效' : '客户端已放到数据目录，按桌宠模块说明启动即可', 'ok') } catch (e) { toast(e.message) } finally { setBusy(''); load() } } }, busy === 'dl' ? '生成中…' : clientBad ? '重新生成客户端' : '下载 / 生成客户端'),
      h('span', { className: 'ab-muted ab-small' }, '放到数据目录 modules-data/pet/app，随插件自动发现')),
    h('div', { className: 'ab-flex', style: { marginTop: 6 } },
      // 远端直连模式（pet.remoteClient = 配了 publicBaseUrl）：服务器无桌面，Electron 三键换成「下载客户端包」
      pet?.remoteClient ? h('span', null,
        h(Btn, { small: true, disabled: busy === 'pkg', onClick: () => { window.open(API + '/panel/pet/client-package', '_blank') } }, busy === 'pkg' ? '打包中…' : '下载客户端包'),
        h('span', { className: 'ab-muted ab-small', style: { marginLeft: 8 } }, '服务器模式：解压到你自己的电脑，装好 Electron 后在解压目录运行 npx electron main.js（host.json 已内嵌远端地址与令牌，别外传这个包）'))
      : h('span', null,
        h(Btn, { small: true, disabled: busy === 'ei', onClick: () => act('ei', '/panel/pet/electron-install', 'Electron 安装完成') }, busy === 'ei' ? '安装中…' : electronInstalled ? '重装 Electron' : '安装 Electron'),
        h(Btn, { small: true, disabled: busy === 'la', onClick: () => act('la', '/panel/pet/launch', '已启动') }, busy === 'la' ? '启动中…' : '启动桌宠'),
        h(Btn, { small: true, disabled: busy === 'st', onClick: () => act('st', '/panel/pet/stop', '已停止') }, busy === 'st' ? '停止中…' : '停止桌宠')),
      h('span', { className: 'ab-muted ab-small' },
        pet?.remoteClient ? '' : 'Electron ' + (electronInstalled ? '已装' : '未装') + '｜运行 ' + (online ? '在跑' : '没在跑') + (pet?.pid ? '（pid ' + pet.pid + '）' : '') + (portReady ? '' : '｜端口未就绪（等宿主注入）'))),
    // 远端直连的安全状态与应急动作（2026-11-02）：明文阻断提示 + 令牌轮换
    pet?.remoteClient ? h('div', { style: { marginTop: 8 } },
      pet?.publicBaseInsecure
        ? h('div', { className: 'ab-small', style: { color: '#d9534f', marginBottom: 6 } },
          pet?.allowInsecureRemote
            ? '⚠ 对外地址是明文 http，且已开启「允许明文跨机」：令牌与气泡内容在公网上是明文，强烈建议改用 https'
            : '⛔ 对外地址是明文 http，跨机访问已被阻断：请在反向代理上启用 https（仅内网自测才开「允许明文 http 跨机」）')
        : null,
      pet?.tokenExpired
        ? h('div', { className: 'ab-small', style: { color: '#d9534f', marginBottom: 6 } }, '⛔ 桌宠令牌已过期：点下面「轮换令牌」，然后重新下载客户端包')
        : null,
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, kind: 'ghost', disabled: busy === 'rt', onClick: async () => {
          if (!confirm('轮换后旧令牌立即失效，所有桌宠客户端都要重新下载客户端包才能连上。确定轮换？')) return
          setBusy('rt')
          try { const r = await post('/panel/pet/rotate-token'); toast(r.message || (r.ok ? '已轮换' : '没成功'), r.ok ? 'ok' : 'err'); load() } catch (e) { toast(e.message) } finally { setBusy('') }
        } }, busy === 'rt' ? '轮换中…' : '轮换令牌'),
        h('span', { className: 'ab-muted ab-small', style: { marginLeft: 8 } },
          '令牌泄露时用它应急：旧令牌立即失效，需重新下载客户端包' +
          (pet?.tokenIssuedAt ? '｜签发于 ' + new Date(pet.tokenIssuedAt).toLocaleString() : '') +
          (pet?.tokenTtlDays ? '（有效期 ' + pet.tokenTtlDays + ' 天）' : '（永不过期）'))))
      : null,
    h(Row, { label: 'Electron 镜像', hint: '装 Electron 从哪下（末尾带 /）。默认 npmmirror，国内一般快；连不上可换 https://github.com/electron/electron/releases/download/。留空 = 用内置默认。npm 装失败会自动改用 zip 直装' },
      h('div', { className: 'ab-flex' },
        h('input', { className: 'ab-input', style: { width: 'min(300px, 100%)' }, value: emUrl == null ? (pet?.electronMirror || '') : emUrl, placeholder: 'https://npmmirror.com/mirrors/electron/', onChange: (e) => setEmUrl(e.target.value) }),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await savePet({ electronMirror: String(emUrl == null ? (pet?.electronMirror || '') : emUrl).trim() }, 'Electron 镜像已保存'); setEmUrl(null) } }, '保存'))),
    h(Row, { label: '表情预览', hint: '气泡与心情事件会用到这些表情' },
      h('div', { style: { flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 } },
        moods.map((m, i) => h('span', { key: (m.key || m) + i, className: 'ab-pill' }, moodLabel(m))))),
    ),
    // ---------- 语音对讲（1.2.0）：桌宠页里**独立的一张卡**，不是对话框卡的一部分 ----------
    // 值从 pet.voiceTalk（兼容 pet.call）读，写入仍走 savePetSetting → /panel/pet/config。
    // 下拉与开关即点即存；文本/数字用独立草稿 cac（改一半别被 8 秒轮询冲掉），点各自的「保存」才下发。
    // toggle 模式：热键按一下开始听、再按一下发送；不设独立界面状态概念，只做收听与外放。
    h(Card, { title: '语音对讲', desc: '按一下热键开始听、再按一下发送——大肥鱼「听到」（识别）→ 想（人格+记忆）→ 直接用系统音箱说出来，像智能音箱一样对讲。不弹窗、不发 QQ，设备由桌宠客户端上报。' },
      h('div', { className: 'ab-small ab-muted', style: { marginBottom: 6 } },
        '当前：' + (callCfg.engine === 'sovits' ? '本地 GPT-SoVITS' : callCfg.engine === 'voice' ? '「语音」页接管' : '系统原生')
        + '｜触发热键：' + (callCfg.hotkey || '（未启用）')
        + (callCfg.rvc ? '｜RVC 变声：' + (callCfg.rvcVoice || '未设音色') : '')),
      // ASR 前置状态：未连通时红字显示人话原因，别等说完才报错（设计权威 §3）
      callCfg.asrReady === false
        ? h('div', { className: 'ab-small', style: { color: '#d9534f', marginBottom: 6 } }, '⚠ 识别未就绪：' + (callCfg.asrReason || '本地识别未连通，请配 faster-whisper 或开 DSH 语音输入'))
        : callCfg.asrReady === true
          ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 6 } }, '✓ 识别已就绪，可以开始对讲')
          : null,
      h(Row, { label: '触发热键', hint: '全局热键：按一下开始听、再按一下发送。留空 = 不启用' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(200px, 100%)' }, placeholder: 'Alt+Space', value: cacVal('hotkey'), onChange: (e) => setCacVal('hotkey', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveCall({ voiceHotkey: String(cacVal('hotkey')).trim() }, '触发热键已保存') } }, '保存'))),
      h(Row, { label: '麦克风设备 ID', hint: '桌宠客户端上报；空 = 系统默认。面板只显示当前值，要换设备请到桌宠客户端里选' },
        h('span', { className: 'ab-muted ab-small' }, callCfg.micDeviceId || '系统默认')),
      h(Row, { label: '扬声器设备 ID', hint: '桌宠客户端上报；空 = 系统默认外放' },
        h('span', { className: 'ab-muted ab-small' }, callCfg.speakerDeviceId || '系统默认')),
      h(Row, { label: '识别地址（callAsrUrl）', hint: '本地 faster-whisper 地址；DSH「语音输入」没开或音频不是 WAV 时退回这里。留空 = 回落内置默认 http://127.0.0.1:8000。识别未就绪看上面的提示' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(320px, 100%)' }, placeholder: 'http://127.0.0.1:8000', value: cacVal('asrUrl'), onChange: (e) => setCacVal('asrUrl', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveCall({ callAsrUrl: String(cacVal('asrUrl')).trim() }, '识别地址已保存') } }, '保存'))),
      h(Row, { label: '回答引擎（嘴）', hint: '只影响对讲里回答的声音，不改全局语音设置。系统原生 = edge 合成失败退 系统语音；本地 GPT-SoVITS = 用参考音频音色；语音页接管 = 豆包，你自选接管时才碰' },
        h(Select, { value: cacVal('engine'), width: 320, options: [
          { value: 'native', label: 'native 系统原生（默认，edge 合成，失败退 系统语音）' },
          { value: 'sovits', label: 'sovits 本地 GPT-SoVITS（参考音频音色）' },
          { value: 'voice', label: 'voice 语音页接管（豆包，自选才碰）' },
        ], onChange: (v) => saveCall({ callEngine: v }, '回答引擎已保存') })),
      h(Row, { label: 'GPT-SoVITS 地址', hint: '引擎选「本地 GPT-SoVITS」才用；参考音频沿用「语音」页的 gptsovits 配置。留空 = 回落内置默认 http://127.0.0.1:9880' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(320px, 100%)' }, placeholder: 'http://127.0.0.1:9880', value: cacVal('sovitsUrl'), onChange: (e) => setCacVal('sovitsUrl', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveCall({ sovitsUrl: String(cacVal('sovitsUrl')).trim() }, 'GPT-SoVITS 地址已保存') } }, '保存'))),
      h(Row, { label: 'RVC 变声', hint: 'TTS 出稿后用「翻唱」模块导入的音色再变一次声；翻唱没就绪时自动不变声并在状态里说明' },
        h(Switch, { on: Boolean(cacVal('rvc')), onChange: (v) => saveCall({ callRvc: v }, v ? 'RVC 变声已开启' : 'RVC 变声已关闭') })),
      h(Row, { label: '音色名', hint: '翻唱模块里导入的音色名（翻唱页能看到清单）；RVC 变声打开才生效' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', style: { width: 'min(200px, 100%)' }, placeholder: '如 小鱼', value: cacVal('rvcVoice'), onChange: (e) => setCacVal('rvcVoice', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { await saveCall({ callRvcVoice: String(cacVal('rvcVoice')).trim() }, '音色名已保存') } }, '保存'))),
      h(Row, { label: '一次最多字数', hint: '回答别太长，长了反而不像人（20~300 字，默认 120）' },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
          h('input', { className: 'ab-input', type: 'number', min: 20, max: 300, step: 1, style: { width: 96 }, value: cacVal('maxChars'), onChange: (e) => setCacVal('maxChars', e.target.value) }),
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: async () => { const v = Number(cacVal('maxChars')); if (!(v >= 20 && v <= 300)) { toast('一次最多字数要填 20 ~ 300 之间的数', 'err'); return } await saveCall({ callMaxChars: Math.round(v) }, '字数上限已保存') } }, '保存'))),
    ),
    // ---------- 素材包：默认形象包（大肥鱼）自动下载落位，也可在这里换镜像地址重下 ----------
    h(Card, { title: '素材包', desc: '桌宠的形象与动画（「大肥鱼」那 106 段）。插件发现缺包会自动从素材仓库下载落位，通常不用你动手；下载不动时可以在这里换镜像地址再重下。没有素材时桌宠会显示内置的静态形象（蓝色小鲸鱼）。' },
      !pet ? h(Empty, { icon: '⏳', text: '加载中…' })
        : (() => {
          const pi = pet.packInfo || null
          if (!pi) return h('div', { className: 'ab-flex' }, h('span', { className: 'ab-muted ab-small' }, '素材包状态接口还没就绪（更新插件后刷新页面即可）'), h(Btn, { small: true, onClick: load }, '重试'))
          const okPack = Boolean(pi.hasDefault && pi.defaultAnims > 0)
          const cur = pkUrl == null ? (pi.url || '') : pkUrl
          return h('div', null,
            h('div', { className: 'ab-flex', style: { marginBottom: 8, flexWrap: 'wrap' } },
              h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', okPack ? 'ok' : 'err') }), okPack ? '已就位' : '还没有素材'),
              h('span', { className: 'ab-pill' }, 'default：' + (pi.defaultAnims || 0) + ' 个动画'),
              pi.downloading ? h('span', { className: 'ab-pill' }, '正在下载…') : null,
              !okPack ? h('span', { className: 'ab-muted ab-small' }, '缺包时每 10 分钟会自动重试一次') : null),
            h(Row, { label: '下载地址', hint: 'zip 直链。默认走 GitHub 素材仓库 dsh-aurabot-qq-mods；国内网络可换成 gitee / ghproxy 等镜像。zip 里素材放文件夹即可（如 pet-pack/default-animation/）' },
              h('input', { className: 'ab-input', style: { width: 'min(380px, 100%)' }, value: cur, placeholder: 'https://…/archive/refs/heads/main.zip', onChange: (e) => setPkUrl(e.target.value) })),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              h(Btn, { small: true, disabled: busy === 'cfg' || busy === 'pk' || !String(cur).trim(), onClick: async () => { await savePet({ petPackUrl: String(cur).trim() }, '下载地址已保存'); setPkUrl(null) } }, '保存地址'),
              h(Btn, { small: true, disabled: busy === 'pk', onClick: () => act('pk', '/panel/pet/fetch-pack', '素材包已就位') }, busy === 'pk' ? '下载中…' : okPack ? '重新下载素材包' : '下载素材包'),
              h('span', { className: 'ab-muted ab-small' }, '落位到 modules-data/pet/packs/，下完自动生效')))
        })()),
    // ---------- 行为动作（面板测试通道）：状态行 + 逐动作「试一下」/ AI 开关 + 行内最近回执 ----------
    h(Card, { title: '行为动作', desc: 'ta的「行为大脑」每隔一会儿自己挑一个动作演：追鼠标、叼鼠标、叼图标、推窗口……这里可以逐个「试一下」（绕过专注模式与安静时段，立刻下发），也可以把某个动作从 AI 的动作表里拿掉——「试一下」按钮不受影响。桌宠没在跑时点按钮只是下发排队，等ta跑起来才演。右边「最近回执」是客户端演完或拒演回来的结果。AI 每次决策都在工作区里单独开一条「行为大脑」会话，能当场看到ta怎么想的。' },
      bhErr && !bh
        ? h('div', { className: 'ab-flex' }, h('span', { className: 'ab-muted ab-small' }, '行为动作接口还没就绪：' + bhErr + '（更新插件后刷新页面即可）'), h(Btn, { small: true, onClick: loadBehavior }, '重试'))
        : !bh ? h(Empty, { icon: '⏳', text: '加载中…' })
          : h('div', null,
            h('div', { className: 'ab-flex', style: { marginBottom: 6 } },
              h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', bh.enabled ? 'ok' : '') }), '行为大脑' + (bh.enabled ? '开着' : '关着')),
              h('span', { className: 'ab-pill' }, '今天 ' + (bh.today || 0) + '/' + (bh.maxPerDay ?? '?') + ' 次'),
              h('span', { className: 'ab-pill' }, bh.thinking ? '正在想下一个动作…' : '下次触发 ' + bNextText),
              bh.online === false ? h('span', { className: 'ab-pill' }, h('i', { className: 'ab-dot err' }), '桌宠没在跑') : null,
            ),
            h('div', { className: 'ab-muted ab-small', style: { marginBottom: 8 } },
              (bh.enabled ? '' : '总开关关着（模块设置里打开）：AI 不会自己演，下面的「试一下」照常能用。')
              + (bh.lastAt ? '上次演 ' + timeAgo(bh.lastAt) + '。' : '今天还没演过。')),
            // 环境简报对账（这一轮 AI 到底拿到了什么）：图标是服务端直接读桌面目录，
            // 窗口只能靠客户端定时上报（/behavior/env），所以两者要分开显示，缺一个就说明那半边喂空了
            h('div', { className: 'ab-muted ab-small', style: { marginBottom: 8 } },
              '环境简报：桌面图标 ' + ((Array.isArray(bh.envIcons) ? bh.envIcons.length : 0)) + ' 个'
              + '｜开着的窗口 ' + ((Array.isArray(bh.envWindows) ? bh.envWindows.length : 0)) + ' 个'
              + (bh.envWindowsAt ? '（' + timeAgo(bh.envWindowsAt) + '上报）' : '（客户端还没上报，窗口动作只能按前台窗口算）')
              + (bh.thinking ? '｜正在「' + (bh.turnTitle || '行为大脑') + '」里想' : '')),
            h('table', { className: 'ab-table' },
              h('thead', null, h('tr', null, ['动作', '最近回执', 'AI 动作表', '试一下'].map((x) => h('th', { key: x }, x)))),
              h('tbody', null, PET_BEHAVIOR_ACTIONS.map((a) => {
                const rc = receiptOf(a.action)
                // 置灰只认服务端口径：deferredActions 里还有它才算「还没实现」（第三批三个已放开）
                const deferred = (Array.isArray(bh && bh.deferredActions) ? bh.deferredActions : []).includes(a.action)
                return h('tr', { key: a.action },
                  h('td', null,
                    h('b', null, a.name),
                    h('span', { className: 'ab-muted ab-small' }, ' ' + a.action),
                    h('div', { className: 'ab-muted ab-small' }, a.effect + (a.tier === 2 ? '（第二批，可还原）' : deferred ? '（还没实现）' : ''))),
                  h('td', { style: { maxWidth: 220 } }, rc
                    ? h('span', { className: 'ab-small', style: { color: rc.color }, title: rc.raw }, rc.icon + ' ' + rc.word + (rc.why ? '：' + rc.why : ''))
                    : h('span', { className: 'ab-muted ab-small' }, '还没试过')),
                  h('td', null, h(Switch, {
                    on: !bDisabled.has(a.action), disabled: deferred,
                    title: deferred ? '第三批还没实现，先不进 AI 动作表' : '关掉后 AI 不会自己挑这个动作（「试一下」不受影响）',
                    onChange: (v) => toggleAction(a.action, v),
                  })),
                  h('td', null, h(Btn, { small: true, onClick: () => tryAction(a.action) }, '试一下')),
                )
              })),
            ),
          ),
    ),
    // ---------- 行为与安全（模块级开关）----------
    // 为什么放在面板：hasUi 不给自带页面的模块生成自动表单，这里不补一张卡，关窗物理闸就永远打不开。
    bh ? h(Card, {
      title: '行为与安全',
      desc: 'AI 只能从动作表里挑动作，闹到什么程度由这里定。开关即点即存，数字和白名单点「应用」。'
        + '「允许 AI 关闭窗口」默认关，它是一道物理闸：AI 与手动「试一下」都绕不过去。',
    },
      h(Row, { label: '行为大脑', hint: '关掉后ta不再自己挑动作（面板「试一下」仍可手动触发）' },
        h(Switch, { on: c.enabled !== false, onChange: (v) => saveBehCfg({ behaviorEnabled: v }, v ? '行为大脑已开' : '行为大脑已关，ta只回应你') })),
      h(Row, { label: '行为间隔', hint: '最短不低于 1 分钟（铁律）' },
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 9999, value: c.minMinutes ?? '', onChange: (e) => setBcfg({ ...c, minMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '到'),
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 9999, value: c.maxMinutes ?? '', onChange: (e) => setBcfg({ ...c, maxMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '分钟'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorMinMinutes: Number(c.minMinutes), behaviorMaxMinutes: Number(c.maxMinutes) }, '间隔改好了') }, '应用')),
      h(Row, { label: '每天最多', hint: '0 = ta不再自己动' },
        h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 999999, value: c.maxPerDay ?? '', onChange: (e) => setBcfg({ ...c, maxPerDay: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '次'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorMaxPerDay: Number(c.maxPerDay) }, '上限改好了') }, '应用')),
      h(Row, { label: '鼠标闲置凑近', hint: '鼠标这么久没动，ta凑过去戳一下' },
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 240, value: c.idleCursorMinutes ?? '', onChange: (e) => setBcfg({ ...c, idleCursorMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '分钟'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorIdleCursorMinutes: Number(c.idleCursorMinutes) }, '改好了') }, '应用')),
      h(Row, { label: '图标小动作', hint: '叼着桌面图标拖一拖 / 收走图标（只挪不删，可一键归还）' },
        h(Switch, { on: c.iconMischiefEnabled !== false, onChange: (v) => saveBehCfg({ behaviorIconMischiefEnabled: v }, v ? '图标小动作已开' : '已关，ta不碰桌面图标了') })),
      h(Row, { label: '收走的图标自动归还', hint: '超过这么多天还没被放回，ta自己还回去' },
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 365, value: c.iconQuarantineDays ?? '', onChange: (e) => setBcfg({ ...c, iconQuarantineDays: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '天'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorIconQuarantineDays: Number(c.iconQuarantineDays) }, '改好了') }, '应用')),
      h(Row, { label: '允许 AI 关闭窗口', hint: '⚠ 高危：会真的关闭程序窗口，未保存的工作可能丢失。物理闸：AI 与「试一下」都绕不过去，测试关窗前必须先打开它' },
        h(Switch, { on: c.closeWindowEnabled === true, onChange: (v) => saveBehCfg({ behaviorCloseWindowEnabled: v }, v ? '已允许关窗；建议先在下面填白名单' : '已禁止关窗') })),
      h(Row, { label: '关窗心情闸', hint: '心情低于此值 AI 才可能关窗（手动「试一下」不受心情限制，只受上面的物理闸管）' },
        h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 100, value: c.moodCloseWindowBelow ?? '', onChange: (e) => setBcfg({ ...c, moodCloseWindowBelow: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '分'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorMoodCloseWindowBelow: Number(c.moodCloseWindowBelow) }, '改好了') }, '应用')),
      h(Row, { label: '窗口操作白名单', hint: '一行一个进程名或标题关键词；留空 = 只碰普通窗口（DSH 自己、桌宠、资源管理器永远不碰）' },
        h('textarea', { className: 'ab-textarea', rows: 3, value: c.windowWhitelist ?? '', placeholder: 'notepad', onChange: (e) => setBcfg({ ...c, windowWhitelist: e.target.value }) }),
        h('div', { style: { marginTop: 6 } }, h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ behaviorWindowWhitelist: String(c.windowWhitelist ?? '') }, '白名单存好了') }, '保存白名单'))),
    ) : null,
    // ---------- 聊天联动：主人聊天时她可能顺带做个小动作（只读旁观，独立开关/冷却/上限；模块代码在 mods 仓）----------
    h(Card, { title: '聊天联动', desc: '主人在生效范围内的 QQ 聊天里说话时，ta可能根据聊天内容与心情顺带在桌面上做个小动作（追鼠标、溜达、小动作、说一句话——只挑安分的，绝不碰图标和窗口）。ta只是旁观聊天：不接管消息、不改回复、不阻塞回合，聊天功能完全不受影响。默认关；与上面的「行为大脑」总开关互相独立（关掉行为大脑不影响这边，反之亦然）。每次决策在工作区「聊天联动」会话里能看到ta的取舍。' },
      h('div', { className: 'ab-flex', style: { marginBottom: 6 } },
        h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', c.chatBehaviorEnabled ? 'ok' : '') }), '聊天联动' + (c.chatBehaviorEnabled ? '开着' : '关着')),
        h('span', { className: 'ab-pill' }, '今天 ' + (c.chatBehaviorToday || 0) + '/' + (c.chatBehaviorMaxPerDay ?? '?') + ' 次'),
        c.chatBehaviorThinking ? h('span', { className: 'ab-pill' }, '正在想要不要动…') : null,
        c.chatBehaviorLastAt ? h('span', { className: 'ab-muted ab-small' }, '上次 ' + timeAgo(c.chatBehaviorLastAt)) : null),
      h(Row, { label: '开启聊天联动', hint: '开关即点即存；关掉后聊天时ta只回复、不动' },
        h(Switch, { on: c.chatBehaviorEnabled === true, onChange: (v) => saveBehCfg({ chatBehaviorEnabled: v }, v ? '聊天联动已开' : '聊天联动已关') })),
      h(Row, { label: '生效范围', hint: '一行一个：private:QQ号 或 group:群号（写法同「权限」页白名单，冒号后带空格也能认）；留空 = 只有主人私聊生效。不符合格式的行会被忽略，不会报错' },
        h('textarea', { className: 'ab-textarea', rows: 3, value: c.chatBehaviorWhitelistText ?? '', placeholder: 'private:12345\ngroup:67890', onChange: (e) => setBcfg({ ...c, chatBehaviorWhitelistText: e.target.value }) }),
        h('div', { style: { marginTop: 6 } }, h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ chatBehaviorWhitelist: String(c.chatBehaviorWhitelistText ?? '') }, '生效范围存好了') }, '保存范围'))),
      h(Row, { label: '冷却', hint: '两次联动动作之间至少隔这么久（1~1440 分钟），宁缺毋滥' },
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 1440, value: c.chatBehaviorCooldownMinutes ?? '', onChange: (e) => setBcfg({ ...c, chatBehaviorCooldownMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '分钟'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ chatBehaviorCooldownMinutes: Number(c.chatBehaviorCooldownMinutes) }, '冷却改好了') }, '应用')),
      h(Row, { label: '每天最多', hint: '0 = 聊天时ta也不动' },
        h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 9999, value: c.chatBehaviorMaxPerDay ?? '', onChange: (e) => setBcfg({ ...c, chatBehaviorMaxPerDay: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '次'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => saveBehCfg({ chatBehaviorMaxPerDay: Number(c.chatBehaviorMaxPerDay) }, '上限改好了') }, '应用')),
    ),
    // ---------- 被收走的图标（第二批）：hide_icon 的隔离区，一键放回 ----------
    h(Card, { title: '被收走的图标', desc: '「收图标」不是删除：ta把桌面图标剪切到插件数据目录的隔离区，文件原样留着。这里可以随时放回原位（原位置被占了会自动改名「名字(归还)」），超过「隔离保留天数」（默认 7 天）ta也会自己放回去。' },
      quarErr
        ? h('div', { className: 'ab-flex' }, h('span', { className: 'ab-muted ab-small' }, '隔离区清单读不了：' + quarErr), h(Btn, { small: true, onClick: loadBehavior }, '重试'))
        : quar === null ? h(Empty, { icon: '⏳', text: '加载中…' })
          : quar.length === 0 ? h(Empty, { icon: '✨', text: '隔离区空空的，桌宠很乖' })
            : h('table', { className: 'ab-table' },
              h('thead', null, h('tr', null, ['名称', '原位置', '收走时间', '原因', ''].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', null, quar.map((it) => h('tr', { key: it.id },
                h('td', null, h('b', null, it.name || '（未命名）')),
                h('td', { style: { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: it.originalPath || '' },
                  h('span', { className: 'ab-muted ab-small' }, it.originalPath || '—')),
                h('td', null, h('span', { className: 'ab-muted ab-small' }, it.at ? new Date(it.at).toLocaleString() : '—')),
                h('td', null, h('span', { className: 'ab-muted ab-small' }, it.reason || '—')),
                h('td', null, h(Btn, { small: true, onClick: () => restoreIcon(it.id) }, '放回去')),
              ))),
            ),
    ),
    // ---------- 关窗记录（第三批）：close_window 的账本 + 一键补偿道歉 ----------
    h(Card, { title: '关窗记录', desc: '「关窗口」是高危动作：AI 只有在「允许 AI 关闭窗口」开着、且ta心情低于 ' + (bh && bh.moodCloseWindowBelow != null ? bh.moodCloseWindowBelow : 35) + ' 时才会自己关；手动「试一下」不受心情限制，但同样要先开那个开关。关的方式等于点右上角 X（程序会自己问要不要保存）。DSH 自己的窗口、桌宠、资源管理器、全屏窗口永远不碰。' },
      h('div', { className: 'ab-flex', style: { marginBottom: 8 } },
        h('span', { className: 'ab-pill' }, '今天关了 ' + ((bh && bh.closeToday) || 0) + ' 个'),
        h('span', { className: 'ab-pill' }, bh && bh.closeWindowEnabled ? 'AI 关窗：已允许' : 'AI 关窗：不允许（默认）'),
        bh && bh.mood != null ? h('span', { className: 'ab-muted ab-small' }, '现在心情 ' + bh.mood + '（低于 ' + bh.moodCloseWindowBelow + ' 才会自己关）') : null,
        bh && bh.apologyDue ? h(Btn, { small: true, onClick: apologize }, '让ta道歉（心情回一点）') : null),
      (bh && Array.isArray(bh.closeLog) && bh.closeLog.length)
        ? h('table', { className: 'ab-table' },
          h('thead', null, h('tr', null, ['窗口', '时间', '结果', ''].map((x, i) => h('th', { key: i }, x)))),
          h('tbody', null, bh.closeLog.map((x, i) => h('tr', { key: i },
            h('td', { style: { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: x.window || '' },
              h('b', null, x.window || '（没回报窗口名）')),
            h('td', null, h('span', { className: 'ab-muted ab-small' }, x.at ? new Date(x.at).toLocaleString() : '—')),
            h('td', null, h('span', { className: 'ab-small' },
              x.status === 'played' ? '关掉了' : x.status === 'refused' ? '被拦下：' + (x.reason || '') : '没关成')),
            h('td', null, h('span', { className: 'ab-muted ab-small' }, x.apologizedAt ? '已道歉' : (x.status === 'played' ? '还没道歉' : '—'))),
          ))),
        )
        : h(Empty, { icon: '🪟', text: '还没关过任何窗口（ta挺乖的）' }),
    ),
    // ---------- 碎碎念：桌宠自己的气泡流（载体选 QQ 也照常生效，永不发 QQ） ----------
    whisper ? h(Card, { title: '碎碎念', desc: 'ta自己在桌面上嘟囔的小气泡：跟「主动搭话」完全分开，载体选 QQ 时也照常出现；只上桌宠气泡，不会发到 QQ。到了点ta会带着记忆自己想一句——工作区里会像「主动搭话（目的回合）」那样开一条「' + (whisper.turnTitle || '桌宠 · 碎碎念（自己的回合）') + '」的会话，能当场看到ta的思考过程。间隔与时段跟着「主动搭话」那边的醒着时间。' },
      h(Row, { label: '开启碎碎念', hint: whisper.thinking ? 'ta正在工作区那条会话里想这一句…' : whisper.carrier === 'pet' && whisper.pauseOnPetCarrier !== false ? '当前载体是桌宠，按下面的开关暂停中' : '到点ta会自己冒一句话' },
        h(Switch, { on: whisper.enabled !== false, onChange: (v) => savePet({ whisperEnabled: v }, v ? '碎碎念开了' : '碎碎念关了') })),
      h(Row, { label: '说什么', hint: '「ta自己想一句」会走后台回合：先用记忆 + 当下的干活状态想，工作区能看到思考；失败自动回落文案池' },
        h(Select, {
          value: whisper.source || 'model',
          options: [{ value: 'model', label: 'ta自己想一句（推荐）' }, { value: 'pool', label: '用现成文案' }],
          onChange: (v) => savePet({ whisperSource: v }),
        })),
      h(Row, { label: '两次之间隔', hint: '在这个范围里随机（1~9999 分钟）；刚弹过「主动搭话」的气泡会让一让' },
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 9999, value: whisper.minMinutes ?? '', onChange: (e) => setWs({ ...whisper, minMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '到'),
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: 9999, value: whisper.maxMinutes ?? '', onChange: (e) => setWs({ ...whisper, maxMinutes: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '分钟'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => savePet({ whisperMinMinutes: Number(whisper.minMinutes), whisperMaxMinutes: Number(whisper.maxMinutes) }) }, '应用')),
      h(Row, { label: '每天最多' },
        h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 9999, value: whisper.maxPerDay ?? '', onChange: (e) => setWs({ ...whisper, maxPerDay: e.target.value }) }),
        h('span', { className: 'ab-muted' }, '次'),
        h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => savePet({ whisperMaxPerDay: Number(whisper.maxPerDay) }) }, '应用')),
      h(Row, { label: '载体是桌宠时暂停', hint: '主动搭话已经走桌宠气泡时，别同时冒两个气泡' },
        h(Switch, { on: whisper.pauseOnPetCarrier !== false, onChange: (v) => savePet({ whisperPauseOnPetCarrier: v }) })),
      h('div', { style: { marginTop: 6 } },
        h('div', { className: 'ab-muted ab-small', style: { marginBottom: 4 } }, '自定义文案（一行一句；留空用内置文案。模型失败时也从这里抽）'),
        h('textarea', {
          className: 'ab-textarea', style: { minHeight: 78 },
          value: whisper.lines || '',
          placeholder: '（趴在屏幕边上发呆）\n今天也一起加油吧…',
          onChange: (e) => setWs({ ...whisper, lines: e.target.value }),
        }),
        h('div', { className: 'ab-flex', style: { marginTop: 6 } },
          h(Btn, { small: true, disabled: busy === 'cfg', onClick: () => savePet({ whisperLines: whisper.lines || '' }) }, '保存文案'),
          h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, kind: 'primary', disabled: busy === 'wh', onClick: async () => {
            setBusy('wh')
            try { const r = await post('/panel/pet/whisper', {}); toast(r.message || (r.ok ? 'ta嘟囔了一句' : '没说出来'), r.ok ? 'ok' : 'err') }
            catch (e) { toast(e.message) } finally { setBusy(''); load() }
          } }, busy === 'wh' ? 'ta想呢…' : '现在碎碎念一句'))),
      h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } },
        '今天已碎碎念 ' + (whisper.today || 0) + '/' + (whisper.maxPerDay ?? '?') + ' 次'
        + (whisper.lastAt ? ' · 上次 ' + timeAgo(whisper.lastAt) : '')
        + (whisper.thinking ? ' · 正在想这一句…' : nextIn != null ? ' · 下次约 ' + nextText : '')
        + (whisper.lastText ? ' · 「' + whisper.lastText + '」' : '')),
    ) : null,
    // ---------- 干活状态：DSH 会话事件 → 动画 + 结束提醒 ----------
    h(Card, { title: '干活状态与提醒', desc: 'ta在桌面上跟着 DSH 的进度演：思考时托腮想事，干活时忙碌，等你确认时张望，完成后雀跃一下——顺手弹一句、发个系统通知。' },
      h(Row, { label: '状态动画', hint: '思考 / 干活 / 等确认 / 完成 / 出错 跟着会话自动切' },
        h(Switch, { on: workEnabled, onChange: (v) => savePet({ workStatusEnabled: v }) })),
      h(Row, { label: '现在的状态' },
        h('span', { className: 'ab-muted ab-small' }, work && work.state
          ? (work.label || work.state) + (work.task ? '：' + work.task : '') + '（' + timeAgo(work.at) + '）'
          : '空闲（ta自己在玩）')),
      h(Row, { label: '完工弹一句气泡' }, h(Switch, { on: pet && pet.workBubble === false ? false : true, onChange: (v) => savePet({ workBubble: v }) })),
      h(Row, { label: '完工发系统通知', hint: 'Windows 右下角通知；不喜欢可以关掉只留气泡' }, h(Switch, { on: pet && pet.workNotify === false ? false : true, onChange: (v) => savePet({ workNotify: v }) })),
      h(Row, { label: '动画对应', hint: '按形象包里的「工作状态-*」自动对；可在 <包名>-config.json 的 events.workStatus 覆盖' },
        h('span', { className: 'ab-muted ab-small' }, (() => {
          const map = pet && pet.workAnimMap
          if (!map) return '当前形象包没读到工作状态动画，会退回说话/待机动作'
          const names = { thinking: '思考', working: '干活', result: '出结果', waiting: '等确认', success: '完成', error: '出错' }
          return Object.keys(names).map((k) => names[k] + '→' + (map[k] ? '有' : '缺')).join('　')
        })())),
    ),
  )
}

export { PET_MOODS, PET_BEHAVIOR_ACTIONS, PET_RECEIPT_VIEW, parseBehaviorReceipt, PetPanel }
