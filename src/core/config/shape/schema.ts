// 模块配置的 Schema：写一份声明，面板表单、默认值、校验都从它派生。
// 只依赖自身，不引第三方（插件要在任意 DSH 环境里跑）。
//
//   export const config = Schema.object({
//     enabled: Schema.boolean().default(true).description('总开关'),
//     source: Schema.union(['both', 'bilibili', 'netease']).default('both'),
//     maxMinutes: Schema.natural().min(4).max(30).default(10),
//   })

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'password' | 'object' | 'array'

export interface SettingsField {
  key: string
  label?: string
  type: FieldType
  default?: unknown
  hint?: string
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: string; label: string }>
  fields?: SettingsField[]
  item?: SettingsField
  required?: boolean
  hidden?: boolean
  deprecated?: boolean
  experimental?: boolean
}

export interface ValidateResult<T> {
  ok: boolean
  value?: T
  error?: string
}

type Kind = 'boolean' | 'string' | 'number' | 'union' | 'array' | 'object'

export class SchemaNode<T = unknown> {
  readonly kind: Kind
  private fallback: T | undefined
  private hasDefault = false
  private desc = ''
  private label = ''
  private multiline = false
  private isHidden = false
  private isDeprecated = false
  private isExperimental = false
  private isRequired = false
  private isSecret = false
  private lower: number | undefined
  private upper: number | undefined
  private intOnly = false
  private members: unknown[] = []
  private item: SchemaNode | undefined
  private shape: Record<string, SchemaNode> | undefined

  constructor(kind: Kind) {
    this.kind = kind
  }

  default(value: NoInfer<T>): this {
    this.fallback = value as T
    this.hasDefault = true
    return this
  }

  title(label: string): this {
    this.label = label
    return this
  }

  description(text: string): this {
    this.desc = text
    return this
  }

  hidden(value = true): this {
    this.isHidden = value
    return this
  }

  deprecated(value = true): this {
    this.isDeprecated = value
    return this
  }

  experimental(value = true): this {
    this.isExperimental = value
    return this
  }

  required(value = true): this {
    this.isRequired = value
    return this
  }

  role(name: string): this {
    if (name === 'secret') this.isSecret = true
    if (name === 'textarea' && this.kind === 'string') this.multiline = true
    return this
  }

  min(value: number): this {
    this.lower = value
    return this
  }

  max(value: number): this {
    this.upper = value
    return this
  }

  integer(): this {
    this.intOnly = true
    return this
  }

  /** union：成员是字面量，或 { value, label } */
  of(...values: unknown[]): this {
    this.members = values
    return this
  }

  /** array：元素 schema */
  items(node: SchemaNode): this {
    this.item = node
    return this
  }

  /** object：字段表 */
  fields(shape: Record<string, SchemaNode>): this {
    this.shape = shape
    return this
  }

  get defaultValue(): unknown {
    if (this.hasDefault) return this.fallback
    if (this.kind === 'boolean') return false
    if (this.kind === 'number') return this.lower ?? 0
    if (this.kind === 'string') return ''
    if (this.kind === 'union') return this.memberValues()[0]
    if (this.kind === 'array') return []
    if (this.kind === 'object') return this.defaults()
    return undefined
  }

  memberValues(): unknown[] {
    return this.members.map((m) => (isPlainObject(m) && 'value' in m ? (m as { value: unknown }).value : m))
  }

  /** object 形态的全部默认值 */
  defaults(): Record<string, unknown> {
    if (this.kind !== 'object' || !this.shape) return {}
    const out: Record<string, unknown> = {}
    for (const [key, node] of Object.entries(this.shape)) out[key] = node.defaultValue
    return out
  }

  validate(input: unknown): ValidateResult<T> {
    const missing = input === undefined || input === null
    if (missing) {
      if (this.isRequired && !this.hasDefault) return { ok: false, error: '必填项为空' }
      return { ok: true, value: this.defaultValue as T }
    }
    switch (this.kind) {
      case 'boolean':
        if (typeof input === 'boolean') return { ok: true, value: input as T }
        if (input === 'true' || input === 1) return { ok: true, value: true as T }
        if (input === 'false' || input === 0) return { ok: true, value: false as T }
        return { ok: false, error: '要 true / false' }
      case 'string':
        if (this.isRequired && typeof input === 'string' && !input.trim()) return { ok: false, error: '必填项为空' }
        if (typeof input === 'string') return { ok: true, value: input as T }
        if (typeof input === 'number') return { ok: true, value: String(input) as T }
        return { ok: false, error: '要文本' }
      case 'number': {
        const n = typeof input === 'number' ? input : Number(input)
        if (!Number.isFinite(n)) return { ok: false, error: '要数字' }
        if (this.intOnly && !Number.isInteger(n)) return { ok: false, error: '要整数' }
        if (this.lower !== undefined && n < this.lower) return { ok: false, error: `不能小于 ${this.lower}` }
        if (this.upper !== undefined && n > this.upper) return { ok: false, error: `不能大于 ${this.upper}` }
        return { ok: true, value: n as T }
      }
      case 'union': {
        const values = this.memberValues()
        if (values.includes(input)) return { ok: true, value: input as T }
        return { ok: false, error: `只能是 ${values.join(' / ')}` }
      }
      case 'array': {
        if (!Array.isArray(input)) return { ok: false, error: '要数组' }
        if (!this.item) return { ok: true, value: input as T }
        const out: unknown[] = []
        for (const [i, v] of input.entries()) {
          const r = this.item.validate(v)
          if (!r.ok) return { ok: false, error: `第 ${i + 1} 项：${r.error}` }
          out.push(r.value)
        }
        return { ok: true, value: out as T }
      }
      case 'object': {
        if (!isPlainObject(input)) return { ok: false, error: '要对象' }
        if (!this.shape) return { ok: true, value: input as T }
        const out: Record<string, unknown> = {}
        for (const [key, node] of Object.entries(this.shape)) {
          const r = node.validate((input as Record<string, unknown>)[key])
          if (!r.ok) return { ok: false, error: `${key}：${r.error}` }
          out[key] = r.value
        }
        return { ok: true, value: out as T }
      }
      default:
        return { ok: true, value: input as T }
    }
  }

  /** 面板表单：object 展开成字段数组 */
  toSettings(prefix = ''): SettingsField[] {
    if (this.kind !== 'object' || !this.shape) return []
    const fields: SettingsField[] = []
    for (const [key, node] of Object.entries(this.shape)) {
      fields.push(node.toField(prefix ? `${prefix}.${key}` : key))
    }
    return fields
  }

  toField(key: string): SettingsField {
    const field: SettingsField = {
      key,
      label: this.label || this.desc || key,
      type: this.fieldType(),
    }
    if (this.hasDefault && !this.containsSecret()) field.default = this.fallback
    if (this.kind === 'object') field.fields = this.toSettings()
    if (this.item) field.item = this.item.toField('')
    if (this.intOnly) field.step = 1
    if (this.desc) field.hint = this.desc
    if (this.upper !== undefined) field.max = this.upper
    if (this.lower !== undefined) field.min = this.lower
    if (this.kind === 'union') {
      field.options = this.members.map((m) => {
        if (isPlainObject(m) && 'value' in m) {
          const item = m as { value: string; label?: string }
          return { value: String(item.value), label: item.label ?? String(item.value) }
        }
        return { value: String(m), label: String(m) }
      })
    }
    if (this.isRequired) field.required = true
    if (this.isHidden) field.hidden = true
    if (this.isDeprecated) field.deprecated = true
    if (this.isExperimental) field.experimental = true
    return field
  }

  private containsSecret(): boolean {
    return this.isSecret || Boolean(this.item?.containsSecret()) || Object.values(this.shape || {}).some(node => node.containsSecret())
  }

  private fieldType(): FieldType {
    if (this.containsSecret()) return 'password'
    if (this.kind === 'object' || this.kind === 'array') return this.kind
    if (this.kind === 'boolean') return 'boolean'
    if (this.kind === 'number') return 'number'
    if (this.kind === 'union') return 'select'
    if (this.multiline) return 'textarea'
    return 'text'
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export const Schema = {
  boolean: () => new SchemaNode<boolean>('boolean'),
  string: () => new SchemaNode<string>('string'),
  number: () => new SchemaNode<number>('number'),
  natural: () => new SchemaNode<number>('number').min(0).integer(),
  percent: () => new SchemaNode<number>('number').min(0).max(1),
  union: <T extends readonly unknown[]>(values: T) => new SchemaNode<T[number]>('union').of(...values),
  array: <S extends SchemaNode>(item: S) => new SchemaNode<unknown[]>('array').items(item),
  object: <S extends Record<string, SchemaNode>>(shape: S) =>
    new SchemaNode<Record<string, unknown>>('object').fields(shape),
}

export function isSchema(value: unknown): value is SchemaNode {
  if (value instanceof SchemaNode) return true
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<SchemaNode>
  return typeof node.validate === 'function' && typeof node.toSettings === 'function' && typeof node.defaults === 'function'
}
