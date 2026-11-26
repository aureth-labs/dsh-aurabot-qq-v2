import { useState, useEffect } from '../../core/ui/react.ts'
import { get } from '../../core/api/api.ts'
import { setPath, timeAgo } from '../../core/ui/format.ts'
import { ModOff, modOn } from '../../core/nav.ts'
import { Btn, Card, Row, h, useField } from '../../core/ui/ui.ts'
import { StyleEditor } from '../memory/memory-parts.ts'

// 心情项默认十项（与 src/features/mood-emotions.js 的 DEFAULT_EMOTIONS 对齐）：
// 只在草稿里还没有这个键时用来画「出厂长什么样」，真正的默认值由后端 normalize 补。
const EMOTION_DEFAULTS = [
  { key: 'curious', label: '好奇', icon: '🤔', valence: 0.3, arousal: 0.6 },
  { key: 'excited', label: '兴奋', icon: '🤩', valence: 0.8, arousal: 0.9 },
  { key: 'lonely', label: '寂寞', icon: '😔', valence: -0.6, arousal: 0.3 },
  { key: 'envious', label: '羡慕', icon: '😒', valence: -0.4, arousal: 0.5 },
  { key: 'worried', label: '担心', icon: '😟', valence: -0.5, arousal: 0.6 },
  { key: 'proud', label: '得意', icon: '😌', valence: 0.6, arousal: 0.5 },
  { key: 'affectionate', label: '亲近', icon: '🥰', valence: 0.7, arousal: 0.4 },
  { key: 'bored', label: '无聊', icon: '😐', valence: -0.2, arousal: 0.2 },
  { key: 'amused', label: '好笑', icon: '😄', valence: 0.6, arousal: 0.7 },
  { key: 'content', label: '平静', icon: '😊', valence: 0.2, arousal: 0.3 },
]

// 心情项的键名规则与后端 EMOTION_KEY_RE 一致：小写字母开头，1~24 位
const EMOTION_KEY_RE = /^[a-z][a-z0-9_-]{0,23}$/

/**
 * 心情项编辑器：增删项、改名字/图标、调正负倾向与强弱。
 *
 * 为什么不用 ListArea：心情项是「对象数组」，不是一行一个字符串——
 * 名字、图标、正负、强弱都要能改，用 textarea 表达不出来（用户也分不清哪个字段是什么）。
 * 交互照「生图备用接口」那套对象数组编辑（imageGen.fallbacks）：卡片 + 上下移 + 删除 + 添加。
 */

function EmotionEditor({ value, onChange, disabled }) {
  const list = Array.isArray(value) && value.length ? value : EMOTION_DEFAULTS
  const setItem = (i, patch) => onChange(list.map((item, j) => (j === i ? { ...item, ...patch } : item)))
  const remove = (i) => onChange(list.filter((_, j) => j !== i))
  const move = (i, step) => {
    const j = i + step
    if (j < 0 || j >= list.length) return
    const next = list.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  // 新项的键必须唯一且合规：给个确定不会撞的默认键，用户想改再改（键是模型对齐用的，一般不用动）
  const add = () => {
    const used = new Set(list.map((item) => item.key))
    let n = list.length + 1
    while (used.has('emotion' + n)) n += 1
    onChange([...list, { key: 'emotion' + n, label: '新心情', icon: '💭', valence: 0.2, arousal: 0.5 }])
  }
  return h('div', null,
    h('div', { className: 'ab-small ab-muted', style: { marginBottom: 8 } },
      '这些就是她「能有的情绪」。删掉某项后她不会再出现这种心情；改名字只影响显示与措辞，不影响已经记下的数据。正负（-1 难过 ~ +1 开心）和强弱（0 平淡 ~ 1 强烈）决定怎么说这句话。'),
    list.map((item, i) => h('div', { key: item.key || ('e' + i), className: 'ab-note', style: { marginBottom: 8 } },
      h('div', { className: 'ab-flex', style: { gap: 6, marginBottom: 6, alignItems: 'center' } },
        h('span', { className: 'ab-muted ab-small', style: { width: 22, flexShrink: 0 } }, String(i + 1)),
        h('input', {
          className: 'ab-input sm', style: { width: 56, textAlign: 'center' }, value: item.icon || '', maxLength: 4,
          title: '图标（可留空）', disabled,
          onChange: (e) => setItem(i, { icon: e.target.value }),
        }),
        h('input', {
          className: 'ab-input sm', style: { flex: 1, minWidth: 80 }, value: item.label || '', maxLength: 8,
          title: '显示名字，最多 8 个字', disabled,
          onChange: (e) => setItem(i, { label: e.target.value }),
        }),
        h(Btn, { small: true, disabled: disabled || i === 0, onClick: () => move(i, -1) }, '上移'),
        h(Btn, { small: true, disabled: disabled || i === list.length - 1, onClick: () => move(i, 1) }, '下移'),
        h(Btn, { small: true, kind: 'ghost', disabled: disabled || list.length <= 1, onClick: () => remove(i) }, '删除')),
      h('div', { className: 'ab-flex', style: { gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { className: 'ab-muted ab-small', style: { width: 60, flexShrink: 0 } }, '正负'),
        h('input', {
          type: 'range', min: -1, max: 1, step: 0.1, style: { flex: 1, minWidth: 90 }, value: Number(item.valence) || 0, disabled,
          onChange: (e) => setItem(i, { valence: Number(e.target.value) }),
        }),
        h('span', { className: 'ab-muted ab-small', style: { width: 34, textAlign: 'right' } }, (Number(item.valence) || 0).toFixed(1)),
        h('span', { className: 'ab-muted ab-small', style: { width: 60, flexShrink: 0 } }, '强弱'),
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.1, style: { flex: 1, minWidth: 90 }, value: Number(item.arousal) || 0, disabled,
          onChange: (e) => setItem(i, { arousal: Number(e.target.value) }),
        }),
        h('span', { className: 'ab-muted ab-small', style: { width: 34, textAlign: 'right' } }, (Number(item.arousal) || 0).toFixed(1))),
      // 键名可改但要合规：后端 / 模型都按这套规则对齐，写进去一个坏键以后对不上
      h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 4, alignItems: 'center' } },
        h('span', { className: 'ab-muted ab-small', style: { flexShrink: 0 } }, '键名'),
        h('input', {
          className: 'ab-input sm',
          style: { width: 120 },
          value: item.key || '',
          maxLength: 24,
          title: '模型对齐用：小写字母开头，1~24 位（a-z 0-9 _ -）',
          disabled,
          onChange: (e) => {
            const key = String(e.target.value || '').trim()
            if (!EMOTION_KEY_RE.test(key)) return
            if (list.some((other, j) => j !== i && other.key === key)) return
            setItem(i, { key })
          },
        }),
        h('span', { className: 'ab-muted ab-small' }, '（模型对齐用，一般不用改）'))))
    ,
    h('div', { className: 'ab-flex', style: { gap: 8, marginTop: 4 } },
      h(Btn, { small: true, disabled: disabled || list.length >= 24, onClick: add }, '＋ 添加一项'),
      h(Btn, { small: true, kind: 'ghost', disabled, onClick: () => onChange(EMOTION_DEFAULTS.map((item) => ({ ...item }))) }, '恢复出厂十项')),
  )
}

// 心情页：单标量心情（打分/半衰期/模型判定）+ 情绪向量（心情项可配）+ ta自己的说话方式。
// 情绪向量 2026-11-17 从目的引擎页搬来这里：它是「她此刻的心情」，不是「这一轮的目的」，
// 目的引擎关掉时心情也要照常显示；两处各画一套进度条只会让人以为有两份心情。
function Mood({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  // 「ta自己的说话方式」跟着心情页走：那是聊久了养成的说话习惯（人格/心情一部分），
  // 不是记忆库设置。放在记忆页会让「记忆」那页混进一条不属于它的东西。
  const [styles, setStyles] = useState({})
  const loadIns = () => get('/insights').then((r) => setStyles(r.styles || {}))
  useEffect(() => { if (modOn(st, 'memory')) loadIns() }, [modOn(st, 'memory')])
  const stylesCard = h(Card, { title: 'ta自己的说话方式', desc: '聊久了慢慢养成的说法。不会变成另一个人，只是越来越像「你们的」大肥鱼。对每个人和每个群的相处经验、说话习惯在「人物记忆」页。' },
    h(Row, { label: '使用学来的语气与相处建议', hint: '对所有群和私聊生效。关闭后不带入回复；学习和存档继续，事实记忆不受影响。改完请保存设置。' }, f.sw('memory.adaptStyle', { title: '使用学来的语气与相处建议' })),
    h(StyleEditor, { k: 'self', label: 'ta自己养成的说法', list: styles.self || [], toast, onSaved: loadIns }))
  // 心情历史：/state 只带摘要（history 被剥掉，e2e 锁着这个行为），
  // 所以过去这段「因为…」列表一直渲染不出来。改从模块自带的 /mood/history 按需拉。
  const [history, setHistory] = useState([])
  useEffect(() => {
    if (!modOn(st, 'mood')) return
    get('/mood/history').then((r) => setHistory(Array.isArray(r.history) ? r.history : [])).catch(() => {})
  }, [modOn(st, 'mood')])
  const historyBlock = history.length ? h('div', { className: 'ab-list', style: { marginTop: 8 } }, history.slice(0, 6).map((x, i) => h('div', { key: i, className: 'ab-li' },
    h('div', { className: 'meta' }, timeAgo(x.at)),
    h('div', { className: 'body' }, (x.to >= x.from ? '↑ ' : '↓ ') + x.from + ' → ' + x.to, h('span', { className: 'ab-muted ab-small' }, '  ' + x.reason))))) : null
  // 此刻的情绪（十项进度条）：数据来自 /state.mood.emotionsItems（心情模块下发），
  // 不再读目的引擎的 status.moods——那是旧的两份心情，2026-11-17 已合并。
  // st.mood 可能只有摘要（心情模块没跑时 /state 给的是空壳 {value,label,reason}），
  // 取值一律走可选链：面板任何一页都不该因为「某个模块没跑」整页崩掉。
  const emotionSource = st.mood || {}
  const emotionItems = Array.isArray(emotionSource.emotionsItems) ? emotionSource.emotionsItems : []
  const topEmotion = emotionSource.emotionTop || null
  const emotionCard = !modOn(st, 'mood') ? null : h(Card, {
    title: '此刻的情绪',
    desc: '每种心情现在的强弱；会随时间淡去（下面「多久回到平常」就是它的半衰期），最近发生的事最明显。这一栏和上面的心情数值是同一份状态：数值是她整体高不高兴，这些是她具体在为什么情绪起伏。',
  },
    topEmotion
      ? h('div', { className: 'ab-small', style: { marginBottom: 8 } }, h('b', null, (topEmotion.icon || '💭') + ' ' + topEmotion.label), h('span', { className: 'ab-muted' }, ' · 现在最明显'))
      : h('div', { className: 'ab-small ab-muted', style: { marginBottom: 8 } }, '现在没什么明显的情绪（平平常常）。'),
    emotionItems.map((item) => h('div', { key: item.key, className: 'ab-flex', style: { marginBottom: 3, opacity: (item.value || 0) > 0.02 ? 1 : 0.45 } },
      h('span', { className: 'ab-small', style: { width: 84, flexShrink: 0 } }, (item.icon || '💭') + (item.label || item.key)),
      h('div', { className: 'ab-mood', style: { flex: 1 } }, h('i', { style: { width: Math.round((item.value || 0) * 100) + '%' } })),
      h('span', { className: 'ab-muted ab-small', style: { width: 34, textAlign: 'right' } }, Math.round((item.value || 0) * 100) + '%'))),
    // 心情项（情绪表）跟着心情页走：增删改都是「她有哪些心情」，不是目的引擎的参数。
    h(Card, { title: '心情项', collapsible: true, defaultOpen: false, className: 'ab-fold-sub', desc: '她有哪些情绪、各叫什么、偏正还是偏负、强还是弱。目的引擎判素材情绪、提示词里的措辞强弱，都按这张表走。' },
      h(EmotionEditor, {
        // 草稿里没这个键时按出厂十项显示（后端 normalize 也会补同样的默认值）
        value: (draft.mood && Array.isArray(draft.mood.emotions) && draft.mood.emotions.length) ? draft.mood.emotions : EMOTION_DEFAULTS,
        disabled: !modOn(st, 'mood'),
        onChange: (list) => setDraft(setPath(draft, 'mood.emotions', list)),
      })),
  )
  const moodCard = !modOn(st, 'mood') ? h(ModOff, { name: '心情' }) : h(Card, { title: '心情', right: f.sw('mood.enabled'), desc: '被夸、被哄、被凶都会影响ta的心情（对ta说的话、主人的话影响更大），过一阵子慢慢回到平常。心情好时ta话多、更爱发表情和语音、回得快、群里更爱插话；心情差时话少、回得慢、少发表情，还会带点小脾气。' },
      h('div', { className: 'ab-flex', style: { marginBottom: 8 } }, h('b', null, emotionSource.label || '平平常常'), h('span', { className: 'ab-muted' }, (emotionSource.value ?? 60) + ' / 100'), emotionSource.reason ? h('span', { className: 'ab-muted ab-small' }, '· 因为' + emotionSource.reason) : null),
      h('div', { className: 'ab-mood' }, h('i', { style: { width: Math.max(4, emotionSource.value ?? 60) + '%' } })),
      h('div', { style: { marginTop: 10 } },
        h(Row, { label: '多久回到平常', hint: '半衰期，心情数值和下面每种情绪都用它' }, f.range('mood.halfLifeHours', 0.5, 24, 0.5, (v) => v + ' 小时')),
        h(Row, { label: '平常是多少', hint: '基线：没人说话时心情会慢慢往这个值靠（默认 60）' }, f.range('mood.base', 10, 90, 1, (v) => v + ' / 100')),
        h(Row, { label: '聊天流水留多久', hint: '默认留 7 天，刚说过的话靠它想起来；0 = 整理完就删；-1 = 永久保留；其他数字 = 留这么多天。留得越久，本机存的聊天原文越多' }, f.num('memory.keepChatlogDays', { min: -1, max: 3650 })),
        h(Row, { label: '整理时合并重复记忆', hint: '同一个人名下说的是一件事的条目并成一条。每个人多一次模型调用，默认关' }, f.sw('memory.mergeGroups')),
        h(Row, { label: '用模型判断心情', hint: '每轮回复后用一次简短的模型调用判断语气和说话对象。关闭后仅匹配关键词，可能把对别人的夸奖或玩笑记成自己的心情。' }, f.sw('mood.judge'))),
      historyBlock,
    )
  // 心情页：心情数值 + 此刻的情绪 + ta自己的说话方式
  return h('div', { className: 'ab-grid' },
    moodCard,
    emotionCard,
    stylesCard,
  )
}

// 「心情与记忆」拆成两页：心情只管情绪状态和半衰期，记忆页管记忆库、星图、整理、联想、向量检索。
// 一页塞十几组设置太挤（实测要滚好几屏才能看到保存条），拆开后各管各的、找设置更快。
/**
 * 记忆页外壳：「记忆条目」/「人物」两个子视图共用一个页签（照 VoiceTab 模式）。
 * 关键约束：人物视图（PersonaMemory）只在 view==='person' 时挂载——不挂载即不拉人物列表。
 */

export { EMOTION_DEFAULTS, EMOTION_KEY_RE, EmotionEditor, Mood }
