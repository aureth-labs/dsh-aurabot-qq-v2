/**
 * @aurabot/plugin-api 的运行时部分。
 *
 * 只有 `Schema` 是需要跑的代码（模块导出 `config = Schema.object({...})`，宿主按 `meta` 生成面板）。
 * 其余都是类型，见 index.d.ts。
 */

export const API_VERSION = 2

export class Schema {
  constructor(meta) {
    this.meta = meta
  }

  default(value) {
    this.meta.default = value
    return this
  }

  description(text) {
    this.meta.description = text
    return this
  }

  min(value) {
    this.meta.min = value
    return this
  }

  max(value) {
    this.meta.max = value
    return this
  }

  required() {
    this.meta.required = true
    return this
  }

  experimental() {
    this.meta.flags.push('experimental')
    return this
  }

  hidden() {
    this.meta.flags.push('hidden')
    return this
  }

  deprecated() {
    this.meta.flags.push('deprecated')
    return this
  }

  role(name) {
    this.meta.flags.push(`role:${name}`)
    return this
  }

  static string() {
    return new Schema({ type: 'string', flags: [] })
  }

  static number() {
    return new Schema({ type: 'number', flags: [] })
  }

  static natural() {
    return new Schema({ type: 'number', flags: ['natural'] })
  }

  static boolean() {
    return new Schema({ type: 'boolean', flags: [] })
  }

  static array(items) {
    return new Schema({ type: 'array', items, flags: [] })
  }

  static union(options) {
    return new Schema({ type: 'union', options, flags: [] })
  }

  static object(dict) {
    return new Schema({ type: 'object', dict, flags: [] })
  }
}
