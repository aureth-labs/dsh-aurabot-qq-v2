import { createPurpose } from './impl/module/index.ts'
import { defineTool, str } from '../../../src/tools/index.ts'

export const name = '目的引擎'

export const version = '1.0.0'

export const description = '像人一样主动找主人搭话：攒素材 → 记观察 → 立目标假设 → 挑一个候选，到点了才来找你。默认开启（主动搭话已并入目的引擎）；显式关过的不会被默认值洗回。'

export const tab = 'speakup'

export { config } from './config.ts'

export function apply(ctx, config) {
  // ---------- P1 播种（方案 §3.1，只发生一次） ----------
  const seedCfg = ctx.root.config
  const seedExt = (seedCfg.ext && seedCfg.ext.purpose) || {}
  if (seedCfg.speakUp?.enabled === true && seedExt.enabled !== false && !seedExt.seededFromSpeakup) {
    try {
      ctx.root.update({ ext: { purpose: { enabled: true, seededFromSpeakup: true } } })
      ctx.logger.info('主动搭话已并入目的引擎，已为你开启目的引擎（醒着时间/频率/白名单都沿用原设置）')
    } catch (error) {
      ctx.logger.warn('播种目的引擎开关失败（不影响本轮运行）：', error?.message)
    }
  }
  const purpose = createPurpose({
    getConfig: ctx.root.read,
    setConfig: ctx.root.update,
    hub: ctx.host.hub,
    log: ctx.logger,
    isMuted: (chatId) => { try { return ctx.host.mutes.muted(chatId) } catch { return false } },
    mood: () => ctx.get('mood'),
    memory: () => ctx.get('memory'),
    pet: () => ctx.get('pet'),
    use: (id) => ctx.get(id),
    personaText: () => { try { return ctx.host.personas?.current?.() || '' } catch { return '' } },
  })
  const gatewayIdle = () => !(ctx.host.bots?.list?.() || []).some((b) => b.status === 'online')
  ctx.setInterval(60_000, () => (gatewayIdle() ? undefined : purpose.tick()), '目的引擎')
  // ---------- 她的小闹钟（P2b 自 speakup 迁入，Q2 拍板） ----------
  const ownerChat = (chat) => chat?.kind === 'private' && String(chat.userId) === String(ctx.root.config.ownerQQ)
  ctx.tool(({ chat }) => {
    if (!ownerChat(chat) || ((ctx.root.config.ext && ctx.root.config.ext.purpose) || {}).enabled === false) return []
    return [
      defineTool({
        name: 'qq_set_reminder',
        description: '给未来的自己定一个小闹钟。到时间系统会提醒你主动找主人说话。at 必须是 yyyy-mm-dd HH:MM（本地时间），note 是到时要提醒自己的内容/由头。只用于主人私聊；面板里的小闹钟开关关着时不能用。',
        properties: {
          at: str('时间，格式 yyyy-mm-dd HH:MM，例如 2026-11-12 17:30'),
          note: str('到时要提醒自己什么，例如「问主人晚饭吃了没」'),
        },
        required: ['at', 'note'],
        execute: ({ at, note }) => {
          if (!ownerChat(chat)) return { ok: false, message: '只有主人能用小闹钟' }
          return purpose.addReminder(at, note)
        },
      }),
      defineTool({
        name: 'qq_close_reminder',
        description: '关闭一个自己设的小闹钟。id 用运行时「她的小闹钟」列表里的编号。',
        properties: { id: str('要关闭的小闹钟 id') },
        required: ['id'],
        execute: ({ id }) => {
          if (!ownerChat(chat)) return { ok: false, message: '只有主人能用小闹钟' }
          return purpose.closeReminder(id)
        },
      }),
    ]
  })
  ctx.prompt(({ chat }) => {
    if (!ownerChat(chat) || ctx.root.config.speakUp?.reminderEnabled !== true) return ''
    const list = purpose.reminders()
    if (!list.length) return ''
    return '【她的小闹钟】\n' + list.map((r) => `- ${r.id}｜${r.atText}｜${r.note}`).join('\n') + '\n要关闭某条用 qq_close_reminder。'
  })
  ctx.server.post('/purpose/reminder/close', async (req) => {
    const body = await ctx.http.body(req).catch(() => ({}))
    return purpose.closeReminder(body?.id)
  })
  ctx.server.post('/purpose/fire', async () => {
    if (!ctx.config.enabled) return { ok: false, message: '目的引擎没开（主动搭话页可以打开）' }
    const r = await purpose.fire('手动')
    if (!r) return { ok: false, message: '没有结果' }
    if (r.outcome === 'sent') return { ok: true, message: '已经去找你了' }
    if (r.outcome === 'silent') return { ok: true, message: '她这轮想了想，决定不说（不硬发）' }
    if (r.outcome === 'muted') return { ok: false, message: '主人在私聊里让她闭嘴了' }
    if (r.outcome === 'disabled') return { ok: false, message: '目的引擎开关是关的' }
    return { ok: true, message: `这轮结束：${r.outcome}` }
  })
  ctx.server.get('/purpose/status', async () => ({ ok: true, status: purpose.status(), state: purpose.state() }))
  ctx.server.get('/purpose/preview', async () => ({ ok: true, preview: await purpose.preview() }))
  // 代发决断面：宿主投递器在 broker 档发送前调用（见 purpose/module.js 的 brokerReview）。
  // 模块不直接用它；host.js 的 wirePolicySources 经 use('purpose') 取到。
  // （createPurpose 返回的对象方法都走闭包，无 this 依赖，直接透传即可。）
  // 引擎自发发言的 §5.3 私有凭据注入点：宿主把 purpose 策略源对象交给引擎，
  // 引擎投递时经 deliver 的 enginePolicy 路径 reserve/commit，不再被包装层门闸二次拦。
  // 驱动向量 → 提示层：把「最近比较想要什么」轻描淡写地附在本轮消息末尾（引擎关着时返回空）。
  // 和心情一样不进系统提示词：它会随驱动变化，放在开头一变就让整段历史的前缀缓存失效。
  ctx.on('prompt', (content, { chat }) => {
    if (chat.kind === 'system') return content
    const line = purpose.drivesRule()
    return line ? [...content, { type: 'text', text: line }] : content
  })
  return purpose
}
