

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type ProbeTakeoversOptions = Partial<Record<'getConfig' | 'liveIds' | 'extra', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type ApplyTakeoverOptions = Partial<Record<'getConfig' | 'setConfig' | 'probe', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type RestoreTakeoverOptions = Partial<Record<'getConfig' | 'setConfig' | 'backup', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type FindFlippedOptions = Partial<Record<'getConfig' | 'backup', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
type RepressTakeoverOptions = Partial<Record<'getConfig' | 'setConfig' | 'backup', any>>// 自驱引擎 · 浏览模块接管。

/** 常见浏览型模块的自主循环键（探测式兜底清单；不在清单里但有 autoBrowse 的也会被扫到）。 */
export const AUTONOMY_KEY = 'autoBrowse'

/** 例外表：不吃 autoBrowse 这套约定的模块，单独指定压哪个键（tophub 巡游要保留，只压分享）。 */
export const EXCEPTIONS = Object.freeze([
  { id: 'tophub', scope: 'ext', keys: [{ key: 'shareLimit', to: 0 }] },
])

/** 新旧模块的配置位置（douyin 在顶层、tophub 等在 ext.<id>；两个都查，兼容历史写法）。 */
function configOf(getConfig, id) {
  const cfg = getConfig() || {}
  const scopes = []
  if (cfg[id] && typeof cfg[id] === 'object') scopes.push({ scope: '', value: cfg[id] })
  if (cfg.ext?.[id] && typeof cfg.ext[id] === 'object') scopes.push({ scope: 'ext', value: cfg.ext[id] })
  return scopes
}

/**
 * 探测：哪些在跑的模块有「自主循环」可以压制。
 * @param {object} o
 * @param {()=>object} o.getConfig 插件配置读取
 * @param {string[]} o.liveIds 正在跑的模块 id（api.core.modules.status() 之类）
 * @param {object[]} [o.extra] 主人手动补的条目 [{id, scope, key}]
 * @returns {{id:string, scope:string, key:string, from:any}[]}  每项 = 当前会被压的一个键
 */
export function probeTakeovers({ getConfig, liveIds = [], extra = [] } : ProbeTakeoversOptions = {}) {
  const out = []
  const seen = new Set()
  const push = (id, scope, key, from) => {
    const k = `${id}|${scope}|${key}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ id, scope, key, from })
  }
  for (const id of liveIds || []) {
    // 例外表优先（tophub 这种不守约定的）
    const ex = EXCEPTIONS.find((x) => x.id === id)
    if (ex) {
      for (const { key } of ex.keys) {
        const hit = configOf(getConfig, id).find((s) => s.value?.[key] !== undefined)
        if (hit) push(id, ex.scope, key, hit.value[key])
      }
      continue
    }
    // 约定式：含 autoBrowse 键的都算自主循环家族
    const hit = configOf(getConfig, id).find((s) => s.value?.[AUTONOMY_KEY] !== undefined)
    if (hit) push(id, hit.scope, AUTONOMY_KEY, hit.value[AUTONOMY_KEY])
  }
  // 主人手动补的条目（不守约定的怪模块）
  for (const e of extra || []) {
    if (!e?.id || !e?.key) continue
    const hit = configOf(getConfig, e.id).find((s) => s.value?.[e.key] !== undefined)
    if (hit) push(e.id, hit.scope || hit.scope, e.key, hit.value[e.key])
  }
  return out
}

/** 一份压制补丁：{id, scope, key} → 写配置用的 patch 片段（scope ''=顶层，'ext'=ext.<id>）。 */
function patchOf(scope, id, key, value) {
  return scope === 'ext'
    ? { ext: { [id]: { [key]: value } } }
    : { [id]: { [key]: value } }
}

/**
 * 接管：备份原值 + 压制。
 * @param {object} o
 * @param {()=>object} o.getConfig
 * @param {(patch:object)=>void} o.setConfig
 * @param {{id,scope,key,from}[]} o.probe probeTakeovers 的结果
 * @returns {object} backup（落 ext.autotelic.takenOver，重启后据此重压）
 */
export function applyTakeover({ getConfig, setConfig, probe = [] } : ApplyTakeoverOptions = {}) {
  const backup: Record<string, any> = {}
  for (const t of probe) {
    backup[t.id] = { ...(backup[t.id] || {}), [t.key]: t.from }
    // autoBrowse 一定压 false；其它键（shareLimit）压 0 —— 都是「停止自主行为」的方向
    const to = AUTONOMY_KEY === t.key ? false : 0
    setConfig(patchOf(t.scope, t.id, t.key, to))
  }
  return backup
}

/**
 * 还原：按备份写回原值。
 * @returns {{id:string, scope:string, key:string}[]} 实际还原的键（面板/审计用）
 */
export function restoreTakeover({ getConfig, setConfig, backup = {} } : RestoreTakeoverOptions = {}) {
  const done = []
  for (const [id, keys] of Object.entries(backup || {})) {
    for (const [key, from] of Object.entries(keys || {})) {
      // 还原时按「当前配置里这个键在哪」决定 scope（防止 scope 漂移）
      // 注意 scope '' 是顶层（合法值，不能用 || 兜底成 'ext'——空串是 falsy，会写错层）
      const hit = configOf(getConfig, id).find((s) => s.value?.[key] !== undefined)
      const scope = hit ? hit.scope : 'ext'
      setConfig(patchOf(scope, id, key, from))
      done.push({ id, scope, key })
    }
  }
  return done
}

/**
 * tick 兜底：接管期间主人手动把它改回 true/非零 → 找出被翻的键（调用方负责压回 + 审计）。
 * @returns {{id:string, scope:string, key:string, got:any, want:any}[]}
 */
export function findFlipped({ getConfig, backup = {} } : FindFlippedOptions = {}) {
  const out = []
  for (const [id, keys] of Object.entries(backup || {})) {
    for (const [key, from] of Object.entries(keys || {})) {
      const hit = configOf(getConfig, id).find((s) => s.value?.[key] !== undefined)
      if (!hit) continue
      const got = hit.value[key]
      const want = AUTONOMY_KEY === key ? false : 0
      if (got !== want) out.push({ id, scope: hit.scope, key, got, want })
    }
  }
  return out
}

/**
 * 重新压制（恢复接管）：重启后调用。幂等——已经压着的就跳过。
 * @returns {{id:string, scope:string, key:string}[]} 实际压了哪些
 */
export function repressTakeover({ getConfig, setConfig, backup = {} } : RepressTakeoverOptions = {}) {
  const done = []
  for (const [id, keys] of Object.entries(backup || {})) {
    for (const [key] of Object.entries(keys || {})) {
      const hit = configOf(getConfig, id).find((s) => s.value?.[key] !== undefined)
      if (!hit) continue
      const want = AUTONOMY_KEY === key ? false : 0
      if (hit.value[key] === want) continue // 已经是压着的，别重复写
      setConfig(patchOf(hit.scope, id, key, want))
      done.push({ id, scope: hit.scope, key })
    }
  }
  return done
}

/** 面板展示：接管状态 + 原值（字符串化，别把原始类型糊到 UI 上）。 */
export function takeoverView(backup = {}) {
  const rows = []
  for (const [id, keys] of Object.entries(backup || {})) {
    for (const [key, from] of Object.entries(keys || {})) {
      rows.push({ id, key, from, text: `已压制（原 ${JSON.stringify(from)}）` })
    }
  }
  return { active: rows.length > 0, targets: rows }
}
