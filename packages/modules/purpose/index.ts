import { createPurposeScheduler } from './scheduler.ts'
import { assertTarget } from '../../../src/core/pipeline/target.ts'
import { defineTool, str } from '../../../src/tools/index.ts'

export const name = '目的引擎'

export const version = '1.0.0'

export const description = '像人一样主动找主人搭话：攒素材 → 记观察 → 立目标假设 → 挑一个候选，到点了才来找你。默认开启（主动搭话已并入目的引擎）；显式关过的不会被默认值洗回。'

export const tab = 'speakup'

export { config } from './config.ts'

export function apply(ctx, config) {
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
  const purpose = createPurposeScheduler(ctx, {
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
  ctx.setInterval(60_000, () => purpose.tick(), '目的引擎')
  const ownerEngine = ({ chat, target }) => {
    if (chat?.kind !== 'private' || target?.type !== 'private' || String(chat.userId) !== target.id ||
        !ctx.isOwner(chat.userId, target.platform, target.botId) || ctx.config.enabled === false) return
    return purpose.select(target)
  }
  ctx.tool(where => {
    const engine = ownerEngine(where)
    if (!engine || ctx.root.config.speakUp?.reminderEnabled !== true) return []
    const { platform, botId } = where.target
    const bot = ctx.bots.get(botId, platform)
    const self = bot?.selfId
    const authorized = () => self && ctx.bots.get(botId, platform) === bot && bot.selfId === self && ownerEngine(where) === engine
    return [
      defineTool({
        name: 'purpose_set_reminder',
        description: '给未来的自己定一个小闹钟。到时间系统会提醒你主动找主人说话。at 必须是 yyyy-mm-dd HH:MM（本地时间），note 是到时要提醒自己的内容/由头。只用于主人私聊；面板里的小闹钟开关关着时不能用。',
        properties: {
          at: str('时间，格式 yyyy-mm-dd HH:MM，例如 2026-11-12 17:30'),
          note: str('到时要提醒自己什么，例如「问主人晚饭吃了没」'),
        },
        required: ['at', 'note'],
        execute: ({ at, note }) => {
          if (!authorized()) return { ok: false, message: '只有主人能用小闹钟' }
          return engine.addReminder(at, note)
        },
      }),
      defineTool({
        name: 'purpose_list_reminders',
        description: '查看当前主人私聊仍在等待的小闹钟，可以用编号取消。',
        properties: {},
        execute: () => authorized() ? engine.reminders().map(({ id, atText, note }) => ({ id, at: atText, note }))
          : { ok: false, message: '只有主人能查看小闹钟' },
      }),
      defineTool({
        name: 'purpose_close_reminder',
        description: '关闭一个自己设的小闹钟。id 用运行时「她的小闹钟」列表里的编号。',
        properties: { id: str('要关闭的小闹钟 id') },
        required: ['id'],
        execute: ({ id }) => {
          if (!authorized()) return { ok: false, message: '只有主人能用小闹钟' }
          return engine.closeReminder(id)
        },
      }),
    ]
  })
  ctx.prompt(where => {
    const engine = ownerEngine(where)
    if (!engine || ctx.root.config.speakUp?.reminderEnabled !== true) return ''
    const list = engine.reminders()
    if (!list.length) return ''
    return '【她的小闹钟】\n' + list.map((r) => `- ${r.id}｜${r.atText}｜${r.note}`).join('\n') + '\n要关闭某条用 purpose_close_reminder。'
  })
  ctx.server.post('/purpose/reminder/close', async (req) => {
    const body = await ctx.http.body(req).catch(() => ({}))
    return purpose.closeReminder(body?.id)
  })
  ctx.server.post('/purpose/fire', async req => {
    if (!ctx.config.enabled) return { ok: false, message: '目的引擎没开（主动搭话页可以打开）' }
    const body = await ctx.http.body(req)
    if (body?.target !== undefined) assertTarget(body.target)
    const r = await purpose.fire('手动', body?.target)
    if (!r) return { ok: false, message: '没有结果' }
    if (r.outcome === 'select-owner') return { ok: false, message: '请选择要联系的主人账号', targets: purpose.targets() }
    if (r.outcome === 'no-owner' || r.outcome === 'unavailable') return { ok: false, message: '没有可用的主人私聊连接' }
    if (r.outcome === 'delivery-failed') return { ok: false, message: '未确认消息送达' }
    if (r.outcome === 'sent') return { ok: true, message: '已经去找你了' }
    if (r.outcome === 'silent') return { ok: true, message: '她这轮想了想，决定不说（不硬发）' }
    if (r.outcome === 'muted') return { ok: false, message: '主人在私聊里让她闭嘴了' }
    if (r.outcome === 'disabled') return { ok: false, message: '目的引擎开关是关的' }
    return { ok: true, message: `这轮结束：${r.outcome}` }
  })
  const panelEngine = req => {
    const q = ctx.http.query(req)
    const explicit = ['platform', 'botId', 'id'].some(key => q[key] !== undefined)
    const target = explicit ? { platform: q.platform, botId: q.botId, id: q.id, type: 'private' as const } : undefined
    if (target) assertTarget(target)
    return purpose.select(target)
  }
  ctx.server.get('/purpose/status', req => {
    const engine = panelEngine(req)
    return { ok: true, targets: purpose.targets(), status: engine?.status(), state: engine?.state() }
  })
  ctx.server.get('/purpose/preview', async req => {
    const engine = panelEngine(req)
    return { ok: true, targets: purpose.targets(), preview: engine && await engine.preview() }
  })
  ctx.on('prompt', (content, where) => {
    if (where.chat.kind === 'system') return content
    const line = (where.primaryChat ? purpose : where.target && purpose.select(where.target))?.drivesRule()
    return line ? [...content, { type: 'text', text: line }] : content
  })
  return purpose
}
