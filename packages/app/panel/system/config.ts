import { configRevision, mergeFromPanel } from '../../../../src/core/config/index.ts'
import { validMemberFilter } from '../../../../src/chat/inbound/filter/member-filter.ts'
import { isDeepStrictEqual } from 'node:util'
import { clearReasoningCache, clearVisionCache } from '../../../../src/core/llm/index.ts'

export function registerConfigRoutes({ bootId, http, getConfig, setConfig, mods, log, hub, overview }) {
  const { route, readBody } = http

  // JSON Pointer（RFC 6901）小工具：保存回执按 /voice/enabled 这类路径逐字段确认（方案 §2.2）。
  const pointerGet = (obj, pointer) =>
    String(pointer || '')
      .split('/')
      .slice(1)
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
  // 面板提交体 → 提交字段路径：对象逐层展开；数组按整字段确认（不拆下标）；空对象也算整字段。
  const pointerPaths = (v, prefix = '') => {
    if (prefix && (Array.isArray(v) || v === null || typeof v !== 'object')) return [prefix]
    if (!v || typeof v !== 'object' || Array.isArray(v)) return prefix ? [prefix] : []
    const keys = Object.keys(v)
    if (!keys.length) return prefix ? [prefix] : []
    return keys.flatMap((k) => pointerPaths(v[k], prefix + '/' + k.replace(/~/g, '~0').replace(/\//g, '~1')))
  }
  // 校验失败的回执：没有发生任何提交，committed/unchanged 都是空、版本取当前值（原返回形状不变，只多字段）。
  const saveEnvelope = (body) => ({
    bootId,
    configRevision: configRevision(),
    committedPaths: [],
    unchangedPaths: [],
    ...body,
  })

  route('/save', async (req) => {
    const body = await readBody(req)
    // 面板草稿可能早于 QQ 的 /quiet /chatty；拒绝覆盖期间改过的群设置。
    // 只检查新版面板显式附带的基线，旧版和模块的局部保存维持原约定。
    if (body?.memory && Object.hasOwn(body.memory, 'passiveGroups')) {
      const raw = body.memory.passiveGroups
      const ids = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(/[\s,，;；]+/).filter(Boolean)
          : null
      if (!ids || ids.some((id) => !/^[1-9]\d{4,11}$/.test(String(id).trim())))
        return saveEnvelope({
          ok: false,
          code: 'invalid_passive_groups',
          message: '旁听名单请填 5～12 位数字群号，用换行或逗号分隔，不要混入文字。本次没有保存。',
        })
    }
    for (const ids of [
      body?.group?.moduleOnlyGroups,
      ...(body?._groupSettingsBase?.groups ? [body?.allow?.groups] : []),
    ]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !/^[1-9]\d{4,11}$/.test(String(id)))))
        return saveEnvelope({
          ok: false,
          code: 'invalid_group_ids',
          message: '群号请填 5～12 位数字，不要混入文字。本次没有保存。',
        })
    }
    if (body && Object.hasOwn(body, 'memberFilter') && !validMemberFilter(body.memberFilter))
      return saveEnvelope({
        ok: false,
        code: 'invalid_member_filter',
        message:
          '不回应名单未保存：请填有效的 QQ 号和群号（5～12 位数字），每人只添加一次，并明确选择所有群或指定群；最多 100 人、每人 100 个群。',
      })
    const expected = body?._groupSettingsBase
    if (body) delete body._groupSettingsBase
    if (
      expected &&
      ((Object.hasOwn(expected, 'groups') && !isDeepStrictEqual(expected.groups, getConfig().allow.groups)) ||
        (Object.hasOwn(expected, 'memberFilter') &&
          !isDeepStrictEqual(expected.memberFilter, getConfig().memberFilter)) ||
        (Object.hasOwn(expected, 'group') && !isDeepStrictEqual(expected.group, getConfig().group)) ||
        (Object.hasOwn(expected, 'passiveGroups') &&
          !isDeepStrictEqual(expected.passiveGroups, getConfig().memory.passiveGroups)))
    )
      return saveEnvelope({
        ok: false,
        code: 'group_settings_conflict',
        message: '群设置已在别处修改，本次没有保存。请记下要保留的改动，再点「读取最新设置」放弃草稿。',
      })
    const before = getConfig()
    // ---- 保存回执（方案 §2.2）：按提交前后（归一化后）的实际结果逐字段确认。 ----
    // 提交字段路径先收集，分类在下面 setConfig 之后做（提交前 cfg===before，分类会全落 unchanged）。
    const submittedPaths = pointerPaths(body)
    setConfig(mergeFromPanel(getConfig(), body, mods?.fields))
    // committed/unchanged 分类必须在提交之后：commitConfig 返回新的归一化对象（变化时），
    // 逐字段对比 before（提交前）与 cfg（提交后）——真写了的进 committedPaths，
    // 显式提交但值相同（含 mergeFromPanel 归一化后等值）的进 unchangedPaths（草稿别一直标脏）。
    const committedPaths = []
    const unchangedPaths = []
    for (const p of submittedPaths) {
      if (isDeepStrictEqual(pointerGet(getConfig(), p), pointerGet(before, p))) unchangedPaths.push(p)
      else committedPaths.push(p)
    }
    // 本次请求的回执（定义在提交之后、使用之前）：
    // 版本 = 本次请求触发的全部同步提交后的最高版本；
    // 异步回执不得借用别的请求版本，所以在这里闭包当场取值。
    const saveReceipt = () => ({ bootId, configRevision: configRevision(), committedPaths, unchangedPaths })
    // 换了模型：思考强度和「能不能看图」的探测结果都得重来，不然要等 10 分钟缓存过期
    const changedModel =
      before.model.provider !== getConfig().model.provider || before.model.model !== getConfig().model.model
    if (changedModel) {
      clearReasoningCache()
      clearVisionCache()
    }
    log.info(
      `设置已保存｜总开关 ${getConfig().enabled ? '开' : '关'}｜调试 ${getConfig().debug ? '开' : '关'}`,
    )
    await mods.sync().catch(() => {})
    // 模块启停 / 生图开关变化后工具清单可能变了：已挂载的会话重新挂一遍
    try {
      hub.remountAll?.('设置已保存')
    } catch (error) {
      log.debug('重挂工具失败：', error.message)
    }
    let debugNote = ''
    if (getConfig().debug) {
      try {
        const d = await hub.ensureDebugSession()
        debugNote = d.created ? '，调试会话已建好' : ''
      } catch (error) {
        log.debug('建调试会话失败：', error.message)
      }
    }
    return { ...(await overview()), ...saveReceipt(), message: '保存好了' + debugNote }
  })
}
