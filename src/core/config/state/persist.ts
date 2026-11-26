import { reconcileOwnerEdit } from '../owners.ts'
import { constants, copyFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../../store/index.ts'
import { normalize } from './normalize.ts'
import type { AurabotConfig } from '../shape/defaults.ts'

const FILE = () => dataDir('config.json')

/** 在某次更新里新增、会替她公开发东西的功能。以后再加这类功能，把配置键名加到这里。 */
export const OPT_IN_ON_UPDATE = ['douyin']

export function loadConfig() {
  const file = FILE()
  const raw = readJson(file, {})
  if (raw && !Object.hasOwn(raw, 'owners') && (raw.ownerQQ || raw.ownerIds?.length)) {
    try { copyFileSync(file, file + '.before-platform-owners', constants.COPYFILE_EXCL) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  // 更新插件后新增的、会公开发东西的功能：老用户先关着，等他们自己在面板里打开（新安装照常默认开）
  if (raw && raw.ownerQQ) for (const k of OPT_IN_ON_UPDATE) if (raw[k] === undefined) raw[k] = { enabled: false }
  return normalize(raw)
}

export function ownerAuthorizationRevision(cfg) {
  const binding = cfg.ownerAuthorization
  return cfg.ownerQQ && binding?.owner === cfg.ownerQQ && typeof binding.revision === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(binding.revision) ? binding.revision : ''
}

// vector.mode 是 normalize 里的不可枚举派生值；JSON.stringify 会丢掉它，
// 面板切「本地/在线」就永远写不进 config.json（#520）。落盘前复制一份并把它变成可枚举字段。
function withVectorMode(c) {
  const mode = c?.memory?.vector?.mode
  // 只持久化用户显式选择过的 mode；默认 local 是从空 baseUrl 推出来的派生值，写盘后会
  // 在下次 load 被误当成 modeExplicit=true，导致旧客户端只传 baseUrl 永远切不到在线（#520）。
  if (!mode || c?.memory?.vector?.modeExplicit !== true) return c
  return { ...c, memory: { ...c.memory, vector: { ...c.memory.vector, mode } } }
}

export function saveConfig(cfg, previous = loadConfig()) {
  // 非枚举的 vector.mode 经 spread/structuredClone 会丢；调用方没显式带 mode 时，
  // 沿用上一份权威配置的 mode，避免一次无关保存把「本地」又推回 baseUrl 推断的 remote（#520 复审）。
  const input = (() => {
    const hasMode = cfg?.memory?.vector && Object.hasOwn(cfg.memory.vector, 'mode')
    const prevMode = previous?.memory?.vector?.mode
    if (hasMode || !prevMode || previous?.memory?.vector?.modeExplicit !== true) return cfg
    return { ...(cfg || {}), memory: { ...(cfg?.memory || {}), vector: { ...(cfg?.memory?.vector || {}), mode: prevMode } } }
  })()
  const c = normalize(reconcileOwnerEdit(input, previous))
  // Only the previous authoritative configuration can carry an authorization forward.
  if (c.ownerQQ) {
    const revision = c.ownerQQ === previous.ownerQQ ? ownerAuthorizationRevision(previous) : ''
    c.ownerAuthorization = { owner: c.ownerQQ, revision: revision || randomUUID() }
  } else delete c.ownerAuthorization
  writeJson(FILE(), withVectorMode(c))
  return c
}

// ---------- 面板首屏提速：配置提交版本（方案 §2.2） ----------
// 「持久化落盘 + 发布新内存配置 + configRevision 递增」收敛为一个同步提交函数 commitConfig：
// 启动初始化、面板 /save、运行期模块/命令/面板写入等各路径统一走它，保证版本号在实例内单调递增。
let configRevisionCounter = 0
/** 当前已发布配置的版本号（本次宿主实例内单调递增；重启后随新 bootId 从头计）。 */
export function configRevision() { return configRevisionCounter }
/**
 * 同步提交一份配置：落盘 + 递增版本。归一化结果与已发布配置完全一致时，不重复落盘、不递增——
 * 「只提交了没变化的字段」的面板保存回执返回接纳时的版本。返回值语义与 saveConfig 一致
 * （归一化后的配置），既有调用方（含模块 API setConfig）不受影响。
 */
export function commitConfig(cfg, previous = loadConfig()) {
  const c = saveConfig(cfg, previous)
  // JSON.stringify 看不到不可枚举的 vector.mode；比较时要把它带上，否则只切本地/在线会被当成没变化。
  if (previous && JSON.stringify(withVectorMode(c)) === JSON.stringify(withVectorMode(previous))) return previous
  configRevisionCounter++
  return c
}
