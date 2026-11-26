import { join } from 'node:path'
import { dataDir } from '../../../src/core/store/index.ts'
import { createOutboundPolicy } from '../../../src/chat/policy/outbound/index.ts'
import { createPurposePolicy, createSharedBudget } from '../../../src/features/proactive/policy/index.ts'

export function createOutboundRuntime({ getConfig, logger, hub, use }) {
  const enginePolicies = new Map()
  const outbound = createOutboundPolicy({
    getConfig,
    dataDir: join(dataDir('modules-data'), 'outbound-policy'),
    log: (msg) => logger.child('出站策略').info(msg),
    send: async (to, text, meta: { item?: { moduleId?: string; itemId?: string } } = {}) => {
      const item = (meta && meta.item) || {}
      const moduleId = String(item.moduleId || '')
      const itemId = String(item.itemId || '')
      const policy = enginePolicies.get('purpose') || null
      let reviewId = ''
      if (policy && typeof policy.reserveReview === 'function') {
        const r = policy.reserveReview({ to: String(to), itemId, at: Date.now() })
        if (!r || r.ok !== true) return false // 引擎没开/安静时段/上一条还在途：这条不审查不发
        reviewId = r.reserveId
      }
      let finalText = String(text ?? '')
      try {
        const purpose = use('purpose')
        if (purpose && typeof purpose.brokerReview === 'function') {
          const verdict = await purpose.brokerReview({ to: String(to), text: finalText, moduleId, itemId })
          if (verdict && verdict.ok && verdict.send === false) return false // 引擎决断：这条不说
          if (verdict && verdict.ok && verdict.text) finalText = verdict.text
        }
        const r = await hub.deliver(String(to), finalText, {
          userText: '【系统提醒，不是主人说的话】（代发·经目的引擎决断）',
        })
        return Boolean(r && (r.failed ?? 0) === 0)
      } finally {
        if (reviewId && policy && typeof policy.commit === 'function') {
          try {
            policy.commit(reviewId, { outcome: 'sent' }, 'review')
          } catch {}
        }
      }
    },
  })

  hub.setOutboundGuard?.((ask) => {
    const verdict = outbound.admit({
      to: ask.chatId,
      moduleId: ask.sourceModule || '',
      origin: ask.sourceModule ? 'module' : 'engine',
      cause: ask.cause || null,
      itemId: ask.itemId || null,
      at: Date.now(),
    })
    if (verdict.action === 'deny') return verdict
    return {
      ...verdict,
      settle: (outcome) => {
        const oc = ['sent', 'queued', 'uncertain', 'failed'].includes(outcome) ? outcome : 'failed'
        if (verdict.reserveId)
          outbound.commit(verdict.reserveId, { deliveryId: verdict.deliveryId, outcome: oc })
      },
    }
  })
  hub.setOutboundEngineResolver?.((name) => enginePolicies.get(String(name)) || null)

  function wirePolicySources() {
    if (!outbound) return
    const cfg = getConfig()
    const dir = join(dataDir('modules-data'), 'outbound-policy')
    const say = (msg) => logger.child('出站策略').info(msg)
    const budget = createSharedBudget({ ownerQQ: cfg.ownerQQ, dataDir: dir, log: say })
    try {
      const pu = use('purpose')
      if (cfg.ext?.purpose?.enabled !== false && pu) {
        const policy = createPurposePolicy({
          getConfig,
          engine: pu,
          state: () => pu.state?.() || null,
          dataDir: dir,
          log: say,
          budget,
        })
        outbound.registerPolicySource(policy)
        enginePolicies.set('purpose', policy) // 给 deliver(…, { enginePolicy: 'purpose' }) 用
        pu.setEnginePolicySource?.(policy)
      } else {
        outbound.unregisterPolicySource('purpose')
        enginePolicies.delete('purpose')
        use('purpose')?.setEnginePolicySource?.(null) // 策略源撤了，凭据一并撤
      }
      outbound.unregisterPolicySource('speakup')
      enginePolicies.delete('speakup')
      outbound.syncOwnerQQ?.(cfg.ownerQQ)
      const rawActive = (cfg.ext?.outboundPolicy && cfg.ext.outboundPolicy.activePolicy) || 'auto'
      outbound.setActivePolicy?.(rawActive === 'speakup' ? 'purpose' : rawActive)
    } catch (error) {
      logger.child('出站策略').warn('策略源装配失败：', error && error.message)
    }
  }
  return { outbound, wirePolicySources }
}
