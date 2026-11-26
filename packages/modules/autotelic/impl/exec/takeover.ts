import { deepMerge, isObj, type RawConfig } from '../../../../../src/core/config/state/shared.ts'

type Scope = '' | 'ext'
type Address = { id: string; key: string; scope: Scope }
type Target = Address & { from: unknown }
type Backup = Record<string, RawConfig>
type Read = { getConfig(): RawConfig }
type Access = Read & { setConfig(patch: RawConfig): void }

export const AUTONOMY_KEY = 'autoBrowse'
export const EXCEPTIONS = [{ id: 'tophub', scope: 'ext', keys: [{ key: 'shareLimit', to: 0 }] }] as const

function record(value: unknown): RawConfig {
  return isObj(value) ? value : {}
}

function targetOf(config: RawConfig, id: string, key: string): Target | undefined {
  const ext = record(config.ext)
  for (const scope of ['', 'ext'] as const) {
    const options = record((scope ? ext : config)[id])
    if (Object.hasOwn(options, key)) return { id, key, scope, from: options[key] }
  }
}

function patchOf({ scope, id, key }: Address, value: unknown): RawConfig {
  const options = { [id]: { [key]: value } }
  return scope === 'ext' ? { ext: options } : options
}

export function probeTakeovers({ getConfig, liveIds = [], extra = [] }: Read & {
  liveIds?: string[]
  extra?: { id: string; key: string }[]
}) {
  const config = getConfig()
  const found = new Map<string, Target>()
  function add(id: string, key: string) {
    const target = targetOf(config, id, key)
    if (target) found.set(JSON.stringify([id, key]), target)
  }
  for (const id of liveIds) {
    const exception = EXCEPTIONS.find(item => item.id === id)
    if (exception) for (const { key } of exception.keys) add(id, key)
    else add(id, AUTONOMY_KEY)
  }
  for (const item of extra) if (item?.id && item.key) add(item.id, item.key)
  return [...found.values()]
}

function suppressed(key: string) { return key === AUTONOMY_KEY ? false : 0 }

export function applyTakeover({ setConfig, probe }: Access & { probe: Target[] }): Backup {
  const backup: Backup = {}
  for (const target of probe) {
    backup[target.id] = { ...backup[target.id], [target.key]: target.from }
    setConfig(patchOf(target, suppressed(target.key)))
  }
  return backup
}

function savedValues(backup: unknown) {
  return Object.entries(record(backup)).flatMap(([id, keys]) =>
    Object.entries(record(keys)).map(([key, from]) => ({ id, key, from })))
}

export function restoreTakeover({ getConfig, setConfig, backup }: Access & { backup: unknown }) {
  const done: Address[] = []
  for (const { id, key, from } of savedValues(backup)) {
    const target = targetOf(getConfig(), id, key)
    if (!target) continue
    setConfig(patchOf(target, from))
    done.push({ id, key, scope: target.scope })
  }
  return done
}

export function findFlipped({ getConfig, backup }: Read & { backup: unknown }) {
  const config = getConfig()
  return savedValues(backup).flatMap(({ id, key }) => {
    const target = targetOf(config, id, key)
    const want = suppressed(key)
    return target && target.from !== want ? [{ id, key, scope: target.scope, got: target.from, want }] : []
  })
}

export function repressTakeover(options: Access & { backup: unknown }) {
  const changed = findFlipped(options)
  for (const target of changed) options.setConfig(patchOf(target, target.want))
  return changed.map(({ id, key, scope }) => ({ id, key, scope }))
}

export function takeoverView(backup: unknown) {
  const targets = savedValues(backup).map(row => ({ ...row, text: '已压制（原 ' + JSON.stringify(row.from) + '）' }))
  return { active: targets.length > 0, targets }
}

export function changeTakeover(config: RawConfig, targets: Target[] | null) {
  const current = record(record(config.ext).autotelic)
  let next = config
  const access = { getConfig: () => next, setConfig: (patch: RawConfig) => { next = deepMerge(next, patch) } }
  const backup = targets ? applyTakeover({ ...access, probe: targets }) : {}
  if (!targets) restoreTakeover({ ...access, backup: current.takenOver })
  const ext = record(next.ext)
  return { ...next, ext: { ...ext, autotelic: { ...record(ext.autotelic), takeover: targets !== null, takenOver: backup } } }
}
