import { useEffect, useState } from '../../core/ui/react.ts'
import { get, post } from '../../core/api/api.ts'
import { Btn, Card, Row, Seg, h } from '../../core/ui/ui.ts'

type Kind = 'user' | 'group' | 'channel' | 'private'
interface Entry {
  kind: Kind
  platform: string
  botId: string
  id: string
  alias: string
  level: number | null
  name?: string
  effective?: number
  owner?: boolean
}
const kinds = { user: '用户', group: '群组', channel: '频道', private: '私聊' }
const pageSize = 25
const empty = (kind: Kind): Entry => ({ kind, platform: '', botId: '', id: '', alias: '', level: null })

function Editor({ initial, existing, onClose, onSave }) {
  const [value, setValue] = useState(initial as Entry)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key: string, next) => setValue(current => ({ ...current, [key]: next }))
  const field = (label: string, key: string, fixed = false) => h(Row, { label },
    h('input', { className: 'ab-input', 'aria-label': label, value: value[key], disabled: existing && fixed,
      onChange: e => set(key, e.target.value) }))
  const write = async (action: string) => {
    setBusy(true)
    const result = await post('/panel/identities/edit', { ...value, action })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    onSave()
  }
  return h(Card, { title: existing ? '编辑权限' : '添加权限' },
    h(Row, { label: '对象' }, h('select', { value: value.kind, disabled: existing, onChange: e => set('kind', e.target.value) },
      ...Object.entries(kinds).map(([key, name]) => h('option', { key, value: key }, name)))),
    field('平台', 'platform', true), field('机器人实例', 'botId', true), field('平台 ID', 'id', true), field('备注', 'alias'),
    h(Row, { label: value.kind === 'user' ? '用户等级' : '进入所需等级',
      hint: value.kind === 'user' ? '0 为封禁。机器人实例留空时，封禁覆盖此平台的所有实例。' : '0 为关闭频道，1 至 5 为最低用户等级。' },
      h('select', { 'aria-label': '等级', value: value.level ?? '', disabled: value.owner,
        onChange: e => set('level', e.target.value === '' ? null : Number(e.target.value)) },
        h('option', { value: '' }, value.owner ? '主人 · 5' : '默认'),
        ...[0, 1, 2, 3, 4, 5].map(n => h('option', { key: n, value: n }, String(n))))),
    error ? h('p', { role: 'alert' }, error) : null,
    h('div', { className: 'ab-flex' },
      h(Btn, { kind: 'primary', disabled: busy, onClick: () => write('save') }, '保存'),
      h(Btn, { disabled: busy, onClick: onClose }, '取消'),
      existing ? h(Btn, { disabled: busy, onClick: () => write('remove') }, '移除记录') : null))
}

export function IdentityDirectoryPage() {
  const [table, setTable] = useState('users')
  const [q, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, refresh] = useState(0)
  const [editor, setEditor] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const params = new URLSearchParams({ table, q, offset: String(offset), limit: String(pageSize) })
      const result = await get('/panel/identities?' + params)
      if (!alive) return
      setError(result.ok ? '' : result.message)
      if (result.ok) setData(result)
      timer = setTimeout(poll, 3500)
    }
    setData(null)
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [table, q, offset, revision])
  if (editor) return h(Editor, { initial: editor.value, existing: editor.existing, onClose: () => setEditor(null),
    onSave: () => { setEditor(null); refresh(n => n + 1) } })
  return h(Card, { title: '平台权限', desc: '收到消息时自动登记用户和频道。同一平台内按机器人实例区分。' },
    h('div', { className: 'ab-flex' },
      h(Seg, { value: table, options: [{ value: 'users', label: '用户' }, { value: 'channels', label: '频道' }],
        onChange: next => { setTable(next); setOffset(0) } }),
      h('input', { className: 'ab-input', 'aria-label': '搜索身份', placeholder: '查找 ID、名称或备注', value: q,
        onChange: e => { setQuery(e.target.value); setOffset(0) } }),
      h(Btn, { onClick: () => setEditor({ existing: false, value: empty(table === 'users' ? 'user' : 'group') }) }, '添加')),
    error ? h('p', { role: 'alert' }, error) : null,
    !data ? h('p', { className: 'ab-muted' }, '读取中…') : !data.rows.length ? h('p', { className: 'ab-muted' }, '没有匹配的记录') : null,
    ...(data?.rows ?? []).map((row: Entry) => h(Row, { key: JSON.stringify([row.platform, row.botId, row.kind, row.id]),
      label: row.alias || row.name || row.id, hint: [row.platform, row.botId || '所有实例', kinds[row.kind], row.id].join(' · ') },
      h(Btn, { small: true, onClick: () => setEditor({ existing: true, value: row }) },
        row.owner ? '主人 · 5' : row.effective === 0 ? '已封禁' : '等级 ' + row.effective))),
    offset || data?.more ? h('div', { className: 'ab-flex' },
      h(Btn, { small: true, disabled: !offset, onClick: () => setOffset(Math.max(0, offset - pageSize)) }, '上一页'),
      h(Btn, { small: true, disabled: !data?.more, onClick: () => setOffset(offset + pageSize) }, '下一页')) : null)
}
