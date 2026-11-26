import { loadConfig, mergeFromPanel } from '../../../../src/core/config/index.ts'
import { normalizeWorkspace } from '../../../../src/features/notices/index.ts'
import { normalizeSelection } from '../../../../src/chat/hub/store/chat-model.ts'

export function registerActivityRoutes({
  http,
  purposeOverview,
  petStatus,
  getModels,
  use,
  redactTokens,
  workspaceList,
  setConfig,
  getConfig,
  mods,
  log,
}) {
  const { route, readBody } = http

  // ---------- 面板代理：目的引擎 / 桌宠 ----------
  // 统一走 /panel/* 前缀，避免和模块自注册的 /purpose/*、/pet/* 路由撞名；模块缺新接口时降级返回 available:false。
  route('/panel/purpose/status', async () => ({
    ok: true,
    purpose: purposeOverview(),
    pet: petStatus(),
    // 「素材打分模型」下拉的选项：DSH 里现有的全部模型（provider/model/name）。
    models: (getModels() || []).map((m) => ({
      provider: m.provider,
      model: m.model,
      name: m.name || m.model,
    })),
  }))
  route('/panel/purpose/preview', async () => {
    const pu = use('purpose')
    if (typeof pu?.preview !== 'function')
      return { ok: false, available: false, message: '目的引擎模块没在跑，没法预览' }
    return { ok: true, result: redactTokens(await pu.preview()) }
  })
  route('/panel/purpose/run', async () => {
    const pu = use('purpose')
    if (typeof pu?.run !== 'function') return { ok: false, available: false, message: '目的引擎模块没在跑' }
    const r = await pu.run('面板')
    const msg =
      r &&
      {
        sent: '已经去找你了',
        silent: '她这轮想了想，决定不说（不硬发）',
        muted: '主人在私聊里让她闭嘴了',
        disabled: '目的引擎开关是关的',
      }[r.outcome]
    return {
      ok: !r || r.outcome !== 'disabled',
      message: msg || (r ? `这轮结束：${r.outcome}` : '没有结果'),
      result: redactTokens(r),
    }
  })
  // 上报开关：按工作区分别控制「审批」「提问」要不要发到 QQ
  route('/notice/state', async () => {
    const c = loadConfig()
    const n: Record<string, any> = c.notice || {}
    const workspaces = workspaceList().map((w) => {
      const path = String(w?.path || '')
      const key = normalizeWorkspace(path)
      const o = n.workspaces?.[key] || {}
      return {
        path,
        name: String(w?.name || path.split(/[\\/]/).filter(Boolean).pop() || path),
        sessions: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
        approval: typeof o.approval === 'boolean' ? o.approval : n.approval !== false,
        question: typeof o.question === 'boolean' ? o.question : n.question !== false,
      }
    })
    return {
      ok: true,
      enabled: n.enabled !== false,
      approval: n.approval !== false,
      question: n.question !== false,
      workspaces,
    }
  })
  route('/notice/toggle', async (req) => {
    const b = await readBody(req)
    const kind = b.kind === 'question' ? 'question' : 'approval'
    const value = b.value !== false
    const c = loadConfig()
    const notice = { ...(c.notice || {}) }
    notice.workspaces = { ...(notice.workspaces || {}) }
    const ws = String(b.workspace || '').trim()
    if (ws) {
      // 只接受绝对路径：相对路径（../x、foo/bar）写进配置只会变成永远对不上的键
      if (!/^([a-zA-Z]:[\\/]|\/)/.test(ws)) return { ok: false, message: 'workspace 必须是绝对路径' }
      const key = normalizeWorkspace(ws)
      notice.workspaces[key] = { ...(notice.workspaces[key] || {}), [kind]: value }
    } else {
      notice[kind] = value
    }
    // 带上整份配置：保存时只和默认值合并，只传 notice 会把其他设置全重置
    setConfig({ ...getConfig(), notice })
    return { ok: true, notice }
  })
  route('/panel/purpose/config', async (req) => {
    const b = await readBody(req)
    const patch: Record<string, any> = {}
    const extPatch: Record<string, any> = {}
    if (typeof b.enabled === 'boolean') extPatch.enabled = b.enabled
    // 追问开关（P1 翻键）：写入口从 speakUp.nudge 翻到 ext.purpose.nudge（读侧 purposeConfig 双层兼容）。
    if (typeof b.nudge === 'boolean') extPatch.nudge = b.nudge
    if (b.carrier === 'qq' || b.carrier === 'pet') extPatch.carrier = b.carrier
    if (typeof b.petFallbackToQQ === 'boolean') extPatch.petFallbackToQQ = b.petFallbackToQQ
    if (['conservative', 'default', 'active'].includes(b.pacing)) extPatch.pacing = b.pacing
    // 素材打分模型：与「按聊天选模型」同款结构校验（provider+model 都有才算数；传空对象/坏值 = 清除）
    if (b.scoringModel !== undefined) extPatch.scoringModel = normalizeSelection(b.scoringModel) || {}
    if (Object.keys(extPatch).length) patch.ext = { purpose: extPatch }
    const spPatch: Record<string, any> = {}
    for (const k of ['awakeFrom', 'awakeTo', 'maxPerDay'])
      if (Number.isFinite(b[k])) spPatch[k] = Math.max(0, Math.floor(b[k]))
    if (Object.keys(spPatch).length) patch.speakUp = spPatch
    if (!Object.keys(patch).length) return { ok: false, message: '没有可保存的字段' }
    setConfig(mergeFromPanel(getConfig(), patch, mods?.fields))
    log.info(
      `面板已保存目的引擎设置｜${Object.keys(extPatch)
        .map((k) => k + '=' + extPatch[k])
        .concat(Object.keys(spPatch).map((k) => k + '=' + spPatch[k]))
        .join(' ')}`,
    )
    return { ok: true, purpose: purposeOverview() }
  })
  route('/panel/pet/status', async () => ({ ok: true, pet: petStatus() }))
}
