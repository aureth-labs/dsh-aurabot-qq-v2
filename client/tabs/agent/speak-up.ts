import { useState } from '../../core/ui/react.ts'
import { post } from '../../core/api/api.ts'
import { Btn, Card, Row, h, useField } from '../../core/ui/ui.ts'
import { OutboundPolicy, PurposeStatus } from './autotelic.ts'

export function SpeakUp({ st, draft, setDraft, toast }) {
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
