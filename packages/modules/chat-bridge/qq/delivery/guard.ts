// 主动发言出站门闸（见 docs/OUTBOUND-POLICY-DESIGN.md / CONTRACT §4）。
// 宿主装配时经 setOutboundGuard 注入；未注入时（纯测试 / 旧环境）为 null，发送路径逐字节等价于改造前。
// 约定：guard(ask) 返回 null = 拦下；返回对象 = 放行，可带 settle(outcome) 供 hub 结算预占。

export function createOutboundGuard({ log }: { log: any }) {
  let outboundGuard: any = null

  /** 注入门闸判定函数。传 null 可撤销（测试 / 热重载用）。 */
  function setOutboundGuard(fn: any) {
    outboundGuard = typeof fn === 'function' ? fn : null
    return outboundGuard !== null
  }

  /**
   * 这条发送要不要过门闸：
   * - 没注入门闸（旧环境 / 纯测试）→ 不过；
   * - `outboundDone` 为真 → 上游（模块包装层）已判过并会自己结算，别再判一次；
   * - 只有带 `sourceModule`（模块发起）或显式 `enginePolicy`（引擎路径）才归治理管。
   */
  function wantsOutbound(opts: any) {
    if (!outboundGuard || !opts) return false
    if (opts.outboundDone) return false
    return Boolean(opts.sourceModule || opts.enginePolicy)
  }

  /** 门闸判定：门闸自己抛错按放行处理（治理故障不得阻断正常回复）。 */
  function passOutbound(ask: any) {
    if (!outboundGuard) return { action: 'allow', reason: 'no-guard' }
    try {
      const r = outboundGuard(ask)
      return r === null ? { action: 'deny', reason: 'guard-null' } : (r || { action: 'allow', reason: 'guard-ok' })
    } catch (error: any) {
      log.warn('出站门闸判定出错，本条按放行处理：', error && error.message)
      return { action: 'allow', reason: 'guard-error' }
    }
  }

  /** 结算一次门闸预占（sent / failed）。预占不结算会一直挂着，所以放行后必须回调。 */
  function settleOutbound(verdict: any, outcome: any) {
    const settle = verdict && verdict.settle
    if (typeof settle !== 'function') return
    try {
      settle(outcome)
    } catch (error: any) {
      log.warn(`出站结算失败（${outcome}）：`, error && error.message)
    }
  }

  return { setOutboundGuard, wantsOutbound, passOutbound, settleOutbound }
}
