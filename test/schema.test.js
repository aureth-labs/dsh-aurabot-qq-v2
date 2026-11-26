// S2 契约：一份 Schema 同时产出默认值、面板字段和校验结果。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Schema, isSchema } from '../src/core/config/schema.ts'

const config = Schema.object({
  enabled: Schema.boolean().default(true).description('总开关'),
  source: Schema.union(['both', 'bilibili', 'netease']).default('both'),
  maxMinutes: Schema.natural().min(4).max(30).default(10),
  apiKey: Schema.string().role('secret').description('API Key'),
  legacy: Schema.string().default('').deprecated(),
  beta: Schema.boolean().default(false).experimental(),
})

test('默认值从 Schema 派生', () => {
  assert.deepEqual(config.defaults(), {
    enabled: true,
    source: 'both',
    maxMinutes: 10,
    apiKey: '',
    legacy: '',
    beta: false,
  })
})

test('面板字段：secret 走 password，union 走 select，标记位带过去', () => {
  const fields = Object.fromEntries(config.toSettings().map((f) => [f.key, f]))
  assert.equal(fields.enabled.type, 'boolean')
  assert.equal(fields.apiKey.type, 'password')
  assert.equal(fields.source.type, 'select')
  assert.deepEqual(fields.source.options.map((o) => o.value), ['both', 'bilibili', 'netease'])
  assert.equal(fields.maxMinutes.type, 'number')
  assert.equal(fields.maxMinutes.min, 4)
  assert.equal(fields.maxMinutes.max, 30)
  assert.equal(fields.legacy.deprecated, true)
  assert.equal(fields.beta.experimental, true)
  assert.equal(fields.enabled.label, '总开关')
})

test('校验：类型、范围、枚举、必填', () => {
  assert.equal(config.validate({ maxMinutes: 5 }).ok, true)
  assert.equal(config.validate({ maxMinutes: 3 }).ok, false)
  assert.equal(config.validate({ maxMinutes: 99 }).ok, false)
  assert.equal(config.validate({ maxMinutes: 6.5 }).ok, false, 'natural 要整数')
  assert.equal(config.validate({ source: 'qq' }).ok, false)
  assert.equal(config.validate({ source: 'netease' }).ok, true)
  assert.equal(config.validate({ enabled: 'false' }).value.enabled, false)

  const needKey = Schema.object({ apiKey: Schema.string().required() })
  assert.equal(needKey.validate({}).ok, false)
  assert.match(needKey.validate({}).error, /apiKey/)
})

test('未填的字段回落默认值，已填的保留', () => {
  const r = config.validate({ enabled: false, maxMinutes: 20 })
  assert.equal(r.ok, true)
  assert.equal(r.value.enabled, false)
  assert.equal(r.value.maxMinutes, 20)
  assert.equal(r.value.source, 'both')
  assert.equal(r.value.apiKey, '')
})

test('数组与嵌套对象', () => {
  const cfg = Schema.object({
    tags: Schema.array(Schema.string()).default([]),
    nested: Schema.object({ port: Schema.natural().max(65535).default(8080) }).default({}),
  })
  assert.deepEqual(cfg.defaults(), { tags: [], nested: {} })
  const ok = cfg.validate({ tags: ['a', 'b'], nested: { port: 9000 } })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.nested.port, 9000)
  assert.equal(cfg.validate({ tags: [1, {}] }).ok, false)
  assert.equal(cfg.validate({ nested: { port: 70000 } }).ok, false)
})

test('isSchema 只认自家节点', () => {
  assert.equal(isSchema(config), true)
  assert.equal(isSchema({ type: 'object' }), false)
  assert.equal(isSchema(null), false)
})
