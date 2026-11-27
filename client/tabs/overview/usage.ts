import { useEffect, useState } from '../../core/ui/react.ts'
import { API } from '../../core/api/api.ts'
import { chatLabel, fmtTokens } from '../../core/ui/format.ts'
import { Btn, Card, cx, h } from '../../core/ui/ui.ts'

const choices = [['today', '今日'], ['yesterday', '昨日'], ['7', '近 7 天'], ['custom', '自定义']]
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const exact = n => Number(n || 0).toLocaleString('zh-CN')
const hit = row => row.cacheHitRate == null ? '—' : (row.cacheHitRate * 100).toFixed(1) + '%'

function breakdown(title, rows, label = key => key) {
  return h('details', { className: 'ab-usage-breakdown' }, h('summary', null, title),
    rows.length ? h('div', { className: 'ab-usage-table', tabIndex: 0, 'aria-label': title },
      h('table', { className: 'ab-table num' }, h('thead', null, h('tr', null,
        ['来源', '调用', '输入', '缓存读', '缓存写', '输出', '总计'].map(key => h('th', { key }, key)))),
      h('tbody', null, rows.map(r => h('tr', { key: r.key }, h('td', null, label(r.key)),
        ...['runs','promptTokens','cachedTokens','cacheWriteTokens','completionTokens','totalTokens'].map(key => h('td', { key }, exact(r[key]))))))))
    : h('p', { className: 'ab-muted' }, '所选日期没有记录。'))
}

export function UsageSummary({ sessions = {} }) {
  const [range, setRange] = useState('7'), [from, setFrom] = useState(today), [to, setTo] = useState(today)
  const [result, setResult] = useState(null), [revision, refresh] = useState(0)
  const query = new URLSearchParams({ range, ...(range === 'custom' && { from, to }) }).toString()
  const invalid = range === 'custom' && (!from || !to || from > to)
  useEffect(() => {
    if (invalid) return
    const controller = new AbortController()
    fetch(API + '/usage?' + query, { signal: controller.signal, cache: 'no-store' }).then(async r => {
      const value = await r.json()
      if (!r.ok || !value.ok) throw Error(value.message || '读取用量失败')
      if (!controller.signal.aborted) setResult({ query, value })
    }).catch(error => { if (!controller.signal.aborted) setResult({ query, error: error.message }) })
    return () => controller.abort()
  }, [query, revision, invalid])
  const value = !invalid && result?.query === query && result.value
  const current = value?.current
  return h(Card, { title: 'Token 用量', right: h(Btn, { small: true, onClick: () => refresh(n => n + 1) }, '刷新') },
    h('div', { className: 'ab-flex', role: 'group', 'aria-label': '统计日期' }, choices.map(([id, name]) =>
      h('button', { key: id, type: 'button', className: cx('ab-btn sm', range === id && 'primary'), 'aria-pressed': range === id, onClick: () => setRange(id) }, name))),
    range === 'custom' && h('div', { className: 'ab-flex' },
      h('label', null, '开始日期 ', h('input', { type: 'date', value: from, max: to || today(), onChange: e => setFrom(e.target.value) })),
      h('label', null, '结束日期 ', h('input', { type: 'date', value: to, min: from, max: today(), onChange: e => setTo(e.target.value) }))),
    invalid ? h('p', { role: 'alert' }, '请填写有效的起止日期。') : current ? h('div', null,
      h('p', { title: exact(current.totalTokens) + ' Tokens' }, h('strong', null, fmtTokens(current.totalTokens)), ' Tokens · ',
        exact(current.runs), ' 次调用 · 缓存命中率 ', hit(current)),
      value.writeFailed && h('p', { role: 'alert' }, '部分用量未能写入本地数据库。'),
      breakdown('按模块', current.byModule), breakdown('按模型', current.byModel),
      breakdown('按会话', current.byChat, key => sessions[key]?.title || chatLabel(key)), breakdown('记忆任务', current.byMemoryTask),
      h('small', { className: 'ab-muted' }, '按北京时间统计最近 90 天。输入包含缓存读写。'))
      : h('p', { role: 'status' }, result?.query === query && result.error || '正在读取用量…'))
}
