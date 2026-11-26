import { Btn, Row, Select, Switch, h } from '../../core/ui/ui.ts'

interface Field {
  key: string
  type: string
  label?: string
  hint?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
  default?: unknown
  options?: (string | { value: string; label?: string })[]
  item?: Field
  fields?: Field[]
  hidden?: boolean
}
interface Props {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  saved?: boolean
}

function initial(field: Field): unknown {
  if (field.default !== undefined) return structuredClone(field.default)
  if (field.item) return []
  if (field.fields) return Object.fromEntries(field.fields.map((f) => [f.key, initial(f)]))
  if (field.type === 'boolean' || field.type === 'switch') return false
  if (field.type === 'number') return field.min ?? 0
  if (field.type === 'select') {
    const option = field.options?.[0]
    return typeof option === 'string' ? option : (option?.value ?? '')
  }
  return ''
}

export function SchemaField({ field, value, onChange, saved = false }: Props) {
  const label = field.label || field.key
  let input
  if (field.item) {
    const item = field.item
    const rows = Array.isArray(value) ? value : []
    input = h(
      'div',
      { className: 'ab-grid' },
      ...rows.map((row, i) =>
        h(
          'div',
          { key: i, className: 'ab-note' },
          h(SchemaField, {
            field: item,
            value: row,
            onChange: (next) => onChange(rows.map((v, j) => (i === j ? next : v))),
          }),
          h(Btn, { small: true, onClick: () => onChange(rows.filter((_, j) => j !== i)) }, '移除此项'),
        ),
      ),
      h(Btn, { small: true, onClick: () => onChange([...rows, initial(item)]) }, '添加一项'),
    )
  } else if (field.fields) {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    input = h(
      'div',
      { className: 'ab-grid' },
      ...field.fields
        .filter((s) => !s.hidden)
        .map((s) =>
          h(
            Row,
            { key: s.key, label: s.label || s.key },
            h(SchemaField, {
              field: s,
              value: data[s.key] ?? s.default,
              onChange: (next) => onChange({ ...data, [s.key]: next }),
            }),
          ),
        ),
    )
  } else if (field.type === 'switch' || field.type === 'boolean') {
    input = h(Switch, { on: value === true, onChange })
  } else if (field.type === 'select') {
    input = h(Select, {
      value: value ?? initial(field),
      options: (field.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
      onChange,
    })
  } else {
    const number = field.type === 'number'
    const secret = field.type === 'password'
    const tag = field.type === 'textarea' ? 'textarea' : 'input'
    input = h(tag, {
      className: tag === 'textarea' ? 'ab-textarea' : 'ab-input',
      'aria-label': label,
      type: number ? 'number' : secret ? 'password' : 'text',
      value: value ?? '',
      min: field.min,
      max: field.max,
      step: field.step,
      placeholder: secret && saved ? '已保存，留空保留' : field.placeholder,
      onChange: (e) => onChange(number && e.target.value !== '' ? Number(e.target.value) : e.target.value),
    })
  }
  if (saved && field.type === 'password' && (field.fields || field.item)) {
    return h('div', { className: 'ab-grid' }, h('small', null, '已保存。编辑后将整体替换此组配置。'), input)
  }
  return input
}
