import { useState, useEffect } from './../core/react.ts'
import { post } from './../core/api.ts'
import { Btn, h } from './../core/ui.ts'

function StyleEditor({ k, label, list, toast, onSaved }) {
  const [text, setText] = useState(list.join('\n'))
  useEffect(() => setText(list.join('\n')), [list.join('\n')])
  const changed = text !== list.join('\n')
  return h('div', { style: { marginTop: 8 } },
    h('div', { className: 'ab-flex', style: { marginBottom: 4 } }, h('span', { className: 'ab-small', style: { color: 'var(--ab-sub)' } }, label), h('div', { className: 'ab-spacer' }),
      changed ? h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/style/save', { key: k, list: text.split('\n') }); toast(r.message, 'ok'); onSaved() } }, '保存') : null),
    h('textarea', { className: 'ab-textarea', style: { minHeight: 50, fontFamily: 'inherit' }, value: text, onChange: (e) => setText(e.target.value), placeholder: '一行一条，例如：消息很短，常一句话分几条发' }))
}

function InsightCard({ p, toast, onSaved, style }) {
  const saved = p.list.map((x) => x.text).join('\n')
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved])
  const changed = text !== saved
  return h('div', null,
    h('div', { className: 'ab-flex', style: { marginBottom: 6 } }, h('span', { className: 'ab-small', style: { color: 'var(--ab-sub)' } }, '相处经验 ' + p.list.length + ' 条'), h('div', { className: 'ab-spacer' }),
      changed ? h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/insights/save', { key: p.key, list: text.split('\n') }); toast(r.message, 'ok'); onSaved() } }, '保存') : null),
    h('textarea', { className: 'ab-textarea', style: { minHeight: 70, fontFamily: 'inherit' }, value: text, onChange: (e) => setText(e.target.value), placeholder: '一行一条经验' }),
    h(StyleEditor, { k: p.key, label: '学到的说话习惯', list: style || [], toast, onSaved }))
}

export { StyleEditor, InsightCard }
