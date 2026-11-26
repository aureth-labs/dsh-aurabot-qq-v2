import { registerOutboundPanelRoutes } from '../../outbound-panel.ts'

export function registerOutboundPolicyRoutes({ http, getConfig, setConfig, outbound, log }) {
  const { route, readBody } = http

  // ---------- 面板：主动发言出站策略 ----------
  // 契约要求的两个精确路径：GET /panel/outbound-policy（读）与 POST /panel/outbound-policy（写）。
  // route 是精确路径匹配（AGENTS.md §4-4），所以读写各注册一条，不做前缀/通配。
  //
  // 读：档位、策略源四态与原因、「尚未纳管」提示、分类统计、账本概览。
  route('/panel/outbound-policy', async (req) => {
    // 带 body 的 POST 走下面的写分支；DSH 的 route 只按路径分发，这里按方法区分读写。
    if (String(req?.method || 'GET').toUpperCase() === 'POST') return saveOutboundPolicy(req)
    return outboundView()
  })
  // 写：档位（pass/gate/broker）与活跃策略源选择（auto/purpose/speakup）。
  // 注意 ：面板只暴露当前真实能力，档位切换不改写已有账本条目。
  function saveOutboundPolicy(req) {
    return readBody(req).then((b) => {
      const patch: Record<string, any> = {}
      if (['pass', 'gate', 'broker'].includes(b.tier)) patch.tier = b.tier
      // P3 存量归一化：老面板/老配置提交的 'speakup' 落盘为 'purpose'（不弹错、行为等价）
      const wantActive = b.activePolicy === 'speakup' ? 'purpose' : b.activePolicy
      if (['auto', 'purpose'].includes(wantActive)) patch.activePolicy = wantActive
      if (!Object.keys(patch).length)
        return {
          ok: false,
          message: '没有可保存的字段（tier 只认 pass/gate/broker，activePolicy 只认 auto/purpose）',
          outbound: outboundView().outbound,
        }
      const now = getConfig()
      const cur = (now.ext && now.ext.outboundPolicy) || {}
      setConfig({ ...now, ext: { ...now.ext, outboundPolicy: { ...cur, ...patch } } })
      if (patch.activePolicy) outbound?.setActivePolicy?.(patch.activePolicy)
      log.info(
        `面板已保存出站策略｜${Object.keys(patch)
          .map((k) => k + '=' + patch[k])
          .join(' ')}`,
      )
      return outboundView()
    })
  }
  /** 面板统一返回体：服务没装配时 outbound 为 null（面板显示「尚未纳管」引导）。 */
  function outboundView() {
    let status = null
    try {
      status = outbound ? outbound.status() : null
    } catch (error) {
      log.warn('出站策略读状态失败：', error && error.message)
    }
    return { ok: true, outbound: status, view: outboundPanelView(status) }
  }
  const { outboundPanelView } = registerOutboundPanelRoutes({ route, getConfig, log })
}
