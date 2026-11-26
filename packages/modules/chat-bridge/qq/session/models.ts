import { defaultModel, pickReasoningEffort } from '../../../../../src/core/llm/index.ts'
import { resolveChatModel } from '../../../../../src/core/config/chat-model.ts'
import { chatEffortFor } from '../../../../../src/chat/commands/effort-command.ts'

export function createSessionModels({ dsh, getConfig, availableModels, hooks, controller, log }) {
  function targetModel(chat) {
    const cfg = getConfig()
    const t = defaultModel(dsh, cfg)
    let sel = t
      ? { provider: t.provider, model: t.model, reasoningEffort: cfg.model.reasoningEffort || '' }
      : null

    try {
      const r = resolveChatModel(cfg, chat, typeof availableModels === 'function' ? availableModels() : null)
      if (r)
        sel = {
          provider: r.provider,
          model: r.model,
          reasoningEffort: r.reasoningEffort || cfg.model.reasoningEffort || '',
        }
    } catch (error) {}
    if (hooks?.model && chat) {
      try {
        const r = hooks.model(sel, chat)
        if (r && r.provider && r.model) sel = { reasoningEffort: '', ...r }
      } catch (error) {}
    }
    const effort = chatEffortFor(cfg, chat?.chatId, sel)
    return sel && effort ? { ...sel, reasoningEffort: effort } : sel
  }

  async function resolveTarget(chat) {
    const t = targetModel(chat)
    if (!t) return null
    const effort = await pickReasoningEffort(dsh, t.provider, t.model, t.reasoningEffort)
    return { provider: t.provider, model: t.model, ...(effort ? { reasoningEffort: effort } : {}) }
  }

  const keyOf = (t) => (t ? `${t.provider}::${t.model}::${t.reasoningEffort || ''}` : '')

  function applyModel(agent, target) {
    try {
      if (!target) return false
      const sel: { provider: string; model: string; reasoningEffort?: string } = {
        provider: target.provider,
        model: target.model,
      }
      if (target.reasoningEffort) sel.reasoningEffort = target.reasoningEffort

      const agents = controller().agents
      if (agents && typeof agents.selectForNextRequest === 'function') agents.selectForNextRequest(agent, sel)
      else agent.session.append('model/selection', sel)
      return true
    } catch (error) {
      log.debug('设置会话模型失败（用默认）：', error.message)
      return false
    }
  }

  return { targetModel, resolveTarget, keyOf, applyModel }
}
