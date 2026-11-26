// S8：一份插件多份配置。主实例仍是模块 id，额外实例是 `id@名字`，
// 配置在 ext.<id>.instances，每个实例各跑一遍 apply、各有自己的设置/路由/数据目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModules } from '../../src/core/module/index.ts'

const silent = { info() {}, debug() {}, warn() {}, error() {} }

function fixture(t, ext = {}, builtins = []) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-instances-'))
  const previousDir = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = dir
  let cfg = { modules: {}, ext, safeMode: false, debug: false }
  const warnings = []
  const modules = createModules({
    ctx: {},
    core: {},
    getConfig: () => cfg,
    setConfig: (next) => { cfg = next },
    logger: { child: () => ({ ...silent, warn: (...args) => warnings.push(args.join(' ')) }) },
    version: 'test',
    builtins,
  })
  t.after(() => {
    modules.dispose()
    if (previousDir === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = previousDir
  })
  return {
    dir,
    modules,
    warnings,
    config: () => cfg,
    setExt(next) { cfg = { ...cfg, ext: { ...cfg.ext, ...next } } },
    write(id, code) {
      const path = join(dir, 'modules', id)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'index.mjs'), code)
    },
  }
}

/** 模块代码：把每次 apply 的设置、id、数据目录都记到 globalThis 上，供断言读取。 */
function multiModuleSource(key, { reusable = true } = {}) {
  return `
    const state = globalThis[${JSON.stringify(key)}]
    export const name = 'multi'
    export const reusable = ${reusable}
    export const kind = 'adapter'
    export const settings = [{ key: 'tag', label: 'Tag' }]
    export function apply(ctx, config) {
      state.runs.push({ id: ctx.id, tag: ctx.config.tag, dir: ctx.dataDir() })
      ctx.server.get('/who', () => ({ tag: ctx.config.tag }))
      return { dispose() { state.disposed++ } }
    }
  `
}

function state(t, modules, key) {
  const previous = globalThis[key]
  const value = { runs: [], disposed: 0 }
  globalThis[key] = value
  t.after(() => {
    if (previous === undefined) delete globalThis[key]
    else globalThis[key] = previous
  })
  return { value, get: () => globalThis[key] }
}

test('内置适配器与独立包共用异步启动、实例配置及卸载', async t => {
  const stopped = []
  const plugin = {
    id: 'transport', name: 'Transport', kind: 'adapter', reusable: true,
    async apply(ctx, config) {
      await Promise.resolve()
      return { tag: config.tag, dispose: () => stopped.push(ctx.instanceId) }
    },
  }
  const f = fixture(t, { transport: { tag: 'main', instances: [{ id: 'other', config: { tag: 'other' } }] } }, [plugin])
  await f.modules.boot()
  assert.equal(f.modules.use('transport').tag, 'main')
  assert.deepEqual(f.modules.instances('transport'), ['other'])
  f.modules.stop('transport')
  assert.deepEqual(stopped.sort(), ['transport', 'transport@other'])
})

test('reusable 插件：ext.<id>.instances 里的每个实例各跑一遍 apply', async (t) => {
  const f = fixture(t)
  await f.modules.boot()

  const key = '__aurabot_instances_' + randomUUID()
  const s = state(t, f.modules, key)
  f.write('multi', multiModuleSource(key))
  f.setExt({ multi: { enabled: true, tag: 'base', instances: [{ id: 'second', config: { tag: 'two' } }] } })

  await f.modules.sync()

  assert.deepEqual(s.get().runs.map((run) => run.tag), ['base', 'two'], '主实例 + 一个额外实例都要启动')
  assert.deepEqual(f.modules.instances('multi'), ['second'])
  // 同一份代码，id 仍是模块 id
  assert.deepEqual([...new Set(s.get().runs.map((run) => run.id))], ['multi'])
  // 数据目录分开：两个实例不能抢同一个文件夹
  assert.notEqual(s.get().runs[0].dir, s.get().runs[1].dir)
  // 路由各挂各的：主实例 /ext/multi，额外实例 /ext/multi/i/second
  assert.equal(f.modules.hasRoute('/aurabot/api/ext/multi/who'), true)
  assert.equal(f.modules.hasRoute('/aurabot/api/ext/multi/i/second/who'), true)

  const second = (f.modules.status().find((m) => m.id === 'multi') || {}).instances || []
  assert.equal(second.length, 1)
  assert.equal(second[0].id, 'second')
  assert.equal(second[0].running, 'user')
})

test('改实例配置 → 只重启那个实例；删实例 → 停掉它', async (t) => {
  const f = fixture(t)
  await f.modules.boot()

  const key = '__aurabot_instances_' + randomUUID()
  const s = state(t, f.modules, key)
  f.write('multi', multiModuleSource(key))
  f.setExt({
    multi: {
      enabled: true,
      tag: 'base',
      instances: [
        { id: 'second', config: { tag: 'two' } },
        { id: 'third', config: { tag: 'three' } },
      ],
    },
  })
  await f.modules.sync()
  assert.deepEqual(s.get().runs.map((run) => run.tag), ['base', 'two', 'three'])
  const disposedBefore = s.get().disposed
  const startedBefore = s.get().runs.length

  // 只改 second 的参数：second 重启，third 不动
  f.setExt({
    multi: {
      ...f.config().ext.multi,
      instances: [
        { id: 'second', config: { tag: 'two-changed' } },
        { id: 'third', config: { tag: 'three' } },
      ],
    },
  })
  await f.modules.sync()
  // 只多出 two-changed 一条：third 没被无谓重启
  assert.deepEqual(s.get().runs.slice(startedBefore).map((run) => run.tag), ['two-changed'])
  assert.deepEqual(f.modules.instances('multi').sort(), ['second', 'third'])
  assert.ok(s.get().disposed > disposedBefore, '改配置要真的卸掉旧实例')

  // 删掉 third：只剩 second
  f.setExt({ multi: { ...f.config().ext.multi, instances: [{ id: 'second', config: { tag: 'two-changed' } }] } })
  await f.modules.sync()
  assert.deepEqual(f.modules.instances('multi'), ['second'])
  assert.equal(f.modules.hasRoute('/aurabot/api/ext/multi/i/third/who'), false)
})

test('没声明 reusable 的插件：配置里写了 instances 也不起额外实例', async (t) => {
  const f = fixture(t)
  await f.modules.boot()

  const key = '__aurabot_instances_' + randomUUID()
  const s = state(t, f.modules, key)
  f.write('multi', multiModuleSource(key, { reusable: false }))
  f.setExt({ multi: { enabled: true, tag: 'base', instances: [{ id: 'second', config: { tag: 'two' } }] } })

  await f.modules.sync()

  assert.deepEqual(s.get().runs.map((run) => run.tag), ['base'])
  assert.deepEqual(f.modules.instances('multi'), [])
  assert.equal(f.modules.hasRoute('/aurabot/api/ext/multi/i/second/who'), false)
})

test('实例名写坏了（重复 / 非法）：忽略脏数据，主实例照常跑', async (t) => {
  const f = fixture(t)
  await f.modules.boot()

  const key = '__aurabot_instances_' + randomUUID()
  const s = state(t, f.modules, key)
  f.write('multi', multiModuleSource(key))
  f.setExt({
    multi: {
      enabled: true,
      tag: 'base',
      instances: [
        { id: 'ok', config: { tag: 'ok' } },
        { id: 'ok', config: { tag: 'dup' } },
        { id: 'bad name', config: { tag: 'bad' } },
        null,
        { config: { tag: 'nameless' } },
      ],
    },
  })

  await f.modules.sync()

  assert.deepEqual(s.get().runs.map((run) => run.tag), ['base', 'ok'])
  assert.deepEqual(f.modules.instances('multi'), ['ok'])
})
