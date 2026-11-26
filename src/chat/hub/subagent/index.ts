// 子智能体委派（DSH subagent 服务，spawn 后端 + delivery:'caller'）。
// 每个委派 spawn 一个全新子 agent（空对话、继承工作目录与模型）跑一轮自足任务，
// 结果经 Promise 直接返回给调用方，不占用工作区会话窗的常规聊天流。

export interface SubagentDeps {
  dsh: any
  getConfig: () => any
  agentFor: (chat: any) => Promise<{ agent: any }>
  assertActive: () => void
  capabilitiesOf: (moduleId: string) => string[]
  log: any
  getLastOwnerChatAt: () => number
}

type RunSubagentTurnOptions = Partial<Record<'timeoutMs' | 'moduleId' | 'source', any>>

export function createSubagent({ dsh, getConfig, agentFor, assertActive, capabilitiesOf, log, getLastOwnerChatAt }: SubagentDeps) {
  let parentAgent: any = null

  // 常驻父级 agent：spawn 子级必须有活的 parent 句柄，这里挂一次反复用。
  async function parent() {
    if (parentAgent) {
      const live = dsh.agents?.get?.(parentAgent.id) || dsh.agents?.get?.('session-' + parentAgent.id)
      if (live === parentAgent) return parentAgent
      parentAgent = null
    }
    // 父级不能 noTools：spawn 子级继承父级的工具配置，父级没工具子级就拿不到 shell。
    // 父级本身从不发起回合（只当 spawn 挂钩），带工具没有副作用。
    const chat = { chatId: 'system:ext-subagent-parent', kind: 'system', title: '子智能体调度' }
    const { agent } = await agentFor(chat)
    parentAgent = agent
    return agent
  }

  const OWNER_ACTIVE_MS = 5 * 60_000

  /** 现在这次调用算不算「主人开口」：最近 5 分钟有主人私聊消息算 owner，否则后台（#177：source 由宿主判断）。 */
  function ownerSourceNow() {
    const qq = String(getConfig().ownerQQ || '')
    const last = getLastOwnerChatAt()
    if (qq && last && Date.now() - last <= OWNER_ACTIVE_MS) return { kind: 'owner', chatId: `private:${qq}` }
    return { kind: 'system', reason: 'background' }
  }

  /**
   * 宿主给模块的委派入口：moduleId 由宿主注入、source 由宿主判断，
   * 调用方传的 moduleId / source 一律不认（#177 复审第 1 条）。
   */
  function subagentFor(moduleId: string) {
    return (name: string, title: string, prompt: string, opts: any = {}) => runSubagentTurn(name, title, prompt, { ...opts, moduleId, source: ownerSourceNow() })
  }

  /**
   * 子智能体委派：spawn 一个全新子 agent 跑一轮自足任务。
   * 调用方（模块）自己把关：任务提示词必须自足（子级看不到任何对话历史）。
   * @returns {Promise<string>} 子智能体的最终输出文本
   */
  async function runSubagentTurn(name: string, title: string, prompt: string, { timeoutMs = 600000, moduleId = '', source = null }: RunSubagentTurnOptions = {}) {
    assertActive()
    // 权限边界（#177）：① 模块必须在 capabilities 里声明 plugin-internals；
    // ② 必须带「主人开口」的来源；③ 后台调用只有 config.subagentBackground=true 才放行。
    const caps = typeof capabilitiesOf === 'function' ? capabilitiesOf(moduleId) : []
    if (!moduleId || !Array.isArray(caps) || !caps.includes('plugin-internals')) {
      throw Object.assign(new Error(`模块「${moduleId || '未声明'}」没有 plugin-internals 能力，不能用子智能体委派（在 module.json 的 capabilities 里声明）`), { code: 'CAPABILITY_REQUIRED' })
    }
    const c = getConfig()
    const ownerQQ = String(c.ownerQQ || '')
    const ownerChat = source && source.kind === 'owner' ? String(source.chatId || '') : ''
    const fromOwner = Boolean(ownerQQ) && ownerChat === `private:${ownerQQ}`
    const fromBackground = Boolean(source && source.kind === 'system') && c.subagentBackground === true
    if (!fromOwner && !fromBackground) {
      throw Object.assign(new Error('子智能体委派要主人开口：source 必须是主人私聊，或打开「后台子智能体」开关（没人应答时一律拒绝）'), { code: 'OWNER_REQUIRED' })
    }
    // subagents 是可选服务：旧版 ctx 没有 get 就退回直接读，再抛错就当没有服务。
    const dshService = (n: string) => {
      if (typeof dsh.get === 'function') { try { return dsh.get(n) } catch { /* 继续退回直接读 */ } }
      try { return dsh[n] } catch { return null }
    }
    const subagents = dshService('subagents')
    if (!subagents || typeof subagents.startActivation !== 'function') {
      throw Object.assign(new Error('宿主没有 subagents 委派服务（需要较新的 DSH）'), { code: 'SUBAGENT_UNAVAILABLE' })
    }
    const parentAgentRef = await parent()
    assertActive()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(`子智能体超时（${Math.round(timeoutMs / 1000)} 秒）`)), Math.max(5000, Number(timeoutMs) || 600000))
    let activation: any = null
    try {
      activation = await subagents.startActivation({
        provider: 'spawn',
        label: String(title || name || '任务').slice(0, 80),
        // agentPreset 必须显式指定：否则子级继承父级 preset（aurabot-social，零本地工具）。
        request: { prompt: [{ type: 'text', text: String(prompt) }], parent: parentAgentRef, agentPreset: 'aurabot-subagent' },
        signal: ac.signal,
        delivery: 'caller',
      })
      const r = await activation.result
      if (r && r.error) throw new Error(`子智能体执行失败：${r.error}`)
      if (r && typeof r === 'object' && 'stopReason' in r && r.stopReason !== 'completed') {
        throw Object.assign(new Error('子智能体没有正常完成'), { code: 'SUBAGENT_INCOMPLETE' })
      }
      // 兼容旧版字符串/包装对象；有类型的消息块只接受 text，绝不递归读取 reasoning 或工具块。
      const collect = (v: any, out: string[] = []): string[] => {
        if (v == null || out.length >= 200) return out
        if (typeof v === 'string') { if (v.trim()) out.push(v); return out }
        if (Array.isArray(v)) {
          if (v.some((block) => block && (block.type === 'tool-call' || block.type === 'tool_use'))) return out
          for (const x of v) collect(x, out)
          return out
        }
        if (typeof v === 'object') {
          if ('type' in v) {
            if (v.type === 'text' && typeof v.text === 'string') collect(v.text, out)
          } else if (typeof v.text === 'string') collect(v.text, out)
          else for (const k of ['content', 'output', 'summary', 'message', 'result']) if (k in v) collect(v[k], out)
        }
        return out
      }
      const parts = collect(r)
      if (!parts.length) throw Object.assign(new Error('子智能体没有可用的最终文字'), { code: 'SUBAGENT_EMPTY_OUTPUT' })
      return parts[parts.length - 1]
    } finally {
      clearTimeout(timer)
      if (activation && typeof activation.dispose === 'function') activation.dispose().catch(() => {})
    }
  }

  function reset() { parentAgent = null }

  return { subagentFor, runSubagentTurn, reset }
}
