import { useState, useEffect, useRef, Fragment } from '../core/react.ts'
import { API, get, post } from '../core/api.ts'
import { setPath, timeAgo } from '../core/format.ts'
import { MEMORY_PAGE_SIZE, SOURCE, memoryCapacity, memoryEnded, resizeMemoryCapacity } from '../core/memory-model.ts'
import { ModOff, modOn } from '../core/nav.ts'
import { Btn, Card, Empty, Fold, Row, Select, cx, h, useField } from '../core/ui.ts'
import { AssocPreview, PersonaMemory, RecallLog } from './persona-graph.ts'
import { StarMap } from './starmap.ts'

function MemoryTab({ memoryView, setMemoryView, st, draft, setDraft, toast, go }) {
  // 归一化：老用户存的 entries/person 继续有效；没存过 / 异常值一律落默认「星图」
  const view = memoryView === 'entries' || memoryView === 'person' ? memoryView : 'starmap'
  const tab = (id, label) => h('button', {
    key: id, type: 'button', role: 'tab',
    'aria-selected': view === id,
    className: cx(view === id && 'on'),
    onClick: () => setMemoryView(id),
  }, label)
  const seg = h('div', { className: 'ab-seg', role: 'tablist', 'aria-label': '记忆子视图' },
    tab('starmap', '星图'), tab('entries', '记忆条目'), tab('person', '人物'))
  return h('div', null,
    h('div', { className: 'ab-flex', style: { margin: '0 0 12px' } }, seg),
    view === 'person'
      ? h(PersonaMemory, { toast })
      : view === 'entries'
        ? h(MemoryPage, { st, draft, setDraft, toast, go })
        : h(StarMap, { toast }))
}

function MemoryPage({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [mem, setMem] = useState(null)
  const [stats, setStats] = useState(null)
  const [q, setQ] = useState('')
  const [capacityInput, setCapacityInput] = useState(null)
  const capacityBeforeEdit = useRef(null)
  const capacity = memoryCapacity(draft.memory.capacity)
  const capacityTotal = Object.values(capacity).reduce((sum, n) => sum + n, 0)
  const [adding, setAdding] = useState({ text: '', aboutName: '', importance: 0.6 })
  // 分页：首屏只取一页，点「加载更多」再按 offset 增量加载。
  const [memMore, setMemMore] = useState(false)
  const [memTotal, setMemTotal] = useState(0)
  // 已加载条数单独记：不能拿 mem.length 当 offset——
  // 删掉一条之后列表会变短，offset 就对不上，会重复取回已经看过的条目。
  const [memLoaded, setMemLoaded] = useState(0)
  const load = (query?) => get('/memories?q=' + encodeURIComponent(query ?? q) + '&limit=' + MEMORY_PAGE_SIZE + '&offset=0').then((r) => {
    const items = r.items || []
    setMem(items); setStats(r.stats || null); setMemMore(!!r.hasMore)
    setMemTotal(r.total ?? items.length); setMemLoaded(items.length)
  })
  const loadMore = async () => {
    const r = await get('/memories?q=' + encodeURIComponent(q) + '&limit=' + MEMORY_PAGE_SIZE + '&offset=' + memLoaded)
    if (!r || r.ok === false) return
    const items = r.items || []
    setMem((cur) => [...(cur || []), ...items])
    setMemLoaded((n) => n + items.length)
    setMemMore(!!r.hasMore); setMemTotal(r.total ?? memTotal)
  }
  const [styles, setStyles] = useState({})
  const loadIns = () => get('/insights').then((r) => setStyles(r.styles || {}))
  const times = draft.memory.consolidateTimes || []
  const setTime = (i, v) => { const t = times.slice(); t[i] = v; setDraft(setPath(draft, 'memory.consolidateTimes', t)) }
  const memOn = modOn(st, 'memory')
  useEffect(() => { if (memOn) { load(''); loadIns() } }, [memOn])
  useEffect(() => { if (!memOn) return; const t = setTimeout(() => load(q), 250); return () => clearTimeout(t) }, [q])
  const last = st.memory && st.memory.lastConsolidate
  if (!memOn) return h(ModOff, { name: '记忆' })
  const chatlogRow = h(Row, { label: '聊天流水留多久', hint: '默认留 7 天，刚说过的话靠它想起来；0 = 整理完就删；-1 = 永久保留；其他数字 = 留这么多天。留得越久，本机存的聊天原文越多' }, f.num('memory.keepChatlogDays', { min: -1, max: 3650 }))
  const mergeRow = h(Row, { label: '整理时合并重复记忆', hint: '同一个人名下说的是一件事的条目并成一条。每个人多一次模型调用，默认关' }, f.sw('memory.mergeGroups'))
  // 「更多设置（N 项）」折叠子卡：与聊天页同口径——可见区只放少数高频组行，其余全收进来
  const more = (title, items) => (items.length ? h(Card, { title: (title || '更多设置') + '（' + items.length + ' 项）', collapsible: true, defaultOpen: false, className: 'ab-fold-sub' }, items) : null)
  return h('div', { className: 'ab-grid' },
    // ===== 可见组行 ① 记忆开关与整理（4 项，行内自由排版）=====
    h(Card, { title: '记忆开关与整理', right: f.sw('memory.enabled'),
      desc: '长期记忆：ta聊天时自己记的、每天从聊天里整理出来的、写过的空间日记、你手动加的。每一轮回复前，ta会按对方正在说的话翻出最相关的几条。' },
      st.persona && !st.persona.claimPending ? h('p', { className: 'ab-muted ab-small', style: { marginTop: 0 } }, '这里是「' + (((st.personas || []).find((p) => p.id === st.persona.current) || {}).name || st.persona.current) + '」的记忆。每个人格的记忆分开存，切换人格后这里显示新人格的。') : null,
      h('div', { className: 'ab-grid ab-g4', style: { marginBottom: 12 } },
        h('div', { className: 'ab-card ab-stat' }, h('div', { className: 'n' }, stats ? stats.count : '–'), h('div', { className: 'l' }, '条长期记忆')),
        h('div', { className: 'ab-card ab-stat' }, h('div', { className: 'n' }, stats ? stats.auto : '–'), h('div', { className: 'l' }, '条来自每日整理' + (stats && stats.outdated ? '（另有 ' + stats.outdated + ' 条已过时）' : ''))),
        h('div', { className: 'ab-card ab-stat' }, h('div', { className: 'n', style: { fontSize: 16, paddingTop: 6 } }, last ? new Date(last.at).toLocaleString() : '还没整理过'), h('div', { className: 'l' }, '上次整理'))),
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '每天自动整理两次', hint: '把临时记忆（聊天流水）提炼成长期记忆、相处经验和说话方式；第二次只处理新聊天，过了一天的流水整理完清空；各会话自己的上下文不受影响' },
          f.sw('memory.dailyConsolidate'), h('span', { className: 'ab-muted' }, '每天'),
          h('input', { className: 'ab-input sm', type: 'time', value: times[0] || '04:00', onChange: (e) => setTime(0, e.target.value) }),
          h('span', { className: 'ab-muted' }, '和'),
          h('input', { className: 'ab-input sm', type: 'time', value: times[1] || '16:00', onChange: (e) => setTime(1, e.target.value) }),
          h(Btn, { small: true, onClick: async () => { toast('正在整理，可能要一两分钟…'); const r = await post('/memory/extract', {}); toast(r.message); load(); loadIns() } }, '现在整理一次')),
        h(Row, { label: '自动记忆容量', hint: '默认 3000 条，可调高到 100000；聊天提炼、经历和日记按现有比例分配。手动记忆和分档事实不受此限制，过期与压缩规则照常生效。' },
          h('input', {
            className: 'ab-input sm', type: 'number', min: 3000, max: 100000, step: 1, 'aria-label': '自动记忆容量',
            value: capacityInput === null ? capacityTotal : capacityInput,
            onFocus: () => { capacityBeforeEdit.current = capacity },
            onChange: (e) => {
              const raw = e.target.value
              setCapacityInput(raw)
              const n = Number(raw)
              if (raw !== '' && Number.isInteger(n) && n >= 3000 && n <= 100000) {
                setDraft(setPath(draft, 'memory.capacity', resizeMemoryCapacity(capacityBeforeEdit.current || capacity, n)))
              }
            },
            onBlur: (e) => {
              const n = Number(e.target.value)
              if ((e.target.value === '' || !Number.isInteger(n) || n < 3000 || n > 100000) && capacityBeforeEdit.current) {
                setDraft(setPath(draft, 'memory.capacity', capacityBeforeEdit.current))
              }
              capacityBeforeEdit.current = null
              setCapacityInput(null)
            },
          }), h('span', { className: 'ab-muted' }, '条')),
        chatlogRow,
        mergeRow,
      )),

    // ===== 可见组行 ② 每轮想起多少（4 项核心参数，行内自由排版）=====
    h(Card, { title: '每轮想起多少',
      desc: '每轮回复前，ta 会按对方正在说的话翻出最相关的几条。这里是「想起多少」的调节。' },
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '每轮最多直接想起几条', hint: '「直接命中」的条数上限：按你说的关键词/意思直接对上的那几条。联想不占这个名额。' }, f.range('memory.recallCount', 0, 12, 1, (v) => v + ' 条')),
        h(Row, { label: '每轮最多带几条联想', hint: '「间接想起」的条数上限：从上面那几条往外联想出来的。和直接想起各自独立，最后合在一起交给她。' }, f.range('memory.assoc.recall', 0, 8, 1, (v) => v + ' 条')),
        h(Row, { label: '想起总数上限', hint: '直接 + 联想合起来的总条数；0 = 不额外限制（就等于「直接 N 条 + 联想 M 条」）。调小可以在上下文紧张时封顶。' },
          f.num('memory.recallTotal', { min: 0, max: 24 }), h('span', { className: 'ab-muted' }, '条')),
        h(Row, { label: '常驻记忆上限', hint: '每一轮都会带上的长期记忆最多多少字，超了从末尾截断。太小会显得忘事，太大会占上下文；默认 1200，范围 200~4000' }, f.num('memory.residentMaxChars', { min: 200, max: 4000 }), h('span', { className: 'ab-muted' }, '字')),
      ),
      h('div', { className: 'ab-note' }, '当前效果：每轮最多直接想起 ' + (draft.memory.recallCount ?? 6) + ' 条 + 联想 ' + (draft.memory.assoc?.recall ?? 3) + ' 条' + ((Number(draft.memory.recallTotal) || 0) > 0 ? '，总数封顶 ' + draft.memory.recallTotal + ' 条' : '（不额外限制总数') + '。'),
      more('更多设置', [
        h(Row, { key: 'pp', label: '私人记忆优先', hint: '想起相关记忆时，如果没在问 B站、视频、最近看了什么，优先带关于某个人 / 她自己记的；问具体视频时仍先想起视频' }, f.sw('memory.preferPersonal')),
        h(Row, { key: 'rm', label: '召回最低相关度', hint: '默认 0，沿用原有检索门槛；调高会更挑剔，可能减少想起的线索。人物加分不会把无关内容抬过线，上一句和关联补充也要过线。' }, f.range('memory.recallMinRelevance', 0, 1, 0.05, (v) => Number(v).toFixed(2))),
        h(Row, { key: 'md', label: '什么时候自动翻旧账' }, f.select('memory.recallMode', [{ value: 'always', label: '每轮都查' }, { value: 'trigger', label: '提到过去时才查' }])),
        h(Row, { key: 'tg', label: '翻旧账的触发词', hint: '一行一个，也可用逗号分隔；主动查记忆的工具不受影响' }, f.list('memory.recallTriggers')),
        h(Row, { key: 'st', label: '记得刚才聊到哪', hint: '同一个人在不同平台接着聊时，也能记得刚才聊到哪。每段聊天多一次很短的模型调用。' }, f.sw('memory.shortTerm')),
        h(Row, { key: 'sh', label: '记住最近多久的聊天' }, f.num('memory.shortTermHours', { min: 0.1, step: 0.1 }), h('span', { className: 'ab-muted' }, '小时')),
        h(Row, { key: 'si', label: '聊天停多久后整理' }, f.num('memory.shortTermIdleMinutes', { min: 0 }), h('span', { className: 'ab-muted' }, '分钟')),
        h(Row, { key: 'sc', label: '刚才的印象最多多少字' }, f.num('memory.shortTermChars', { min: 1 }), h('span', { className: 'ab-muted' }, '字')),
      ]),
    ),

    h(Fold, { title: '记忆联想与加深', icon: '🔗',
      summary: '联想 ' + (draft.memory.assoc?.hops ?? 2) + ' 跳 · 已建 ' + (stats && stats.assoc ? stats.assoc : '–') + ' 条关联' },
      h('div', { className: 'ab-note' }, '联想 = 按意思把相关的事连起来（「睡不好」能带出「熬夜」，再带出「考试焦虑」），靠本地向量建边，不花钱、不联网。A→B→C 就是「多跳」，下面能调跳数和总量上限，防止无限套娃。记忆加深 = 常被想起的事（含被联想带出来的）慢慢变重要、档位往上走。'),
      // 联想依赖本地向量模型：模型没就绪时联想是静默失效的，必须在这里说清楚，
      // 否则用户会以为「开关打开了、参数也调了，怎么一条联想都没有」。
      ...(stats && stats.vectorLocal?.wanted && !stats.vectorLocal.ready && draft.memory.assoc?.enabled !== false
        ? [h('div', { className: 'ab-note' }, '⚠️ 记忆联想现在还没生效：本地向量模型还没就绪（记忆本身仍能按关键词找）。模型第一次用到时会自动下载（约 23 MB），就绪后会自动开始建关联，不用再改设置。')]
        : []),
      ...(stats && stats.vectorLocal?.wanted && stats.vectorLocal.ready && stats.assoc === 0 && stats.count > 0 && draft.memory.assoc?.enabled !== false
        ? [h('div', { className: 'ab-note' }, '⏳ 还没有可用的关联：已经有 ' + stats.count + ' 条记忆，系统会在下一分钟自动建边。')]
        : []),
      // 可见组行 ③ 只放 3 个最常用的：联想开关、相似门槛、联想跳数；其余进折叠
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '记忆联想', hint: '已建 ' + (stats && stats.assoc ? stats.assoc : '–') + ' 条关联' + (stats && stats.assocAt ? '（' + new Date(stats.assocAt).toLocaleString() + ' 更新）' : '') }, f.sw('memory.assoc.enabled')),
        h(Row, { label: '多条相似才算关联', hint: '余弦相似度门槛，越高连得越少越准；默认 45%' }, f.range('memory.assoc.minSim', 0.3, 0.9, 0.05, (v) => Math.round(v * 100) + '%')),
        h(Row, { label: '联想跳数', hint: '0 关、1 = A→B、2 = A→B→C（默认）、3 最多。再高就是套娃，已封顶。条数上限在上面「每轮最多带几条联想」里调' },
          h('div', { className: 'ab-flex', style: { gap: 8 } }, ['0', '1', '2', '3'].map((v) => h('label', { key: v, className: 'ab-flex', style: { gap: 4, cursor: 'pointer', alignItems: 'center' } },
            h('input', { type: 'radio', name: 'memory.assoc.hops', checked: String(draft.memory.assoc?.hops ?? 2) === v, onChange: () => setDraft(setPath(draft, 'memory.assoc.hops', Number(v))) }),
            h('span', null, v === '0' ? '关' : v === '1' ? '1 跳' : v === '2' ? '2 跳' : '3 跳'))))),
      ),
      more('更多设置', [
        h(Row, { key: 'al', label: '每条最多连几个', hint: '度上限，防止一条记忆连到半个库' }, f.num('memory.assoc.limit', { min: 1, max: 8 }), h('span', { className: 'ab-muted' }, '条')),
        h(Row, { key: 'hd', label: '每多跳一次打几折', hint: '跳得越远越不可信，分数乘以这个系数；默认 55%' }, f.range('memory.assoc.hopDecay', 0.1, 1, 0.05, (v) => Math.round(v * 100) + '%')),
        h(Row, { key: 'tg', label: '记忆加深（行为驱动升档）', hint: '被想起来的次数和天数够了，重要程度慢慢涨、档位往上走' }, f.sw('memory.tierGrow.enabled')),
        h(Row, { key: 'ah', label: '联想带出的记忆也算想起', hint: '几次联想折算成「想起来一天」。2 = 联想两次算一次想起（比直接命中轻）；1 = 一样重' }, f.num('memory.tierGrow.assocPerHitDay', { min: 1, max: 20 }), h('span', { className: 'ab-muted' }, '次/天')),
        h(Row, { key: 'pd', label: '被反复想起后每天涨多少', hint: '默认 0.02/天；要到下面「最少想起几天」才会计入' }, f.num('memory.tierGrow.perDay', { min: 0, max: 0.2, step: 0.01 })),
        h(Row, { key: 'mh', label: '最少想起几天才开始算', hint: '默认 3 天；偶然想起一两次不该把她记的事推到重要档' }, f.num('memory.tierGrow.minHitDays', { min: 0, max: 60 }), h('span', { className: 'ab-muted' }, '天')),
        h(Row, { key: 'cp', label: '重要程度上限', hint: '自动加深的天花板，留一点空间给模型标过的重要记忆；默认 0.85' }, f.range('memory.tierGrow.cap', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
        h(Row, { key: 't2', label: '升到「一般」要想起几天、多重要', hint: '默认 5 天且 ≥ 60%' },
          f.num('memory.tierGrow.tier2.hitDays', { min: 0, max: 365 }), h('span', { className: 'ab-muted' }, '天 /'),
          f.range('memory.tierGrow.tier2.imp', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
        h(Row, { key: 't3', label: '升到「重要」要想起几天、多重要', hint: '默认 10 天且 ≥ 75%' },
          f.num('memory.tierGrow.tier3.hitDays', { min: 0, max: 365 }), h('span', { className: 'ab-muted' }, '天 /'),
          f.range('memory.tierGrow.tier3.imp', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
        h(AssocPreview, { key: 'ap', toast }),
      ]),
    ),

    // 低频调优参数统一收进「更多设置」折叠卡（defaultOpen=false：默认不展开，展开区才挂载控件）
    // 内部仍按 Fold 分组（向量检索 / 重排 / 分层遗忘），保留各组的运行成本与依赖提示文案
    more('高级调优', [
    h(Fold, { key: 'vec', title: '向量检索（实验性）', icon: '🧭',
      summary: stats ? '已同步 ' + (stats.vector || 0) + ' / ' + (stats.count || 0) + ' 条' : '' },
      h('div', { className: 'ab-note' }, '默认关闭。打开后可以按意思找记忆：推荐用自带的本地小模型（纯离线、不联网、不花钱）；也可以改成自己的在线服务，那时会把记忆文字和查询文字发给你填的地址。'),
      stats?.vectorLastError && stats.vectorLastErrorAt != null
        ? h('div', { className: 'ab-note' }, '最近失败（' + new Date(stats.vectorLastErrorAt).toLocaleString() + '）：' + stats.vectorLastError)
        : null,
      h(Row, { label: '向量检索（实验性）', hint: '补充按意思找记忆；已同步 ' + (stats ? stats.vector || 0 : '–') + ' 条（可刷新页面查看）' }, f.sw('memory.vector.enabled')),
      h(Row, { label: '检索方式', hint: '本地模型不用联网；在线服务需要自己准备兼容 OpenAI 的接口' },
        h('div', { className: 'ab-flex', style: { gap: 8 } },
          ['local', 'remote'].map((v) => h('label', {
            key: v,
            className: 'ab-flex',
            style: { gap: 4, cursor: 'pointer', alignItems: 'center' },
          },
            h('input', {
              type: 'radio',
              name: 'memory.vector.mode',
              checked: (draft.memory.vector?.mode === 'remote' ? 'remote' : 'local') === v,
              onChange: () => setDraft(setPath(draft, 'memory.vector.mode', v)),
            }),
            h('span', null, v === 'local' ? '本地模型（离线，推荐）' : '在线服务（自己配'))))),
      ...((draft.memory.vector?.mode === 'remote')
        ? [
            h(Row, { label: '服务预设', hint: '只是帮你填地址和模型，填完还能改' },
              f.select('memory.vector.provider', [
                { value: 'siliconflow', label: '硅基流动' },
                { value: 'ark', label: '火山方舟（豆包）' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'ollama', label: '本地 Ollama' },
                { value: 'custom', label: '其他兼容服务' },
              ], { width: 220 }),
              h(Btn, {
                small: true, kind: 'ghost',
                onClick: () => {
                  const p = draft.memory.vector?.provider || 'siliconflow'
                  const preset = {
                    siliconflow: ['https://api.siliconflow.cn/v1', 'BAAI/bge-m3'],
                    ark: ['https://ark.cn-beijing.volces.com/api/v3', 'doubao-embedding-large-text-250515'],
                    openai: ['https://api.openai.com/v1', 'text-embedding-3-small'],
                    ollama: ['http://127.0.0.1:11434/v1', 'bge-m3'],
                  }[p]
                  if (!preset) return toast('自定义服务请自己填地址和模型')
                  let next = setPath(draft, 'memory.vector.baseUrl', preset[0])
                  next = setPath(next, 'memory.vector.model', preset[1])
                  setDraft(next)
                },
              }, '填入推荐值')),
            h(Row, { label: '服务地址', hint: 'OpenAI 兼容接口根地址，一般以 /v1 结尾；方舟是 /api/v3' }, f.text('memory.vector.baseUrl', { size: 'wide', placeholder: 'https://api.siliconflow.cn/v1' })),
            h(Row, { label: '模型', hint: '硅基 BAAI/bge-m3；方舟填控制台开通的 doubao-embedding-*' }, f.text('memory.vector.model', { size: 'wide', placeholder: 'BAAI/bge-m3' })),
            h(Row, { label: 'API Key', hint: '只存在本机，面板不回显；本地服务可留空' }, f.text('memory.vector.apiKey', { type: 'password', placeholder: draft.memory.vector?.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
            h(Row, { label: '自定义请求头', hint: '一行一个「Key: Value」；给 OneAPI/NewAPI 之类加额外头。填了 Authorization 就不再自动加 Bearer' },
              f.area('memory.vector.headers', { size: 'wide', rows: 2, placeholder: 'X-Api-Key: ...' })),
            h(Row, { label: '向量维度', hint: '0 = 不传；Qwen3 / OpenAI 的 MRL 模型可以截断，改完建议重建索引' }, f.num('memory.vector.dimensions', { min: 0, max: 8192 })),
            h(Row, { label: '每批多少条', hint: '方舟等单次 input 上限小，默认 10；本地服务可以调大' }, f.num('memory.vector.batchSize', { min: 1, max: 64 })),
            h(Row, { label: '查询超时', hint: '超过就这一轮先用关键词，不拖慢回复' }, f.num('memory.vector.queryTimeoutMs', { min: 500, max: 15000, step: 500 })),
            h('div', { className: 'ab-flex', style: { marginTop: 6 } },
              h(Btn, { small: true, onClick: async () => { const r = await post('/memory/vector/test', { text: '今天想吃白米饭' }); toast(r.ok ? `向量正常：${r.dims} 维，用时 ${r.ms}ms` : r.message); await load(q) } }, '测试'),
              h(Btn, { small: true, kind: 'ghost', onClick: async () => { toast('正在按已保存的设置重建，条数多会分批…'); const r = await post('/memory/vector/rebuild', {}); toast(r.message); setTimeout(() => load(q), 1500) } }, '重建索引')),
            h('div', { className: 'ab-muted ab-small' }, '「测试」用已保存的设置；改完先点底部保存，再测试/重建。'),
          ]
        : [
            h('div', { className: 'ab-note' }, '本地模型：bge-small-zh-v1.5（512 维），第一次使用时自动下载（约 23 MB，存到插件数据目录的 models 文件夹）。没装向量运行时会自动退回关键词检索，不影响其他功能。'),
            ...((stats && stats.vectorModel && stats.vectorModel.running)
              ? [h('div', { className: 'ab-note' }, '⏳ 正在下载本地模型：' + (stats.vectorModel.file || '准备中') + '（' + Math.round((stats.vectorModel.bytes || 0) / 1048576) + ' MB）。下完会自动开始建索引，期间先按关键词找记忆。')]
              : []),
            ...((stats && stats.vectorModel && stats.vectorModel.error && !stats.vectorReady)
              ? [h('div', { className: 'ab-note' }, '⚠️ ' + stats.vectorModel.error + '。现在会按关键词找记忆，装好模型后会自动开始索引；也可以自己把 model_int8.onnx / vocab.txt 放进数据目录的 models 文件夹。')]
              : []),
            // 模型「还没有」且不正在下载、也没有报错 —— 这时联想是静默失效的，
            // 以前面板一句话都不说，用户只会觉得「联想怎么没反应」。
            // 这正是从 Release 安装、assets 缺失时的真实状态。
            ...((stats && stats.vectorLocal?.wanted && !stats.vectorLocal.ready && !(stats.vectorModel && stats.vectorModel.running) && !(stats.vectorModel && stats.vectorModel.error) && draft.memory.vector?.enabled)
              ? [h('div', { className: 'ab-note' }, '⏳ 本地模型还没下载好：记忆能用（按关键词找），但「记忆联想」要等模型就绪才会生效。第一次用到时会自动下载（约 23 MB），下一分钟开始。')]
              : []),
            ...((draft.memory.vector?.enabled && stats && (stats.vector || 0) === 0 && (stats.count || 0) > 0 && stats.vectorReady)
              ? [h('div', { className: 'ab-note' }, '⏳ 等待开始建索引：' + (stats.count || 0) + ' 条记忆还没同步，下一分钟会自动开始。')]
              : []),
            ...((draft.memory.vector?.enabled && (stats ? (stats.vector || 0) < (stats.count || 0) && (stats.vector || 0) > 0 : false))
              ? [h('div', { className: 'ab-note' }, '⏳ 正在后台建立索引：' + (stats.vector || 0) + ' / ' + (stats.count || 0) + ' 条。分批进行，不影响聊天；索引没建完时先按关键词找记忆。')]
              : []),
            h('div', { className: 'ab-note' }, '空间占用约每万条记忆 26 MB；换模型后需要重新索引。'),
          ]),
    ),

    h(Fold, { title: '重排候选（Reranker，可选）', icon: '🎯' },
      h('div', { className: 'ab-note' }, '语义检索会多取一些候选，再由重排模型按「查询 + 记忆」逐条打分，取最相关的几条进提示词。默认关；地址/Key 留空会复用 embedding 服务。超时或失败自动保留原顺序，不影响回复。'),
      h(Row, { label: '启用重排', hint: '只在已经通过群聊/人物权限过滤的候选上跑' }, f.sw('memory.rerank.enabled')),
      h(Row, { label: '服务地址', hint: '留空复用 embedding 的地址' }, f.text('memory.rerank.baseUrl', { size: 'wide', placeholder: 'https://api.siliconflow.cn/v1' })),
      h(Row, { label: '重排模型' }, f.text('memory.rerank.model', { size: 'wide', placeholder: 'BAAI/bge-reranker-v2-m3' })),
      h(Row, { label: 'API Key', hint: '留空复用 embedding 的 Key' }, f.text('memory.rerank.apiKey', { type: 'password', placeholder: '没有就留空' })),
      h(Row, { label: '取前多少条候选重排' }, f.num('memory.rerank.topN', { min: 2, max: 50 }), h('span', { className: 'ab-muted' }, '条')),
      h(Row, { label: '超时多少毫秒放弃' }, f.num('memory.rerank.timeoutMs', { min: 500, max: 10000 }), h('span', { className: 'ab-muted' }, 'ms')),
      h('div', { className: 'ab-flex', style: { marginTop: 6 } },
        h(Btn, { small: true, onClick: async () => {
          const r = await post('/memory/rerank/test', { text: '主人喜欢吃什么' })
          if (r.moduleOff) toast('重排接口还没生效：把 DSH 完全退出再打开，不是刷新页面')
          else toast(r.ok ? `重排正常：${r.model}，最高分 ${Number(r.score).toFixed(3)}` : r.message)
        } }, '测试重排')),
      h('div', { className: 'ab-muted ab-small' }, '重排只处理已经通过群聊/人物权限过滤的候选，不会看到不该带出的记忆。'),
    ),

    // 人物与群印象：低频画像开关与字数上限，收进折叠（保留 7 项）
    more('人物与群印象', [
      h(Row, { key: 'oa', label: '只记住有交集的人', hint: '只给私聊过、在群里 @ 她、回复她或被她回复过的人，以及 QQ 好友和白名单朋友建立人物记忆。路过群友不占位置，群里的公共事情照常记；已有画像保留。' }, f.sw('memory.profileOnlyAcquainted')),
      h(Row, { key: 'ds', label: '讨厌的人说话时不接的几率', hint: '消息仍会看到和记住；0% 表示照常回复，主人和一起说话的其他人不受影响' }, f.range('memory.dislikeSilence', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      h(Row, { key: 'fc', label: '每项人物印象最多多少字' }, f.num('memory.profileFieldChars', { min: 0 })),
      h(Row, { key: 'pp', label: '群里最多带几个人的画像' }, f.num('memory.profilePeople', { min: 0 })),
      h(Row, { key: 'pc', label: '人物画像总字数上限' }, f.num('memory.profileChars', { min: 0 })),
      h(Row, { key: 'ci', label: '记住群印象', hint: '只在对应的群里带上' }, f.sw('memory.chatImpression')),
      h(Row, { key: 'cc', label: '群印象字数上限' }, f.num('memory.chatImpressionChars', { min: 0 })),
    ]),

    h(Fold, { title: '分层记忆与遗忘', icon: '📚' },
      h(Row, { label: '压缩旧聊天和记忆', hint: '原话到期前先压成梗概；失败或预算不足时保留原文' }, f.sw('memory.gistEnabled')),
      h(Row, { label: '梗概过多少天变成印象' }, f.num('memory.gistDays', { min: 0 })),
      h(Row, { label: '印象保留多少天' }, f.num('memory.impressionDays', { min: 0 })),
      h(Row, { label: '每天最多压缩多少批', hint: '压缩同时占用下面的每日整理批次' }, f.num('memory.gistDailyBatches', { min: 0 })),
      h(Row, { label: '每天整理和压缩共用批次' }, f.num('memory.extractDailyBatches', { min: 0 })),
      // 档位天数：用后端 factTiers 动态生成（beta 侧把档位表改成后端下发，
      // 硬编码 3 个会让新增的档位没法配天数）
      ...(stats?.factTiers || []).filter((t) => t.days !== null).map((t) => h(Row, { key: t.id, label: t.label + '事实保留多少天' },
        f.num('memory.tierDays.' + t.id, { min: 0 })),
      ),
      h(Row, {
        label: '忘得多快',
        hint: '默认 20 天。数值越小忘得越快、越像真人：8 左右时一天后剩七成、一个月后基本淡忘；20 时普通记忆约两个月才淡掉。重要度 0.6 以上的和永久档不受影响。',
      }, f.num('memory.retentionBase', { min: 1, max: 365 }), h('span', { className: 'ab-muted' }, '天')),
      h(Row, { label: '把细节浓缩成长期印象', hint: '具体的事慢慢淡忘，留下更概括的关系和感受（比如「主人很疼她，总惦记她爱吃的东西」）。这些印象不会被自动整理改掉，也不会过期；手动加的和你自己总结的不会被压缩。每次整理最多多两次模型调用，默认开。' }, f.sw('memory.compress')),
      h(Row, { label: '多久以前的事开始浓缩', hint: '这些天以前的琐碎记忆才会被概括；最近的事先留着具体细节。默认 14 天' }, f.num('memory.compressAfterDays', { min: 1, max: 365 }), h('span', { className: 'ab-muted' }, '天')),
      h(Row, { label: '私聊时想起别处的话', hint: '和你私聊时，带上她最近 24 小时在别的聊天里说过的话，每轮多占约 300 字。只进你的私聊，别处一律不带。默认关。' }, f.sw('memory.crossContext')),
    ),
    ]),

    h(Fold, { title: '手动加一条', icon: '✍️', summary: '你想让她一定记住的事' },
      h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap' } },
        h('input', { className: 'ab-input', style: { flex: '2 1 260px' }, placeholder: '要ta记住的事，例如：主人不吃香菜', value: adding.text, onChange: (e) => setAdding({ ...adding, text: e.target.value }) }),
        h('input', { className: 'ab-input', style: { flex: '1 1 120px' }, placeholder: '关于谁（可选）', value: adding.aboutName, onChange: (e) => setAdding({ ...adding, aboutName: e.target.value }) }),
        h(Select, { value: adding.importance, width: 120, onChange: (v) => setAdding({ ...adding, importance: v }), options: [{ value: 0.3, label: '随口一提' }, { value: 0.6, label: '比较重要' }, { value: 0.9, label: '非常重要' }] }),
        h(Btn, { small: true, kind: 'primary', disabled: !adding.text.trim(), onClick: async () => { const r = await post('/memory/add', adding); toast(r.ok ? '记住了' : r.message); setAdding({ text: '', aboutName: '', importance: 0.6 }); load() } }, '记住'))),

    h(Fold, { title: '翻一翻', icon: '🔍', summary: mem === null ? '加载中…' : (q ? '搜「' + q + '」· ' + mem.length + ' 条' : '共 ' + memTotal + ' 条' + (memMore ? '（已显示 ' + mem.length + '）' : '')) },
      h('input', { className: 'ab-input wide', placeholder: '搜索记忆，例如：白米饭、游戏、约定…', value: q, onChange: (e) => setQ(e.target.value) }),
      mem === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : mem.length === 0 ? h(Empty, { icon: '🫧', text: q ? '没找到相关的记忆' : '还没有记住什么。' }) :
        h('div', null,
          h('div', { className: 'ab-list', style: { marginTop: 8 } }, mem.map((m) => h(MemoryRow, { key: m.id, m, onChanged: () => load(), toast }))),
          // 库大了以后一次只给 300 条，剩下的靠这个按钮接着加载，
          // 否则后面的记忆在面板里完全看不到（搜索也搜不出来）。
          memMore ? h('div', { className: 'ab-flex', style: { marginTop: 10, justifyContent: 'center' } },
            h(Btn, { small: true, onClick: loadMore }, '加载更多（已显示 ' + mem.length + ' / ' + memTotal + '）')) : null)),
    h(RecallLog, null),
    h(MemoryImport, { toast, onDone: () => load() }),
    h(MemoryInherit, { st, toast, onDone: () => load() }),
  )
}

function MemoryImport({ toast, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [cands, setCands] = useState(null)
  const [pick, setPick] = useState({})
  const readFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.txt,.md,.markdown,.json'
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => setText(String(fr.result || '').slice(0, 30000)); fr.readAsText(f) }
    inp.click()
  }
  const scan = async () => {
    setBusy(true); setCands(null)
    const r = await post('/memory/import', { text })
    setBusy(false)
    if (!r.ok) return toast(r.message, 'err')
    setCands(r.list); setPick(Object.fromEntries(r.list.map((_, i) => [i, true])))
  }
  const commit = async () => {
    const items = cands.filter((_, i) => pick[i])
    const r = await post('/memory/import/commit', { items })
    toast(r.message, 'ok'); setCands(null); setText(''); onDone()
  }
  return h(Card, { title: '导入旧档案', desc: '以前写过的设定、聊天笔记、别的机器人的记忆文件（txt / md），贴进来或者上传。ta会挑出值得记的，你勾选以后再存进记忆库；和已有记忆重复的会自动去掉。' },
    h('textarea', { className: 'ab-textarea', style: { minHeight: 110 }, placeholder: '把旧档案的文字粘贴到这里（最多 3 万字）', value: text, onChange: (e) => setText(e.target.value) }),
    h('div', { className: 'ab-flex', style: { marginTop: 8 } },
      h(Btn, { small: true, onClick: readFile }, '选择文件'),
      h(Btn, { small: true, kind: 'primary', disabled: busy || !text.trim(), onClick: scan }, busy ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在挑…') : '挑出值得记的'),
      h('span', { className: 'ab-muted ab-small' }, text ? text.length + ' 字' : '')),
    cands ? (cands.length === 0 ? h('div', { className: 'ab-muted', style: { marginTop: 10 } }, '没挑出新的可记的东西（或者都已经记过了）。') :
      h('div', { style: { marginTop: 10 } },
        h('div', { className: 'ab-list' }, cands.map((c, i) => h('label', { key: i, className: 'ab-li', style: { cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: !!pick[i], onChange: (e) => setPick({ ...pick, [i]: e.target.checked }), style: { accentColor: 'var(--ab-sea)', marginTop: 3 } }),
          h('div', { className: 'body' }, c.aboutName ? h('b', null, '[' + c.aboutName + '] ') : null, c.text, c.importance >= 0.8 ? ' ★' : '')))),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          h(Btn, { small: true, kind: 'primary', onClick: commit, disabled: !Object.values(pick).some(Boolean) }, '存进记忆库（' + Object.values(pick).filter(Boolean).length + ' 条）'),
          h(Btn, { small: true, kind: 'ghost', onClick: () => setCands(null) }, '取消')))) : null)
}

// 从另一个人格继承记忆：先看要整理多少、确认会花 token，再一批批交给模型改人称（进度按批走，失败只重试那一批）；
// 预览勾选后存进当前人格。样式照「导入旧档案」，进度条照表情包「AI 起名中」。
const INHERIT_OPS = { keep: '原样', rewrite: '改写', drop: '丢掉', missing: '模型没处理' }

function MemoryInherit({ st, toast, onDone }) {
  const current = st.persona?.current || st.config?.persona?.current
  const others = (st.personas || []).filter((p) => p.id !== current)
  const [from, setFrom] = useState(others[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(null) // 整理中：{ plan, index, acc, token, label, error }
  const [preview, setPreview] = useState(null) // 预览：{ plan, list: [{ id, label, note, text, op, next, reason, pick }] }
  if (!others.length || st.persona?.claimPending) return null
  const run = async (plan, start, acc, token) => {
    for (let i = start; i < plan.batches.length; i++) {
      const b = plan.batches[i]
      const label = b.label + (b.parts > 1 ? ' ' + b.part + '/' + b.parts : '')
      setJob({ plan, index: i, acc, token, label })
      const r = await post('/memory/inherit/batch', { from: plan.from, to: plan.to, index: i })
      if (token.stop) return
      if (!r.ok) return setJob({ plan, index: i, acc, token, label, error: r.message })
      acc = [...acc, ...r.results.map((x) => ({ ...x, label: b.label, pick: x.op === 'keep' || x.op === 'rewrite' }))]
    }
    setJob(null)
    setPreview({ plan, list: acc })
  }
  const start = async () => {
    setBusy(true)
    const plan = await post('/memory/inherit/plan', { from })
    setBusy(false)
    if (!plan.ok) return toast(plan.message, 'err')
    const cost = plan.calls ? '要调用模型 ' + plan.calls + ' 次，粗估约 ' + Math.max(1, Math.round(plan.tokens / 1000)) + 'k tokens。' : '这次不用调用模型。'
    if (!confirm('把「' + plan.fromName + '」的 ' + plan.records + ' 条记忆导入给「' + plan.toName + '」？\n人称要改成「' + plan.toName + '」自己，会调用模型逐条整理，会消耗 token：' + cost + '\n「' + plan.fromName + '」最近一次整理之后的聊天还没变成记忆，不会被继承。')) return
    setPreview(null)
    return run(plan, 0, [], { stop: false })
  }
  const set = (i, patch) => setPreview({ ...preview, list: preview.list.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const picked = preview ? preview.list.filter((x) => x.pick && String(x.next || '').trim()).length : 0
  const commit = async () => {
    const items = preview.list.filter((x) => x.pick && String(x.next || '').trim()).map((x) => ({ id: x.id, text: x.next }))
    const r = await post('/memory/inherit/commit', { from: preview.plan.from, to: preview.plan.to, items })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { setPreview(null); onDone() }
  }
  return h(Card, { title: '从其他人格导入', desc: '把另一个人格的记忆继承过来，当成现在这个人格自己的经历、关系和约定。模型会逐条把指代旧人格的说法改成现在这个人格自己，丢掉旧人格自己的设定（名字、口癖这些）；你勾选以后再存进记忆库。旧人格的记忆不会被改动。' },
    h('div', { className: 'ab-flex' },
      h('select', { className: 'ab-select', 'aria-label': '从哪个人格导入', value: from, disabled: !!job, onChange: (e) => setFrom(e.target.value) },
        others.map((p) => h('option', { key: p.id, value: p.id }, p.name))),
      h(Btn, { small: true, kind: 'primary', disabled: busy || !!job || !from, onClick: start }, busy ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在计算…') : '从这个人格导入')),
    job ? h('div', { style: { marginTop: 10 } },
      h('div', { className: 'ab-small' }, job.error ? job.label + '：' + job.error : '整理中 ' + job.label + '（' + (job.index + 1) + ' / ' + job.plan.batches.length + '）'),
      job.error ? null : h('div', { className: 'ab-progress' }, h('i', { style: { width: Math.round((job.index / job.plan.batches.length) * 100) + '%' } })),
      h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        job.error ? h(Btn, { small: true, kind: 'primary', onClick: () => run(job.plan, job.index, job.acc, job.token) }, '重试这一批') : null,
        h(Btn, { small: true, kind: 'ghost', onClick: () => { job.token.stop = true; setJob(null) } }, '取消'))) : null,
    preview ? h('div', { style: { marginTop: 10 } },
      [...new Set(preview.list.map((x) => x.label))].map((label) => h('div', { key: label, style: { marginTop: 8 } },
        h('div', { className: 'ab-small', style: { color: 'var(--ab-sub)', marginBottom: 4 } }, label),
        h('div', { className: 'ab-list' }, preview.list.map((x, i) => (x.label !== label ? null : h('div', { key: x.id, className: 'ab-li' },
          h('input', { type: 'checkbox', checked: !!x.pick, 'aria-label': '存这一条', onChange: (e) => set(i, { pick: e.target.checked }), style: { accentColor: 'var(--ab-sea)', marginTop: 3 } }),
          h('div', { className: 'body' },
            h('input', { className: 'ab-input', value: x.next, 'aria-label': '存进去的文字', onChange: (e) => set(i, { next: e.target.value }) }),
            h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, (x.note ? x.note + '｜' : '') + INHERIT_OPS[x.op] + (x.next !== x.text ? '｜原文：' + x.text : '') + (x.reason ? '｜' + x.reason : ''))))))))),
      h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        h(Btn, { small: true, kind: 'primary', onClick: commit, disabled: !picked }, '存进记忆库（' + picked + ' 条）'),
        h(Btn, { small: true, kind: 'ghost', onClick: () => setPreview(null) }, '取消'))) : null)
}

function MemoryRow({ m, onChanged, onDeleted, onEdited, onRestored, toast }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(m.text)
  // 删除后只从当前列表移除，不重拉第一页（保持分页位置）
  const remove = async () => {
    const r = await post('/memory/delete', { id: m.id })
    if (!r.ok) return
    if (onDeleted) onDeleted(m.id)
    else onChanged()
  }
  const save = async () => {
    const r = await post('/memory/update', { id: m.id, text })
    if (!r.ok) { toast(r.message || '没改成', 'err'); return }
    setEdit(false)
    toast('改好了', 'ok')
    if (onEdited) onEdited(m.id, text)
    else onChanged()
  }
  const restore = async () => {
    const r = await post('/memory/restore', { id: m.id })
    toast(r.ok ? '恢复了' : r.message, r.ok ? 'ok' : 'err')
    if (!r.ok) return
    if (onRestored) onRestored(m.id)
    else onChanged()
  }
  if (memoryEnded(m)) {
    return h('div', { className: 'ab-li', style: { opacity: 0.6 } },
      h('div', { className: 'meta' }, m.validityText || timeAgo(m.invalidAt || m.validUntil), h('br'), h('span', { className: 'ab-pill', style: { padding: '0 6px', fontSize: 11 } }, '已过时')),
      h('div', { className: 'body' }, h('s', null, (m.aboutName ? '[' + m.aboutName + '] ' : '') + m.text), m.supersededText ? h('div', { className: 'ab-muted ab-small' }, '→ 现在是：' + m.supersededText) : null),
      h(Btn, { small: true, kind: 'ghost', onClick: restore }, '恢复'),
      h(Btn, { small: true, kind: 'ghost', onClick: remove }, '删掉'))
  }
  return h('div', { className: 'ab-li' },
    h('div', { className: 'meta' }, timeAgo(m.at), h('br'), h('span', { className: 'ab-pill', style: { padding: '0 6px', fontSize: 11 } }, SOURCE[m.source] || '记忆')),
    edit ? h('input', { className: 'ab-input wide', value: text, onChange: (e) => setText(e.target.value), onKeyDown: async (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(false) } })
      : h('div', { className: 'body' }, m.aboutName ? h('b', null, '[' + m.aboutName + '] ') : null, m.displayText || m.text, m.validityText ? h('div', { className: 'ab-muted ab-small' }, m.validityText) : null, m.importance >= 0.8 ? h('span', { title: '很重要' }, ' ★') : null),
    h(Btn, { small: true, kind: 'ghost', onClick: () => setEdit(!edit) }, edit ? '取消' : '改'),
    h(Btn, { small: true, kind: 'ghost', onClick: remove }, '忘掉'))
}

/** 导入音色：把 .zip / .pth / .index 拖进来或点选，自动识别；下面列出已有的音色，可以删。 */

function VoiceImport({ s, toast, onChange }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState('')
  const upload = async (files) => {
    for (const file of [...files]) {
      if (!/\.(zip|pth|index|ckpt)$/i.test(file.name)) { toast('「' + file.name + '」不是 .zip / .pth / .index / .ckpt', 'err'); continue }
      setBusy('正在导入「' + file.name + '」（' + Math.round(file.size / 1024 / 1024) + 'MB）…')
      const r = await fetch(API + '/song/import?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
        .then((x) => x.json()).catch((e) => ({ ok: false, message: '上传失败：' + e.message }))
      toast(r.message, r.ok ? 'ok' : 'err')
    }
    setBusy('')
    onChange()
  }
  const pick = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.multiple = true
    inp.accept = '.zip,.pth,.index,.ckpt'
    inp.onchange = () => inp.files && upload(inp.files)
    inp.click()
  }
  return h(Card, { title: '音色模型', desc: '插件不自带音色。把你有权使用的 RVC 模型导进来：.pth（可以带 .index），或者装着它们的 zip。只存在本机。自己训练的是 so-vits-svc 之类别的模型、或者想用自己的推理参数？去「本地接口」页接「翻唱换声」。' },
    h('div', {
      className: 'ab-drop' + (over ? ' over' : ''), role: 'button', tabIndex: 0,
      onClick: pick, onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && pick(),
      onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false),
      onDrop: (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) },
    }, busy ? h('span', null, h('i', { className: 'ab-spin' }), ' ' + busy) : h('span', null, '把 .zip / .pth / .index 拖到这里，或者点击选择文件')),
    // 分离模型自动下载不动时：给几个地址，用浏览器或下载工具下好，拖进上面这个框
    s.parts && !s.parts.separatorModel && (s.separatorLinks || []).length ? h('div', { className: 'ab-note', style: { marginTop: 10 } },
      h('b', null, '人声分离模型下不动？'), ' 安装时会自动试好几个源（断了能接着下，太慢会换源）。实在不行，用浏览器或下载工具下好下面任一个（约 640 MB，是同一个文件），拖进上面这个框就行，插件会核对文件对不对：',
      (s.separatorLinks || []).map((u) => h('div', { key: u, className: 'ab-flex', style: { marginTop: 4 } },
        h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, u),
        h(Btn, { small: true, kind: 'ghost', onClick: () => { navigator.clipboard.writeText(u); toast('复制了', 'ok') } }, '复制')))) : null,
    s.voices.length && !s.enabled ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, '音色导入好了，但翻唱开关还没开（这一页最上面），打开并保存后ta才会唱。') : null,
    s.voices.length === 0 ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '还没有音色。') :
      h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.voices.map((v) => h('div', { key: v.id, className: 'ab-li' },
        h('div', { className: 'body' }, h('b', null, v.id), v.hasIndex ? h('span', { className: 'ab-muted ab-small' }, ' · 带 index') : null),
        h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('删掉音色「' + v.id + '」？')) return; const r = await post('/song/voice/delete', { id: v.id }); toast(r.message, r.ok ? 'ok' : 'err'); onChange() } }, '删除')))))
}

export { MemoryTab, MemoryPage, MemoryImport, INHERIT_OPS, MemoryInherit, MemoryRow, VoiceImport }
