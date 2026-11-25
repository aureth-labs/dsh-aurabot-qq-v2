import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from './core/react.ts'
import { PANEL_READ_TIMEOUT, bustPanelGet, clone, copySecretFlags, maskSecretFields, post, sharedGet, sharedPanelGet } from './core/api.ts'
import { getPath, ptrToDots, setPath, timeAgo } from './core/format.ts'
import { NAV_GROUPS, NavBar, TABS, TAB_MODS, TabBoundary, connectionsToOnebot, navGroupById } from './core/nav.ts'
import { Btn, Switch, cx, h, useStyle } from './core/ui.ts'
import { Access, Group } from './tabs/access.ts'
import { Autotelic } from './tabs/autotelic.ts'
import { Connect, avatarSrc, pickAvatar } from './tabs/connect.ts'
import { ContentTab } from './tabs/content.ts'
import { Diary, SpeakUp } from './tabs/diary.ts'
import { ImageGen, Video } from './tabs/media.ts'
import { MemoryTab } from './tabs/memory.ts'
import { Model } from './tabs/model.ts'
import { ExtPage, Market, Modules } from './tabs/modules.ts'
import { Mood } from './tabs/mood.ts'
import { About, Manage, Overview, SnowLumaCompatBanner } from './tabs/overview.ts'
import { Persona } from './tabs/persona.ts'
import { PetPanel } from './tabs/pet.ts'
import { Stickers } from './tabs/stickers.ts'
import { Backup, Browser, LocalApi, Logs, Security, Song } from './tabs/system.ts'
import { VoiceTab } from './tabs/voice.ts'
import { Wizard } from './wizard.ts'

// ---------------- 面板主体 ----------------
function AurabotPage() {
  useStyle()
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState(null)
  const [tab, setTab] = useState(() => {
    try {
      // 旧版 persona 是人格页；只迁移一次，之后 persona 指向人物记忆。
      if (!localStorage.getItem('aurabot.persona-tab-v2')) {
        if (localStorage.getItem('aurabot.tab') === 'persona') localStorage.setItem('aurabot.tab', 'character')
        let last = {}
        try { last = JSON.parse(localStorage.getItem('aurabot.navlast') || '{}') || {} } catch (e) {}
        for (const key of Object.keys(last)) if (last[key] === 'persona') last[key] = 'character'
        localStorage.setItem('aurabot.navlast', JSON.stringify(last))
        localStorage.setItem('aurabot.persona-tab-v2', '1')
      }
      // 语音识别（asr）已并入「语音」页：旧页签迁到 voice，并记住要看「听语音」子视图。
      if (!localStorage.getItem('aurabot.voice-tab-v1')) {
        let last = {}
        try { last = JSON.parse(localStorage.getItem('aurabot.navlast') || '{}') || {} } catch (e) {}
        if (localStorage.getItem('aurabot.tab') === 'asr') {
          localStorage.setItem('aurabot.tab', 'voice')
          localStorage.setItem('aurabot.voice-view', 'listen')
        }
        for (const key of Object.keys(last)) if (last[key] === 'asr') last[key] = 'voice'
        localStorage.setItem('aurabot.navlast', JSON.stringify(last))
        localStorage.setItem('aurabot.voice-tab-v1', '1')
      }
      // 人物记忆（persona）已并入「记忆」页：旧页签迁到 memory，并记住要看「人物」子视图。
      // 排在 persona-tab-v2 之后：更早的 persona = 旧人格页，仍按历史规则归到 character。
      if (!localStorage.getItem('aurabot.memory-tab-v1')) {
        let last = {}
        try { last = JSON.parse(localStorage.getItem('aurabot.navlast') || '{}') || {} } catch (e) {}
        if (localStorage.getItem('aurabot.tab') === 'persona') {
          localStorage.setItem('aurabot.tab', 'memory')
          localStorage.setItem('aurabot.memory-view', 'person')
        }
        for (const key of Object.keys(last)) if (last[key] === 'persona') last[key] = 'memory'
        localStorage.setItem('aurabot.navlast', JSON.stringify(last))
        localStorage.setItem('aurabot.memory-tab-v1', '1')
      }
      // B站 / 抖音 / 小黑盒已并入「内容平台」：旧页签迁到 content + 对应子视图。
      if (!localStorage.getItem('aurabot.content-tab-v1')) {
        let last = {}
        try { last = JSON.parse(localStorage.getItem('aurabot.navlast') || '{}') || {} } catch (e) {}
        const cur = localStorage.getItem('aurabot.tab')
        if (cur === 'bili' || cur === 'douyin' || cur === 'heybox') {
          localStorage.setItem('aurabot.tab', 'content')
          localStorage.setItem('aurabot.content-view', cur)
        }
        for (const key of Object.keys(last)) {
          if (last[key] === 'bili' || last[key] === 'douyin' || last[key] === 'heybox') last[key] = 'content'
        }
        localStorage.setItem('aurabot.navlast', JSON.stringify(last))
        localStorage.setItem('aurabot.content-tab-v1', '1')
      }
      return localStorage.getItem('aurabot.tab') || 'overview'
    } catch (e) { return 'overview' }
  })
  const [toastMsg, setToastMsg] = useState(null)
  // 语音页子视图：'send' 发语音 / 'listen' 听语音（旧「语音识别」页迁入 listen）
  const [voiceView, setVoiceView] = useState(() => { try { const v = localStorage.getItem('aurabot.voice-view'); return ['listen', 'services'].includes(v) ? v : 'send' } catch (e) { return 'send' } })
  // 切换子视图时记住选择：下次进来还停在同一视图
  const pickVoiceView = (v) => { setVoiceView(v); try { localStorage.setItem('aurabot.voice-view', v) } catch (e) {} }
  // 记忆页子视图：'starmap' 星图（默认）/ 'entries' 记忆条目 / 'person' 人物。
  // 老用户已存的 entries/person 继续有效；没存过或值异常 → 默认星图。
  const [memoryView, setMemoryView] = useState(() => {
    try {
      const v = localStorage.getItem('aurabot.memory-view')
      return v === 'entries' || v === 'person' ? v : 'starmap'
    } catch (e) { return 'starmap' }
  })
  const pickMemoryView = (v) => { setMemoryView(v); try { localStorage.setItem('aurabot.memory-view', v) } catch (e) {} }
  // 内容平台子视图：bili / douyin / heybox（旧三个独立页签迁入这里）
  const [contentView, setContentView] = useState(() => { try { return localStorage.getItem('aurabot.content-view') || '' } catch (e) { return '' } })
  const pickContentView = (v) => { setContentView(v); try { localStorage.setItem('aurabot.content-view', v) } catch (e) {} }
  const [wizardOpen, setWizardOpen] = useState(false)
  const [boot, setBoot] = useState(null)         // /panel/bootstrap 成功摘要
  const [bootErr, setBootErr] = useState(null)   // { code, message }：TIMEOUT / BOOTSTRAPPING / CONNECT / AUTH / STATE / CONFIG
  const [ready, setReady] = useState(false)      // bootstrap + /state 水合 + /panel/config 草稿全部就绪
  const [lastSyncAt, setLastSyncAt] = useState(0) // 最近一次 pulse 成功时间（失败时保留旧数据并标注更新时间）
  const toastTimer = useRef(null)
  const dirtyRef = useRef(false)
  const draftBaseRef = useRef(null)
  const [saveConflict, setSaveConflict] = useState('')
  const saveRef = useRef(null)
  const pluginStartRef = useRef(0)
  // kind：ok / err / 不填 = 普通
  const toast = (m, kind) => {
    const text = String(m || '')
    const k = kind || (/失败|出错|没成功|不能|读不到|连不上/.test(text) ? 'err' : '')
    setToastMsg({ text, kind: k })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200)
  }
  // /state 只做一次性水合（旧消费页仍按需读取）：不再回灌草稿——草稿唯一来源是 /panel/config。
  const reload = useCallback(async () => {
    const r = await sharedGet('/state')
    if (!r || r.ok === false) { setErr(r && r.message ? r.message : '读不到插件状态'); return r }
    if (Number(r.startedAt)) pluginStartRef.current = Number(r.startedAt)
    setErr('')
    setSt(r)
    return r
  }, [])
  const bootRef = useRef(null)          // 最近一次有效的 bootstrap/pulse 摘要（bootId/版本/导航版本）
  const configRevRef = useRef(null)     // 当前草稿基线对应的 configRevision
  const draftSnapRef = useRef(null)     // 最近一次权威配置快照（/panel/config 或保存回执）
  const readRegistry = useRef(new Set()) // 在途轻量读取的 AbortController，卸载时统一放弃
  const retryRef = useRef(null)
  // 草稿基线初始化/刷新：只认 /panel/config。没在编辑时直接采纳快照；正在编辑时保留本地草稿，
  // 但权威快照仍存进 draftSnapRef 供保存回执对账，st.config 同步为最新已知值（展示用）。
  const loadConfigDraft = useCallback(async () => {
    const r = await sharedPanelGet('/panel/config', { registry: readRegistry.current })
    if (!r || r.ok === false) return r
    const snap = clone(r.config || {})
    if (r.configRevision != null) configRevRef.current = r.configRevision
    draftSnapRef.current = snap
    setSt((prev) => (prev ? { ...prev, config: clone(snap) } : prev))
    setDraft((current) => {
      if (!dirtyRef.current || !current) {
        draftBaseRef.current = clone(snap)
        return clone(snap)
      }
      return current
    })
    return r
  }, [])
  // 启动序列：外壳先渲染 → /panel/bootstrap（3 秒截止 + 指数退避）→ 并行水合 /state 与 /panel/config。
  // bootstrap 前不打 /state；未就绪时按可识别状态提示（超时/启动中/连不上/权限受限）。
  useEffect(() => {
    let stopped = false
    let timer = null
    let delay = 2000
    const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
    const attempt = async () => {
      if (stopped) return
      const r = await sharedPanelGet('/panel/bootstrap', { registry: readRegistry.current })
      if (stopped) return
      if (!r || r.ok === false) {
        setBootErr({ code: (r && r.code) || 'CONNECT', message: (r && r.message) || '暂时连不上插件' })
        if ((r && r.code) === 'AUTH') return // 权限受限：自动重试没有意义，等用户/管理员处理
        delay = Math.min(delay * 2, 15000)
        timer = setTimeout(attempt, delay)
        return
      }
      bootRef.current = r
      setBoot(r)
      const [sr, cr] = await Promise.all([reload(), loadConfigDraft()])
      if (stopped) return
      if (!sr || sr.ok === false || !cr || cr.ok === false) {
        const msg = !sr || sr.ok === false ? (sr && sr.message) || '读不到插件状态' : (cr && cr.message) || '读不到插件配置'
        setBootErr({ code: !sr || sr.ok === false ? 'STATE' : 'CONFIG', message: msg })
        delay = Math.min(delay * 2, 15000)
        timer = setTimeout(attempt, delay)
        return
      }
      setBootErr(null)
      setReady(true)
    }
    retryRef.current = () => { clear(); delay = 2000; attempt() }
    attempt()
    return () => { stopped = true; clear(); retryRef.current = null }
  }, [])
  // 卸载时放弃所有在途轻量读取（bootstrap/pulse/config）
  useEffect(() => () => {
    for (const ctl of readRegistry.current) { try { ctl.abort() } catch (e) { /* 已结束的忽略 */ } }
    readRegistry.current.clear()
  }, [])
  // 轮询收敛：根轮询读 /panel/pulse（稳定期 12 秒，bootstrap 后预热期 2 秒）；
  // 页面隐藏时停止，恢复时立即补一次；连续失败按退避放缓（保留最近成功结果并靠 lastSyncAt 标注）。
  useEffect(() => {
    if (!ready) return undefined
    let stopped = false
    let timer = null
    let failures = 0
    const mountedAt = Date.now()
    const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
    const schedule = (ms) => { if (!stopped) { clear(); timer = setTimeout(tick, ms) } }
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'hidden') return
      const r = await sharedPanelGet('/panel/pulse', { registry: readRegistry.current })
      if (stopped) return
      if (!r || r.ok === false) {
        failures++
        schedule(Math.min(12000 * Math.pow(2, Math.min(failures - 1, 2)), 30000))
        return
      }
      failures = 0
      setLastSyncAt(Date.now())
      const prevBoot = bootRef.current
      if (prevBoot && r.bootId && r.bootId !== prevBoot.bootId) {
        // 宿主重启：旧在途响应全部失效；保留草稿并提示重新核对；重新走一遍 bootstrap+水合
        toast('插件刚刚重启过：界面正在切换到新实例，未保存的草稿已保留，请重新核对后再保存。', 'err')
        setReady(false)
        setBoot(null)
        bootRef.current = null
        if (retryRef.current) retryRef.current()
        return
      }
      // 轻量合并：controls（总开关/试运行/调试）与 connections 快照就地更新到 st；草稿一律不动
      if (r.controls) {
        if (bootRef.current) bootRef.current = { ...bootRef.current, controls: r.controls }
        setSt((prev) => (prev ? { ...prev, config: {
          ...prev.config,
          enabled: r.controls.enabled != null ? Boolean(r.controls.enabled) : prev.config.enabled,
          dryRun: r.controls.dryRun != null ? Boolean(r.controls.dryRun) : prev.config.dryRun,
          debug: r.controls.debug != null ? Boolean(r.controls.debug) : prev.config.debug,
        } } : prev))
      }
      if (r.connections) {
        setSt((prev) => {
          if (!prev) return prev
          const onebot = connectionsToOnebot(r.connections, prev.onebot)
          return { ...prev, connections: r.connections, ...(onebot ? { onebot } : {}) }
        })
      }
      if (r.setupDone != null && bootRef.current) bootRef.current = { ...bootRef.current, setupDone: Boolean(r.setupDone) }
      // 配置版本变化：草稿没在编辑时按草稿规则刷新（来源仍是 /panel/config）；在编辑的延后到保存/离开时对账
      if (r.configRevision != null && configRevRef.current != null && r.configRevision !== configRevRef.current && !dirtyRef.current) loadConfigDraft()
      else if (r.configRevision != null && configRevRef.current == null) configRevRef.current = r.configRevision
      // 导航版本变化：合并一次 bootstrap 刷新
      if (r.navigationRevision != null && bootRef.current && bootRef.current.navigationRevision != null && r.navigationRevision !== bootRef.current.navigationRevision) {
        sharedPanelGet('/panel/bootstrap', { registry: readRegistry.current }).then((b) => {
          if (!stopped && b && b.ok !== false) { setBoot(b); bootRef.current = b }
        })
      }
      schedule(Date.now() - mountedAt < 10000 ? 2000 : 12000)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') { clear(); return }
      clear()
      tick()
    }
    document.addEventListener('visibilitychange', onVis)
    tick()
    return () => { stopped = true; clear(); document.removeEventListener('visibilitychange', onVis) }
  }, [ready])
  const go = (id) => { setTab(id); try { localStorage.setItem('aurabot.tab', id) } catch (e) {} }
  // 标签多、一屏放不下：滚轮横着滚，选中的标签自动滚进视野
  const tabsRef = useRef(null)
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const onWheel = (e) => { if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() } }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  useEffect(() => { tabsRef.current?.querySelector('.ab-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [tab])
  // 未保存标记对的是「草稿基线」（/panel/config 快照），不再是 /state 的配置——
  // pulse 和 /save 返回的配置只更新展示，不回灌草稿，也不做基线。
  const dirty = useMemo(() => Boolean(draft && draftBaseRef.current) && JSON.stringify(draft) !== JSON.stringify(draftBaseRef.current), [draft])
  dirtyRef.current = dirty
  const setD = (d) => setDraft(d)
  const discardDraft = () => {
    dirtyRef.current = false
    setSaveConflict('')
    if (draftBaseRef.current) setDraft(clone(draftBaseRef.current))
    loadConfigDraft() // 顺手把基线对齐到最新权威快照（没在编辑时直接采纳）
  }
  const saveImpl = async (override?) => {
    const { allow, commandAllow, capabilityAllow, ...rest } = clone(override || draft)
    // 基线来自 /panel/config 快照；只提交本次编辑过的顶层字段，没变的键不回传
    //（整表字段照旧整键发送，mergeFromPanel 语义不变）。
    const baseline = draftBaseRef.current || st.config
    const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
    const expected: any = {}
    const body: any = {}
    for (const k of Object.keys(rest)) {
      if (k === 'memberFilter' || k === 'group' || k === 'memory') continue // 这几个有单独的基线比对，见下
      if (changed(rest[k], baseline ? baseline[k] : undefined)) body[k] = rest[k]
    }
    // 未编辑的群设置不回写；编辑过的带上草稿基线，避免悄悄撤销 QQ 命令。
    if (changed(rest.memberFilter, baseline.memberFilter)) { body.memberFilter = rest.memberFilter; expected.memberFilter = baseline.memberFilter }
    if (changed(allow?.groups, baseline.allow?.groups)) {
      body.allow = { groups: allow.groups }
      expected.groups = baseline.allow.groups
    }
    if (changed(rest.group?.moduleOnlyGroups, baseline.group?.moduleOnlyGroups)) expected.groups = baseline.allow.groups
    if (changed(rest.group, baseline.group)) { body.group = rest.group; expected.group = baseline.group }
    if (changed(rest.memory, baseline.memory)) {
      const mem = clone(rest.memory || {})
      if (changed(mem.passiveGroups, baseline.memory?.passiveGroups)) expected.passiveGroups = baseline.memory?.passiveGroups
      else delete mem.passiveGroups
      if (Object.keys(mem).length) body.memory = mem
    }
    if (Object.keys(expected).length) body._groupSettingsBase = expected
    // 提交前使先前的配置 GET 过期（读到一半的旧快照不许再被当成新基线）
    bustPanelGet('/panel/config')
    const r = await post('/save', body)
    if (r.ok === false) {
      if (typeof r.message === 'string' && r.message.indexOf('连不上插件') === 0) {
        // 回执未知（网络中断/超时）：先重读权威快照显示最新已知状态，保留草稿，由用户决定是否重试
        toast('保存结果未知：已重新读取插件当前配置，请核对后再决定是否重试。', 'err')
        await loadConfigDraft()
        return false
      }
      if (r.code === 'group_settings_conflict') {
        setSaveConflict(r.message)
        // 保留草稿供查看，同时让「撤销」能取到最新值。轮询不能替换草稿基线。
        await reload()
      }
      toast(r.message || '保存失败', 'err'); return false
    }
    setSaveConflict('')
    if (r.bootId === undefined) {
      // 旧宿主响应（没有回执扩展）：沿用原行为，整份快照回灌
      draftBaseRef.current = clone(r.config)
      dirtyRef.current = false
      setSt(r)
      setDraft(clone(r.config))
      toast(r.message || '保存好了', 'ok')
      return true
    }
    if (bootRef.current && r.bootId && r.bootId !== bootRef.current.bootId) {
      // 宿主已重启：本次回执失效，保留草稿并提示重新核对
      toast('插件刚刚重启过：这次保存是否已生效需要重新核对（未保存的草稿已保留）。', 'err')
      await reload()
      await loadConfigDraft()
      return false
    }
    // 新回执：基线整体推进到回执版本；已确认字段（committedPaths）以权威快照为准，
    // unchangedPaths 只清脏标记（值本来就一致），其余本地草稿（含提交期间的新改动）原样保留。
    if (r.configRevision != null) configRevRef.current = r.configRevision
    const snap = clone(r.config || draftSnapRef.current || {})
    const committed = (r.committedPaths || []).map(ptrToDots)
    // #520：dirty 基线不能直接用脱敏 snap，否则草稿里填过的 secret 永远和它不相等，
    // 「有改动还没保存」一直显示。基线用本次完整草稿，但已提交字段以服务端归一化快照为准，
    // 并清空 secret 原文（保留 *Set 标志），避免明文留在草稿里、后续保存覆盖新密钥。
    let savedDraft = maskSecretFields(clone(override || draft))
    for (const dots of committed) savedDraft = setPath(savedDraft, dots, getPath(snap, dots))
    maskSecretFields(savedDraft)
    copySecretFlags(savedDraft, snap)
    draftBaseRef.current = savedDraft
    // 用新对象触发 useMemo（它的依赖只有 draft）；保存期间用户又改的部分原样保留，
    // 已经提交的旧 secret 也要从 current 清掉，避免下次整段回传覆盖别处轮换的新 key。
    setDraft((current) => {
      if (current === draft) return clone(savedDraft)
      const next = clone(current)
      maskSecretFields(next, draft)
      copySecretFlags(next, snap)
      return next
    })
    dirtyRef.current = false
    setSt((prev) => (prev ? { ...prev, config: clone(snap) } : prev))
    toast(r.message || '保存好了', 'ok')
    // 不再立即 loadConfigDraft：它内部会用脱敏快照覆盖基线，再次把 dirty 钉死。
    return true
  }
  const savingRef = useRef(false)
  const save = async (override?) => {
    if (savingRef.current) return false
    savingRef.current = true
    try { return await saveImpl(override) }
    catch (error) { toast('保存失败：' + (error && error.message ? error.message : error), 'err'); return false }
    finally { savingRef.current = false }
  }
  saveRef.current = save
  // 右上角的开关立刻生效；有没保存的改动时连同改动一起保存，不会把它们冲掉
  const quickToggle = async (path, v) => {
    await save(setPath(dirtyRef.current ? draft : clone(draftBaseRef.current || st.config), path, v))
  }
  // 试运行 / 调试互斥：开一个就自动关另一个。
  // 关掉「调试」退回「试运行」（而不是直接上线）—— 上线必须自己关掉「试运行」那个开关。
  const toggleRun = async (which, v) => {
    const base = clone(dirtyRef.current ? draft : (draftBaseRef.current || st.config))
    const debug = which === 'debug' ? Boolean(v) : false
    const dryRun = which === 'debug' ? !v : Boolean(v)
    await save(setPath(setPath(base, 'debug', debug), 'dryRun', dryRun))
  }
  // Ctrl/⌘ + S 保存
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirtyRef.current) {
        e.preventDefault()
        saveRef.current && saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 外壳先渲染：挂载即显示标题、基础导航、加载/失败提示与重试入口；bootstrap 返回前内容区只画中性骨架。
  // 向导与上次页面（aurabot.navlast）都只在收到有效 setupDone 并完成水合后才挂载/恢复。
  if (!ready || !st || !draft) {
    const hintMap = {
      TIMEOUT: '读取超时：插件 ' + Math.round(PANEL_READ_TIMEOUT / 1000) + ' 秒内没有应答。',
      BOOTSTRAPPING: '插件正在启动：核心还没就绪，会自动重试。',
      CONNECT: '暂时连不上插件：接口还没就绪或网络中断。',
      AUTH: '权限受限：当前身份没有打开 Aurabot 面板的权限。',
      STATE: '暂时读不到插件状态。',
      CONFIG: '暂时读不到插件配置。',
    }
    const hint = bootErr ? (hintMap[bootErr.code] || bootErr.message || '暂时连不上插件') : ''
    const canRetry = Boolean(bootErr && bootErr.code !== 'AUTH' && retryRef.current)
    const shellTabs = TABS
    const shellCur = shellTabs.find((t) => t.id === tab) || shellTabs[0]
    return h('div', { className: 'ab-root' },
      h('div', { className: 'ab-wrap' },
        h('div', { className: 'ab-hero' },
          h('div', { className: 'ab-avatar', style: { display: 'grid', placeItems: 'center', fontSize: 34 } }, '🐋'),
          h('div', { className: 'ab-hero-main' },
            h('h1', null, '大肥鱼'),
            h('div', { className: 'ab-sub' }, boot && boot.version ? 'Aurabot v' + boot.version + ' · 正在读取面板…' : '正在读取面板…'),
            h('div', { className: 'ab-pills' },
              h('span', { className: 'ab-pill' }, h('i', { className: 'ab-dot' }), bootErr ? '还没就绪' : '读取中'))),
          h('div', { className: 'ab-hero-side' },
            h('div', { className: 'ab-switch-row' }, h('span', null, '总开关'), h(Switch, { on: false, disabled: true, onChange: () => {} })),
            h('div', { className: 'ab-switch-row' }, h('span', { className: 'ab-muted' }, '试运行'), h(Switch, { on: false, disabled: true, onChange: () => {} })),
            h('div', { className: 'ab-switch-row' }, h('span', { className: 'ab-muted' }, '调试'), h(Switch, { on: false, disabled: true, onChange: () => {} })))),
        h(NavBar, { tabs: shellTabs, cur: shellCur, go, dirtyOf: () => false, subRef: tabsRef, mark: () => null }),
        h('div', { className: 'ab-boot-note' },
          bootErr
            ? h(Fragment, null, h('b', null, hint), h('div', { className: 'ab-spacer' }),
                canRetry ? h(Btn, { small: true, kind: 'primary', onClick: () => retryRef.current && retryRef.current() }, '重试') : null,
                h('span', { className: 'ab-muted ab-small' }, bootErr.code === 'AUTH' ? '请联系宿主管理员确认权限。' : '会自动重试，也可以点「重试」马上再试一次。'))
            : h(Fragment, null, h('span', null, '大肥鱼正在游过来…'), h('i', { className: 'ab-spin' }),
                h('span', { className: 'ab-muted ab-small' }, boot && boot.setupDone === false ? '首次使用：读完就进设置向导。' : ''))),
        h('div', { className: 'ab-card', style: { marginTop: 14, padding: '18px 20px', display: 'grid', gap: 10 } },
          h('div', { className: 'ab-skel', style: { height: 18, width: '38%' } }),
          h('div', { className: 'ab-skel', style: { height: 96 } }),
          h('div', { className: 'ab-skel', style: { height: 96 } }))),
      toastMsg ? h('div', { className: cx('ab-toast', toastMsg.kind), role: 'status' }, toastMsg.text) : null,
    )
  }
  const cfg = st.config
  const conn = st.onebot.state === 'connected'
  const status = !cfg.enabled ? { cls: '', text: '休息中（总开关关着）' } : !conn ? { cls: 'err', text: 'QQ 没连上' } : cfg.debug ? { cls: 'warn', text: '在线 · 调试' } : cfg.dryRun ? { cls: 'warn', text: '在线 · 试运行' } : { cls: 'ok', text: '在线' }
  const persona = st.personas.find((p) => p.id === cfg.persona.current)
  const props = { st, boot, draft, setDraft: setD, toast, reload, go, openWizard: () => setWizardOpen(true), voiceView, setVoiceView: pickVoiceView, memoryView, setMemoryView: pickMemoryView, contentView, setContentView: pickContentView }
  const showWizard = !cfg.setupDone || wizardOpen
  // 标签页：内置的按模块在不在跑决定显示；自己写的模块有设置或面板的各占一页
  const mods = st.modules || []
  const running = (id) => { const m = mods.find((x) => x.id === id); return Boolean(m && m.running) }
  // 哪些模块的界面已经有内置页：标签页自己的 id，或者在 TAB_MODS 里给某个内置页供内容的模块
  // （memory 的界面就在「心情与记忆」「人物记忆」里，purpose 在「主动搭话」里）。
  // 这些模块不再单独占一页，免得同一个东西出现两个标签。
  const hasBuiltinPage = (id) => TABS.some((t) => t.id === id) || Object.values(TAB_MODS).some((ids) => ids.includes(id))
  // 哪些模块单独占一页：自己写的模块有设置或面板就各占一页；内置模块只在声明了 panel 时单独占一页
  // （设置照样在内置标签页里改）。为什么允许内置模块带面板：面板只按「有没有声明 panel」判断，
  // 内置模块自己写了 panel.js 也应该能显示，不然那文件永远没入口。
  const hasUi = (m) => !hasBuiltinPage(m.id) && (m.running === 'user' && !m.builtin
    ? Boolean((m.settings || []).length || m.panel)
    : m.running === 'builtin' && Boolean(m.panel))
  // 写了 tab 的模块嵌进那个内置标签页；没写（或写的页不存在）的单独一页
  // 旧模块的 tab: 'persona' 原本嵌在「人格」，继续放回原页。
  const tabOf = (m) => {
    if (navGroupById(m.navGroup) || NAV_GROUPS.some((group) => group.tabs.includes('ext:' + m.id))) return ''
    return m.tab === 'persona' ? 'character' : m.tab
  }
  const intoTab = (m) => Boolean(tabOf(m) && TABS.some((t) => t.id === tabOf(m)))
  const extTabs = mods.filter((m) => hasUi(m) && !intoTab(m)).map((m) => ({
    id: 'ext:' + m.id,
    label: m.name,
    ext: m.id,
    navGroup: m.navGroup,
    flag: m.flag ? `ext.${m.id}.${m.flag}` : '',
    flagDefault: getPath(m.defaults || {}, m.flag || ''),
  }))
  const tabs = TABS.filter((t) => !TAB_MODS[t.id] || TAB_MODS[t.id].some(running))
  tabs.splice(tabs.findIndex((t) => t.id === 'logs'), 0, ...extTabs)
  const curTab = tabs.find((t) => t.id === tab) || tabs[0]
  const voiceExtensions = curTab.id === 'voice' ? mods.filter(m => hasUi(m) && tabOf(m) === 'voice') : []
  const body = curTab.ext ? ExtPage : {
    overview: Overview, manage: Manage, connect: Connect, character: Persona, access: Access, group: Group, model: Model, voice: VoiceTab,
    stickers: Stickers, imagegen: ImageGen, video: Video, diary: Diary, speakup: SpeakUp, autotelic: Autotelic, pet: PetPanel, mood: Mood, memory: MemoryTab, song: Song, content: ContentTab, local: LocalApi, browser: Browser, security: Security, market: Market, modules: Modules, logs: Logs, about: About, backup: Backup,
  }[curTab.id] || Overview
  // 哪些标签有没保存的改动
  // group 键补上 files/forward：整理合并转发/发文件是聊天页的独立配置域，不补则改动不显示未保存标记
  const TAB_KEYS = { character: ['personaLook'], connect: ['snowluma', 'botQQ'], access: ['ownerQQ', 'ownerName', 'ownerLevel', 'approvalNotify', 'approvalViaQQ', 'qqApi', 'longTasks', 'profilePerms', 'subagentBackground'], group: ['group', 'merge', 'titleFilter', 'memberFilter', 'chat', 'files', 'forward'], model: ['model', 'chatModels'], voice: ['voice'], stickers: ['stickers'], imagegen: ['imageGen'], video: ['video', 'local'], diary: ['diary', 'qzoneSocial'], speakup: ['speakUp', 'ext'], autotelic: [], pet: [], mood: ['mood', 'memory'], song: ['song'], content: ['bili', 'douyin', 'heybox'], local: ['local'], browser: ['browser'], security: ['security', 'update'] }
  const tabDirty = (id) => {
    if (!dirty) return false
    // 对基线（/panel/config 快照）比对，不对比 st.config——pulse 只更新展示，不代表草稿基线
    const base = draftBaseRef.current || cfg
    if (id.startsWith('ext:')) { const k = id.slice(4); return JSON.stringify((draft.ext || {})[k]) !== JSON.stringify((base.ext || {})[k]) }
    // 「聊天」页的旁听名单存于 memory，也需要显示未保存标记。
    if (id === 'group' && (JSON.stringify(draft.memory?.passiveGroups) !== JSON.stringify(base.memory?.passiveGroups) || JSON.stringify(draft.allow?.groups) !== JSON.stringify(base.allow?.groups))) return true
    // 「生图」页也管着 dsh-image 模块的设置。
    if (id === 'imagegen' && JSON.stringify((draft.ext || {})['dsh-image']) !== JSON.stringify((base.ext || {})['dsh-image'])) return true
    return (TAB_KEYS[id] || []).some((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]))
  }
  return h('div', { className: 'ab-root' },
    h('div', { className: 'ab-wrap' },
      h('div', { className: 'ab-hero' },
        h('button', { type: 'button', className: 'ab-avatar-btn', title: '点击换头像', onClick: () => pickAvatar(toast, reload) }, h('img', { className: 'ab-avatar', src: avatarSrc(st), alt: '头像' }), h('span', { className: 'ab-avatar-tip' }, '换头像')),
        h('div', { className: 'ab-hero-main' },
          h('h1', null, (st.onebot.login && st.onebot.login.nickname) || '大肥鱼'),
          h('div', { className: 'ab-sub' }, 'QQ ' + cfg.botQQ + ' · ' + (persona ? persona.name : '默认人格') + ' · ' + st.mood.label),
          h('div', { className: 'ab-pills' },
            h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', status.cls) }), status.text),
            h('span', { className: 'ab-pill' }, 'SnowLuma ' + (st.snowluma.installed ? (st.snowluma.running ? '运行中' : '没启动') : '未安装')),
            h('span', { className: 'ab-pill' }, 'Aurabot v' + st.version),
            lastSyncAt ? h('span', { className: 'ab-pill', title: '面板状态上次成功刷新的时间' }, '状态 ' + timeAgo(lastSyncAt)) : null)),
        h('div', { className: 'ab-hero-side' },
          h('div', { className: 'ab-switch-row' }, h('span', null, '总开关'), h(Switch, { on: cfg.enabled, onChange: (v) => quickToggle('enabled', v) })),
          h('div', { className: 'ab-switch-row' }, h('span', { className: 'ab-muted' }, '试运行'), h(Switch, { on: cfg.dryRun, onChange: (v) => toggleRun('dryRun', v), title: '开着时只写日志，不真的发到 QQ（记忆照写）' })),
          h('div', { className: 'ab-switch-row' }, h('span', { className: 'ab-muted' }, '调试'), h(Switch, { on: cfg.debug, onChange: (v) => toggleRun('debug', v), title: '调试：不真发，也不写任何记忆和聊天流水，只在日志里看。开它会自动关掉试运行' })))),
      showWizard ? h(Wizard, { st, draft, setDraft: setD, save, toast, reload, onClose: () => setWizardOpen(false) }) : null,
      showWizard ? null : h(NavBar, {
        tabs, cur: curTab, go, dirtyOf: tabDirty, subRef: tabsRef,
        mark: (t) => {
          if (tabDirty(t.id)) return h('i', { className: 'dirty', title: '有没保存的改动' })
          if (!t.flag && !t.flagFn) return null
          const flag = t.flagFn ? t.flagFn(cfg) : t.flag === 'group' ? cfg.allow.groups.length > 0 : getPath(cfg, t.flag) ?? t.flagDefault
          return h('i', { className: cx('ab-dot', flag && 'ok'), title: flag ? '开着' : '关着' })
        },
      }),
      showWizard ? null : h(SnowLumaCompatBanner, { st, go }),
      saveConflict ? h('div', { className: 'ab-note err', role: 'alert' }, saveConflict, h(Btn, { small: true, onClick: discardDraft }, '读取最新设置')) : null,
      showWizard ? null : h(TabBoundary, { key: curTab.id, onHome: () => go('overview') }, h(body, { ...props, mod: curTab.ext, extensions: voiceExtensions })),
      // dsh-image 已经嵌进「生图」页的「接口格式」里了，这里再渲染一次就是同一张卡出现两遍。
      showWizard || curTab.ext || curTab.id === 'voice' ? null : mods.filter((m) => hasUi(m) && tabOf(m) === curTab.id && !(curTab.id === 'imagegen' && m.id === 'dsh-image')).map((m) => h('div', { key: 'embed-' + m.id, style: { marginTop: 14 } }, h(ExtPage, { ...props, mod: m.id, embedded: true }))),
      dirty && !showWizard ? h('div', { className: 'ab-savebar' }, h('span', { className: 'msg' }, '有改动还没保存'),
        h('span', { className: 'ab-muted ab-small' }, h('span', { className: 'ab-kbd' }, 'Ctrl'), ' + ', h('span', { className: 'ab-kbd' }, 'S')),
        h(Btn, { kind: 'ghost', onClick: discardDraft }, '撤销'),
        h(Btn, { kind: 'primary', onClick: () => save() }, '保存设置')) : null,
    ),
    toastMsg ? h('div', { className: cx('ab-toast', toastMsg.kind), role: 'status' }, toastMsg.text) : null,
  )
}

export { AurabotPage }
