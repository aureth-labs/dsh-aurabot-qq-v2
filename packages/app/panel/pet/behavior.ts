import { mergeFromPanel } from '../../../../src/core/config/index.ts'

export function registerPetBehavior({ http, use, redactTokens, getConfig, setConfig, log }) {
  const { route, readBody } = http

  // ---------- 行为动作（设计稿 §8 测试通道）：面板「试一下」+ 每动作 AI 开关 + 图标隔离区 ----------
  // 全部代理到 pet 模块已暴露的函数（behaviorEmit / behaviorStatus / iconQuarantine / iconRestore）；
  // 模块没就绪或旧版本缺接口时降级 available:false，面板显示兜底文案不炸。
  route('/panel/pet/behavior/status', async () => {
    const pet = use('pet')
    if (typeof pet?.behaviorStatus !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪' }
    return { ok: true, behavior: redactTokens(pet.behaviorStatus()) }
  })
  // 「试一下」：手动触发默认 force=true（绕排程/专注/安静时段；桌宠离线时回执会显示 refused/failed）
  route('/panel/pet/behavior', async (req) => {
    const b = await readBody(req)
    const pet = use('pet')
    if (typeof pet?.behaviorEmit !== 'function')
      return { ok: false, available: false, message: '桌宠模块还没就绪，试不了' }
    const r = await pet.behaviorEmit({
      action: b.action,
      params: b.params,
      say: b.say,
      force: b.force !== false,
      reason: 'panel',
    })
    const why = {
      'unknown-action': '没有这个动作',
      'emit-failed': '下发失败（看日志）',
      // 关窗物理闸：说清去哪里开，否则面板上只看到「这轮没演成」
      'close-window-disabled':
        '先在「行为与安全」卡里打开「允许 AI 关闭窗口」（物理闸，手动「试一下」也绕不过）',
      'empty-text': '「说话」动作要给一句台词再试',
    }
    return {
      ok: Boolean(r && r.ok),
      reason: (r && r.reason) || '',
      message:
        r && r.ok
          ? `已下发「${r.action}」${r.say ? `：${r.say}` : ''}，桌宠在跑就会演`
          : why[r?.reason] || '这轮没演成',
      result: redactTokens(r),
    }
  })
  // 每动作「进不进 AI 动作表」：写 ext.pet.behaviorDisabledActions（逗号分隔），与模块 settings 单一真相
  route('/panel/pet/behavior/actions', async (req) => {
    const b = await readBody(req)
    const action = String(b.action || '')
      .trim()
      .slice(0, 40)
    if (!action) return { ok: false, message: '缺动作名' }
    // 动作名白名单（来自模块的全表）：防止手滑/旧面板把垃圾动作名写进配置
    try {
      const st = use('pet')?.behaviorStatus?.()
      const known = new Set([...(st?.openActions || []), ...(st?.deferredActions || [])])
      if (known.size && !known.has(action)) return { ok: false, message: '没有这个动作：' + action }
    } catch (error) {
      /* 模块没就绪就不校验，别把开关卡死 */
    }
    const cur = new Set(
      String(getConfig().ext?.pet?.behaviorDisabledActions || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    if (b.on === false) cur.add(action)
    else cur.delete(action)
    setConfig(mergeFromPanel(getConfig(), { ext: { pet: { behaviorDisabledActions: [...cur].join(',') } } }))
    log.info(`面板已改 AI 动作表｜${action} → ${b.on === false ? '禁用' : '启用'}`)
    return { ok: true, disabledActions: [...cur] }
  })
  // 图标隔离区清单：{items:[{id,name,originalPath,at,reason}]}
  route('/panel/pet/behavior/quarantine', async () => {
    const pet = use('pet')
    if (typeof pet?.iconQuarantine !== 'function')
      return { ok: false, available: false, message: '图标隔离区接口还没就绪' }
    try {
      return { ok: true, items: pet.iconQuarantine() || [] }
    } catch (error) {
      return { ok: false, available: false, message: '隔离区清单读不了：' + String(error?.message || error) }
    }
  })
  // 「放回去」：rename 回原路径（原位置被占则改名），失败按原因给人话，别让面板只挂一句「没放回去」
  route('/panel/pet/behavior/restore', async (req) => {
    const b = await readBody(req)
    const pet = use('pet')
    if (typeof pet?.iconRestore !== 'function')
      return { ok: false, available: false, message: '归还接口还没就绪' }
    const r = await pet.iconRestore(String(b.id || '').slice(0, 64))
    const why = {
      'not-found': '隔离区里没有这条记录（可能已经放回去了）',
      'quarantine-file-gone': '隔离区里的文件已经不在了，这条记录已清掉',
      'restore-failed': '放回去失败（看日志）',
    }
    return {
      ok: Boolean(r && r.ok),
      message:
        r && r.ok ? `「${r.name}」放回去了` : why[r?.reason] || '没放回去：原位置可能没了，或图标已经被移走',
      result: redactTokens(r),
    }
  })

  // 第三批：补偿道歉（心情 +8，并标记最近一条未道歉的关窗记录；不删记录）
  route('/panel/pet/behavior/apologize', async () => {
    const pet = use('pet')
    if (typeof pet?.windowApologize !== 'function')
      return { ok: false, available: false, message: '道歉接口还没就绪' }
    try {
      const r = pet.windowApologize()
      return {
        ok: Boolean(r && r.ok),
        message: r && r.ok ? (r.window ? `她为「${r.window}」道了歉` : '她道了歉') : '没有需要道歉的记录',
        result: redactTokens(r),
      }
    } catch (error) {
      return { ok: false, message: '道歉没成功：' + String(error?.message || error) }
    }
  })
}
