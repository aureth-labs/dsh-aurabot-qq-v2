import { createNoticeRelay } from '../../../../src/features/notices/index.ts'

export function registerNoticeHandling({ ctx, getConfig, log, hub, approvalRelay }) {
  // ---------- 审批 / 提问：DSH 要人处理时把请求说到 QQ ----------
  // 只上报，不代答：DSH 界面照常弹，谁在电脑前谁点。按工作区分别开关（config.notice）。
  function workspaceList() {
    try {
      const reg = ctx.workspaceRegistry || ctx.get?.('workspaceRegistry')
      return reg?.list?.() || []
    } catch (error) {
      return []
    }
  }
  function workspaceOfSession(sessionId) {
    const sid = String(sessionId || '')
    if (!sid) return ''
    const hit = workspaceList().find((w) => (w?.sessionIds || []).some((x) => String(x) === sid))
    return hit ? String(hit.path || '') : ''
  }
  // 上一次往私人会话推提醒的时间：10 秒内不再推，避免连着进来几批时刷屏
  let lastNoticePush = 0
  /**
   * 把攒下来的几件事，推进主人的私聊会话让她自己说。
   * 走的是完整人格 + 私聊上下文，不再拼独立提示词；推不进去（会话坏了、还没恢复）就整批不发。
   */
  async function noticeText(items) {
    const list = Array.isArray(items) ? items : []
    if (!list.length) return false
    if (Date.now() - lastNoticePush < 10000) return false
    const now = getConfig()
    const owner = String(now.ownerName || '主人').slice(0, 12)
    // 精确到秒：同一分钟里连着来的两件也能分开，不会被当成同一件
    const clock = (t) => {
      const d = new Date(Number(t) || Date.now())
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    const lines = list.map((it, i) => {
      const title = String(it.title || '未命名').slice(0, 40)
      const at = clock(it.at)
      if (it.kind === 'approval')
        return `${i + 1}. [${at}] 有个会话卡在 ${it.tool || '某个工具'} 上，等他点批准（会话：${title}）`
      const q = (it.questions || []).map((x) => x?.question).filter(Boolean)[0] || '有个问题'
      return `${i + 1}. [${at}] 有个会话在等他选方案：${String(q).slice(0, 60)}（会话：${title}）`
    })
    try {
      const prompt = `（这是一条提示信息，通知你的主人：他电脑上有活卡住了，需要他去 DSH 界面处理。现在是 ${clock(Date.now())}。\n下面每一条都是一次单独的审批或选择请求，编号或时间不重复就是不同的事。\n${lines.join('\n')}\n用你自己的性格和语气随口跟他提一句，就当聊天里顺口提一嘴；别念条目、别像发通知。）`
      // 把真正推给会话的内容也记下来：排查「模型为什么说没带编号」时，先看它到底收到了什么
      log.info(`推送提示：${prompt.replace(/\n/g, ' | ').slice(0, 600)}`)
      await hub.pushToSession(
        { chatId: `private:${now.ownerQQ}`, kind: 'private', userId: now.ownerQQ, nickname: owner },
        [{ type: 'text', text: prompt }],
        '',
      )
      lastNoticePush = Date.now()
      return true
    } catch (error) {
      log.warn?.('上报推送失败：', error.message)
      return false
    }
  }
  const relay = createNoticeRelay({
    getConfig,
    workspaceOf: workspaceOfSession,
    compose: noticeText,
    // 合并窗口可配置（config.notice.windowSec，秒）：审批/选项请求到齐后等多久再推 QQ
    windowMs: (Number(getConfig().notice?.windowSec) || 8) * 1000,
    log,
  })
  async function notifyApproval(session, event) {
    try {
      if (!getConfig().enabled) return
      const d = event.data || {}
      const id = String(d.id || '')
      if (!id) return
      // 等一下看 QQ 有没有问：问了就不用再通知；没问（比如审批没走到插件）照常通知，主人不会什么都收不到
      if (approvalRelay?.handles(session?.id)) {
        await new Promise((r) => setTimeout(r, 1500))
        if (approvalRelay.askedRecently()) return
      }
      let title = ''
      try {
        title = String(session?.title || '').trim()
      } catch (error) {}
      // 和提问一样：会话事件里的 session 常常没带标题，用 id 后 8 位兜底（完整 id 太长，模型认不出是编号）
      if (!title) title = String(session?.id || '').slice(-8)
      const queued = relay.announce('approval', {
        id,
        sessionId: session?.id,
        title,
        tool: d.toolName,
        reason: d.reason,
      })
      // 留一行痕迹：排查「为什么这个会话的审批没推到 QQ」时，至少能看出是没收到、被开关挡掉，还是已入队
      log.info(
        `审批上报：${d.toolName || '?'}（会话 ${String(session?.id || '').slice(-8) || '?'}）→ ${queued ? '已入队' : relay.enabled('approval', session?.id) ? '重复/已在队列' : '被开关挡掉'}`,
      )
    } catch (error) {
      log.debug?.('审批通知失败：', error.message)
    }
  }

  // 她要向人提问时从会话事件里认（tool/call）：user-questions/request 是 agent-scoped
  // waterfall，插件挂在根 scope 上收不到；而工具调用事件是全局的，能拿到完整问题。
  function noticeQuestion(session, event) {
    try {
      const d = event?.data || {}
      const sid = String(session?.id || '')
      if (!sid) return
      if (event.type === 'tool/call' && d.name === 'ask_user_question') {
        const callId = String(d.callId || '')
        if (!callId) return
        let qs = []
        try {
          qs = JSON.parse(String(d.arguments || '{}')).questions || []
        } catch (error) {}
        if (!Array.isArray(qs) || !qs.length) return
        let title = ''
        try {
          title = String(session?.title || '').trim()
        } catch (error) {}
        // 会话事件里的 session 常常没带标题：用 id 后 8 位兜底，不然模型分不清是哪两个会话
        if (!title) title = sid.slice(-8)
        const id = `q:${sid}:${callId}`
        const queued = relay?.announce('question', { id, sessionId: sid, title, questions: qs })
        log.info(
          `提问上报：${qs.length} 个问题（${title}）→ ${queued ? '已入队' : relay?.enabled('question', sid) ? '重复/已在队列' : '被开关挡掉'}`,
        )
      } else if (event.type === 'tool/result') {
        // 问题答完 / 超时跳过：把还没推出去的那条撤掉。
        // 两处旧写法都取不到 id，导致这条取消路径从来没跑过（30 秒内答完照样推过期提醒）：
        //   1. 函数开头要求 d.callId，但 tool/result 的 data 只有 turn/step/message/meta；
        //   2. 这里读 d.toolCallId，实际字段在 d.message.toolCallId（本机 1369 条实测）。
        const tcid = String(d.message?.toolCallId || d.toolCallId || '')
        if (tcid) relay?.cancel(`q:${sid}:${tcid}`)
      }
    } catch (error) {
      log.debug?.('提问上报失败：', error.message)
    }
  }
  return { relay, workspaceList, notifyApproval, noticeQuestion }
}
