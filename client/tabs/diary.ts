import { useState, useEffect, useRef } from '../core/react.ts'
import { get, post } from '../core/api.ts'
import { setPath, timeAgo } from '../core/format.ts'
import { ModOff, modOn } from '../core/nav.ts'
import { Btn, Card, Empty, Row, Select, h, useField } from '../core/ui.ts'
import { OutboundPolicy, PurposeStatus } from './autotelic.ts'

// 和 QQ 空间自身的可见范围一致（ugc_right 1/4/16/64/128）
const AUDIENCE_OPTIONS = [
  { value: 'all', label: '所有人可见' },
  { value: 'friends', label: '好友可见' },
  { value: 'selected', label: '部分好友可见' },
  { value: 'excluded', label: '部分好友不可见' },
  { value: 'self', label: '仅自己可见' },
]

const AUDIENCE_LABEL = Object.fromEntries(AUDIENCE_OPTIONS.map((o) => [o.value, o.label]))

/** 可见范围：固定范围存进配置；部分好友再配一份 QQ 名单。 */

function DiaryAudience({ draft, setDraft, toast }) {
  const mode = draft.diary.visibility
  const partial = mode === 'selected' || mode === 'excluded'
  const [friends, setFriends] = useState(null)
  const [query, setQuery] = useState('')
  const qqText = draft.diary.audienceQQs || ''
  const selected = Array.from(new Set(String(qqText).split(/[\s,，;；]+/).filter(Boolean)))
  const setList = (list) => setDraft(setPath(draft, 'diary.audienceQQs', Array.from(new Set(list)).join('\n')))
  const toggle = (qq) => setList(selected.includes(qq) ? selected.filter((q) => q !== qq) : [...selected, qq])
  return h('div', null,
    h(Row, { label: '谁能看', hint: '和 QQ 空间的可见范围一致' },
      h(Select, { value: mode, options: AUDIENCE_OPTIONS, width: 170, onChange: (v) => setDraft(setPath(draft, 'diary.visibility', v)) })),
    partial ? h('div', { style: { marginTop: 10 } },
      h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 8 } },
        h(Btn, { small: true, kind: 'ghost', onClick: async () => { try { const r = await get('/diary/friends'); if (!r.ok) return toast(r.message || '读取好友失败'); setFriends(r.friends) } catch (e) { toast(e.message) } } }, '从好友列表选择'),
        h('span', { className: 'ab-muted ab-small' }, '已选 ' + selected.length + ' 人，只对之后发的说说生效')),
      friends ? h('div', { style: { marginBottom: 8 } },
        h('input', { className: 'ab-input', placeholder: '搜索昵称或 QQ 号', value: query, onChange: (e) => setQuery(e.target.value) }),
        h('div', { style: { maxHeight: 220, overflow: 'auto', marginTop: 6 } },
          friends.filter((f) => (f.name + f.qq).toLowerCase().includes(query.toLowerCase())).map((f) =>
            h('label', { key: f.qq, style: { display: 'block', padding: '4px 2px' } },
              h('input', { type: 'checkbox', checked: selected.includes(f.qq), onChange: () => toggle(f.qq) }),
              ' ' + (f.name || '（无备注）') + '（' + f.qq + '）')))) : null,
      h('textarea', {
        className: 'ab-textarea', style: { minHeight: 64 }, placeholder: '也可以直接填 QQ 号，一行一个',
        value: qqText, onChange: (e) => setDraft(setPath(draft, 'diary.audienceQQs', e.target.value)),
      }),
      h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, mode === 'selected' ? '名单为空时不会发布，也不会退回公开。' : '这些好友看不到之后的说说。')) : null,
  )
}

function DiaryMedia({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const unsaved = JSON.stringify(draft.diary) !== JSON.stringify(st.config.diary)
  // 修改配置后清掉旧预览，避免把旧目录或旧可见范围当成当前设置。
  useEffect(() => { request.current++; setPreview(null); setBusy(false) }, [JSON.stringify(draft.diary)])
  useEffect(() => () => { request.current++ }, [])
  const generate = async () => {
    const id = ++request.current
    setBusy(true)
    setPreview(null)
    try {
      const result = await post('/diary/preview', {})
      if (id !== request.current) return
      if (!result.ok) return toast(result.message || '预览没有生成')
      setPreview(result)
    } finally { if (id === request.current) setBusy(false) }
  }
  return h(Card, { title: '图文日记与预览', right: f.sw('diary.rich.enabled'), desc: '默认关闭。开启后围绕公开浏览经历或心情写日记，按备注挑选配图；关闭后沿用原来的日记流程。' },
    draft.diary.rich?.enabled ? h('div', null,
      h(Row, { label: '表情包', hint: '默认关闭，需主人单独开启；开启后可能将从群聊收藏的表情图发布到空间' }, f.sw('diary.rich.stickers')),
      h(Row, { label: '公开浏览配图', hint: '仅取已浏览作品的公开封面；发布会附原作者和作品链接' }, f.sw('diary.rich.browsing')),
      h(Row, { label: '使用指定目录的图片', hint: '只放你允许自动发布到空间的图片；文件内容不会自动识别隐私' }, f.sw('diary.rich.local')),
      h(Row, { label: '本地图片目录', hint: '由主人主动填写完整路径。留空不扫描；不读取桌面或聊天截图' }, f.text('diary.rich.folder', { placeholder: '留空不读取本地图库' })),
      h(Row, { label: '每篇最多配图' }, f.num('diary.rich.maxImages', { min: 1, max: 4 })),
    ) : null,
    h('div', { className: 'ab-small ab-muted', style: { margin: '12px 0' } }, '先保存设置再预览。预览不会发布、记入发布历史或消耗当天次数；「现在写一篇」会重新写作，遵守保存的可见范围。'),
    unsaved ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', marginBottom: 8 } }, '日记设置尚未保存，保存后可生成预览。') : null,
    h(Btn, { kind: 'ghost', disabled: busy || unsaved, onClick: generate }, busy ? '正在生成预览…' : '生成预览（不发布）'),
    preview ? h('div', { className: 'ab-note', style: { marginTop: 14 } },
      h('div', { className: 'ab-small ab-muted' }, '预览 · ' + preview.label + ' · 尚未发布'),
      h('div', { style: { whiteSpace: 'pre-wrap', margin: '10px 0' } }, preview.text),
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', alignItems: 'flex-start' } }, (preview.media || []).map((image) =>
        h('figure', { key: image.id, style: { margin: 0, width: 160 } },
          h('img', { src: image.src, alt: image.caption || '日记配图', style: { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 10 } }),
          h('figcaption', { className: 'ab-small ab-muted' }, image.kind === 'browsing' || image.sourceKind === 'browsing' ? image.platform + ' · ' + image.title : image.kind === 'local' ? '主人指定图库 · ' + image.caption : '表情包 · ' + image.caption)))),
      (preview.warnings || []).map((warning, i) => h('div', { key: i, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
    ) : null,
  )
}

function DiaryArchive({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const unsaved = JSON.stringify(draft.diary.archive) !== JSON.stringify(st.config.diary.archive)
  const load = () => get('/diary/archive').then(setStatus)
  useEffect(() => {
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])
  return h(Card, { title: '按日期归档浏览图', right: f.sw('diary.archive.enabled'), desc: '默认关闭。每五分钟把已有的公开浏览配图或 B 站视频抽帧保存一份，按浏览日期放入 20261031 这样的文件夹。不截取桌面或聊天。' },
    h(Row, { label: '归档文件夹', hint: '主人主动指定的输出目录，留空不保存；每张图附来源说明文件' }, f.text('diary.archive.folder', { placeholder: '请填写完整路径' })),
    h('div', { className: 'ab-small ab-muted', style: { margin: '10px 0' } }, status ? '已归档 ' + status.count + ' 张' + (status.lastAt ? ' · 最近收集 ' + new Date(status.lastAt).toLocaleString() : '') : '正在读取归档状态…'),
    status?.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, status.error) : null,
    h(Btn, { kind: 'ghost', disabled: busy || unsaved || !draft.diary.archive?.enabled || !draft.diary.archive?.folder, onClick: async () => {
      setBusy(true)
      try { const result = await post('/diary/archive/collect', {}); toast(result.message || '归档完成'); await load() }
      finally { setBusy(false) }
    } }, busy ? '正在收集…' : '现在收集浏览图'),
    h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '先保存设置。总开关关闭或试运行开启时不保存图片；归档本身不会发布到空间。要用作日记配图，另在上方启用指定图库。'),
  )
}

function Diary({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [data, setData] = useState(null)
  const on = modOn(st, 'diary')
  const load = () => (on ? get('/diary/history').then((r) => { setData(r); if (r.warning) toast(r.warning) }).catch((e) => toast('日记状态刷新失败：' + e.message)) : null)
  useEffect(() => { load() }, [on])
  const social = modOn(st, 'qzone-social') ? h(QzoneSocial, { draft, setDraft, toast }) : h(ModOff, { name: '空间互动' })
  if (!on) return h('div', { className: 'ab-grid' }, h(ModOff, { name: '空间日记' }), social)
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '空间日记', right: f.sw('diary.enabled'), desc: 'ta每天会在 QQ 空间发几条说说，结合当天聊过的事，用自己的口吻写。写日记那一轮不会发到聊天里。' },
      h(Row, { label: '每天写几次' }, f.num('diary.timesPerDay', { min: 0, max: 6 })),
      h(Row, { label: '时间段', hint: '在这段时间里随机挑时间' }, f.text('diary.windowStart', { size: 'sm' }), h('span', { className: 'ab-muted' }, '到'), f.text('diary.windowEnd', { size: 'sm' })),
      h(Row, { label: '两篇至少隔' }, f.num('diary.minGapMinutes', { min: 0 }), h('span', { className: 'ab-muted' }, '分钟')),
      h(Row, { label: '字数' }, f.num('diary.minChars', { min: 10 }), h('span', { className: 'ab-muted' }, '到'), f.num('diary.maxChars', { min: 20 }), h('span', { className: 'ab-muted' }, '字')),
      h(DiaryAudience, { draft, setDraft, toast }),
    ),
    h(DiaryMedia, { st, draft, setDraft, toast }),
    h(DiaryArchive, { st, draft, setDraft, toast }),
    h(Card, { title: '写过的日记', right: h('div', { className: 'ab-flex' },
      data && data.next ? h('span', { className: 'ab-muted ab-small' }, '下一篇大约 ' + data.next) : null,
      h(Btn, { small: true, kind: 'ghost', title: '刷新空间状态', onClick: load }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('path', { d: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17' }))),
      h(Btn, { small: true, kind: 'primary', onClick: async () => {
        toast('ta在写了…')
        try {
          const r = await post('/diary/run', {})
          const message = r.dryRun ? '写好了（试运行，没真发）' : '发出去了'
          toast(r.ok ? [message, ...(r.warnings || [])].join('；') : r.message)
        } catch (e) { toast(e.message) }
        finally { await load() }
      } }, '现在写一篇')) },
      !data ? h(Empty, { icon: '⏳', text: '加载中…' }) : !data.items || data.items.length === 0 ? h(Empty, { icon: '📔', text: '还没写过日记。' }) :
        h('div', { className: 'ab-list' }, data.items.map((d, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, new Date(d.at).toLocaleString(), h('br'), d.deletedAt ? '已从空间删除' : d.dryRun ? '试运行' : d.ok ? (AUDIENCE_LABEL[d.visibility] || '已发布') : '失败'),
          h('div', { className: 'body' }, d.text,
            (d.warnings || []).map((warning, index) => h('div', { key: index, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
            d.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-err)' } }, d.error) : null),
          d.tid && !d.deletedAt ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('从 QQ 空间删除这条说说？')) return; try { const r = await post('/qzone/delete', { tid: d.tid }); toast(r.message) } catch (e) { toast(e.message) } finally { await load() } } }, '从空间删除') : null))),
    ),
    social,
  )
}

const SOCIAL_KIND = { reply: '回复评论', comment: '评论', like: '点赞' }

/** 空间互动：回复自己说说下的评论、逛好友动态。 */

function QzoneSocial({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(null)
  const load = () => get('/qzone/social/state').then(setS)
  useEffect(() => { load() }, [])
  return h(Card, { title: '空间互动', right: f.sw('qzoneSocial.enabled'), desc: 'ta会定期逛 QQ 空间：有人评论ta的说说就回一句；刷到好友的说说，偶尔点个赞、评一句（你的说说ta更爱评）。评论按ta的人格现写；试运行时只记日志不发。' },
    h(Row, { label: '回复自己说说下的评论' }, f.sw('qzoneSocial.replyOwn')),
    h(Row, { label: '评论好友的说说' }, f.sw('qzoneSocial.commentFriends')),
    h(Row, { label: '顺手点赞' }, f.sw('qzoneSocial.like')),
    h(Row, { label: '好友说说互动概率', hint: '每条说说只判断一次' }, f.percent('qzoneSocial.friendChance')),
    h(Row, { label: '你的说说互动概率' }, f.percent('qzoneSocial.ownerChance')),
    h(Row, { label: '每天最多评论', hint: '点赞不算' }, f.range('qzoneSocial.maxPerDay', 0, 30, 1, (v) => v + ' 条')),
    h(Row, { label: '多久逛一次', hint: '只在「目的引擎」里设的醒着时间内' }, f.range('qzoneSocial.intervalMin', 10, 240, 10, (v) => v + ' 分钟')),
    h('div', { className: 'ab-flex', style: { marginTop: 10 } },
      h('span', { className: 'ab-muted ab-small' }, s ? '今天评论了 ' + s.count + ' 条' + (s.lastRun ? '，上次逛是 ' + timeAgo(s.lastRun) : '') : ''),
      h('div', { className: 'ab-spacer' }),
      h(Btn, { small: true, onClick: async () => { toast('ta去逛空间了…'); const r = await post('/qzone/social/run'); toast(r.message, r.ok ? 'ok' : 'err'); load() } }, '现在逛一次')),
    s && s.history && s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
      h('div', { className: 'meta' }, timeAgo(x.at), h('br'), SOCIAL_KIND[x.kind] || x.kind),
      h('div', { className: 'body' }, h('b', null, x.who), x.post ? h('span', { className: 'ab-muted' }, ' 的「' + x.post + '」') : null, x.text ? h('div', null, x.text) : null)))) : null,
  )
}

/**
 * 目的引擎页（tab 'speakup'）。2026-11-17 按面板统一口径重构：
 *  - 可见区 2~3 个高频组（一律纯行式：Row 直接纵向排列，label 左、控件右；
 *    曾包在 ab-grp-row 网格里，但那套样式会把 Row 改写成竖排窄卡，已废弃）
 *  - 其余收进「更多设置（N 项）」折叠卡（collapsible + defaultOpen=false + ab-fold-sub）
 *  - 冻结键（speakUp.awakeFrom、awakeTo、allow、reminder 系列、idleMinutes、间隔、maxPerDay、nudge）一个不丢，仅调整呈现位置
 */

function SpeakUp({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  // 「更多设置（N 项）」折叠子卡：与聊天页/记忆页同口径
  const more = (title, items) => (items.length ? h(Card, { title: (title || '更多设置') + '（' + items.length + ' 项）', collapsible: true, defaultOpen: false, className: 'ab-fold-sub' }, items) : null)
  const [closedReminders, setClosedReminders] = useState(() => new Set())
  const reminders = (st.speakUp?.reminders || []).filter((r) => !closedReminders.has(r.id))
  const closeReminder = async (id) => {
    const r = await post('/purpose/reminder/close', { id }).catch(() => ({ ok: false, message: '关闭失败' }))
    toast(r.message, r.ok === false ? 'err' : 'ok')
    if (r.ok) setClosedReminders((prev) => new Set(prev).add(id))
  }
  return h('div', { className: 'ab-grid' },
    // ===== 可见区 ① 什么时候来找你（4 项核心节奏，纯行式：label 左、控件右）=====
    h(Card, { title: '什么时候来找你',
      desc: '只在和你的私聊里：闲的时候主动来找你说一句——每次由头不一样（分享小事、接着上次的话题、想起你的事、按时间问候……），内容是ta现想的，不是模板。群里不会这样。' },
      h(Row, { label: '多久没聊才找你' }, f.num('speakUp.idleMinutes', { min: 5 }), h('span', { className: 'ab-muted' }, '分钟')),
      h(Row, { label: '两次之间隔', hint: '在这个范围里随机' }, f.num('speakUp.minIntervalMinutes', { min: 5 }), h('span', { className: 'ab-muted' }, '到'), f.num('speakUp.maxIntervalMinutes', { min: 5 }), h('span', { className: 'ab-muted' }, '分钟')),
      h(Row, { label: '每天最多', hint: '每个人单独算；留空就是 20，不封顶' }, f.num('speakUp.maxPerDay', { min: 0 }), h('span', { className: 'ab-muted' }, '次')),
      h(Row, { label: 'ta醒着的时间', hint: '这段时间外不打扰你；终点填 24 表示醒到午夜（比如 7 到 24 = 早上 7 点到当天结束，0 点到 7 点不打扰）；起止相同 = 全天不打扰关闭；小闹钟按她定的时间触发，不受这里限制' }, f.num('speakUp.awakeFrom', { min: 0, max: 23 }), h('span', { className: 'ab-muted' }, '点到'), f.num('speakUp.awakeTo', { min: 1, max: 24 }), h('span', { className: 'ab-muted' }, '点')),
      h('div', { className: 'ab-flex', style: { marginTop: 10 } },
        h('span', { className: 'ab-muted ab-small' }, '今天已经找过你 ' + (st.speakUp.count || 0) + ' 次'),
        h('div', { className: 'ab-spacer' }),
        h(Btn, { small: true, onClick: async () => { const r = await post('/panel/purpose/run'); toast(r.message) } }, '现在就让ta来找我')),
    ),

    // ===== 可见区 ② 找谁（白名单，单项但高频且重要）=====
    h(Card, { title: '找谁',
      desc: '除了你，还会主动找这些人，每人单独算次数。目的引擎开着时也按这份名单找人，只用和对方的私聊和关于对方的记忆。' },
      h(Row, { label: '白名单', hint: '每行一个 QQ 号；也可以在 QQ 里发 /speak add QQ 号。名单里的人要在私聊白名单里，才能回ta' }, f.list('speakUp.allow', { placeholder: '每行一个 QQ 号', numbers: true })),
    ),

    // ===== 可见区 ③ 小闹钟与追问（3 项）=====
    h(Card, { title: '小闹钟与追问',
      desc: '她自己在对话里定的一次性提醒；到点会触发主动搭话，让她按当时说好的内容来找你。过期或触发成功后会自动消失。' },
      h(Row, { label: '她的小闹钟', hint: '开着她可以在和你的私聊里自己定时间，到点由目的引擎的系统提醒叫醒她' }, f.sw('speakUp.reminderEnabled')),
      h(Row, { label: '追问', hint: 'ta问了你一句、你 15~40 分钟没回，偶尔轻轻追一句（「人呢」之类），每句最多追一次' }, f.sw('speakUp.nudge')),
      h(Row, { label: '最多保留', hint: '未过期、未关闭的提醒；最多 10 条' }, f.num('speakUp.reminderLimit', { min: 1, max: 10 }), h('span', { className: 'ab-muted' }, '条')),
      more('更多设置', [
        h(Row, { key: 'rr', label: '触发失败时保留提醒', hint: '网络波动或模型调用失败时保留 15 分钟，每 5 分钟重试一次；关掉则失败即丢弃' }, f.sw('speakUp.reminderRetry')),
      ]),
      // 待触发列表
      reminders.length
        ? h('div', { style: { marginTop: 10 } }, reminders.map((r) => h('div', { key: r.id, className: 'ab-flex', style: { alignItems: 'flex-start', gap: 12, padding: '9px 0', borderTop: '1px solid var(--ab-line)' } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('b', null, r.atText),
            h('div', { className: 'ab-small', style: { marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, r.note)),
          h(Btn, { small: true, kind: 'ghost', onClick: () => closeReminder(r.id) }, '关闭'))))
        : h('div', { className: 'ab-muted ab-small', style: { marginTop: 10 } }, '还没有待触发的小闹钟。'),
    ),

    h(PurposeStatus, { st, toast }),
    h(OutboundPolicy, { toast }),
  )
}

export { AUDIENCE_OPTIONS, AUDIENCE_LABEL, DiaryAudience, DiaryMedia, DiaryArchive, Diary, SOCIAL_KIND, QzoneSocial, SpeakUp }
