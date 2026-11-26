import { Schema } from '../../../src/core/config/shape/schema.ts'
import { canUseDelegatedCommand } from '../../../src/chat/policy/rules/delegation.ts'
import type { SessionLike } from '../../../src/types/core/session.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'

export const name = '会话模型'
export const description = '按当前会话选择下一轮对话使用的模型'
export const Config = Schema.object({
  privateChats: Schema.boolean().default(true).description('允许在私聊中切换'),
  groupChats: Schema.boolean().default(true).description('允许在群组和频道中切换'),
  access: Schema.union(['owner', 'delegated', 'everyone']).default('owner').description('owner 仅主人，delegated 也允许已授权的 QQ 私聊，everyone 允许本会话成员'),
})

export function apply(ctx: PluginContext) {
  let active = true
  ctx.effect(() => { active = false })
  function permitted(session: SessionLike) {
    if (!(session.isPrivate ? ctx.config.privateChats : ctx.config.groupChats)) return false
    if (ctx.isOwner(session) || ctx.config.access === 'everyone') return true
    return ctx.config.access === 'delegated' && session.isPrivate && session.platform === 'qq' &&
      session.bot.id === 'adapter-qq-onebot-v11' &&
      canUseDelegatedCommand(ctx.root.config, { kind: 'private', userId: session.userId }, 'model')
  }
  ctx.command('model [choice:text]').alias('模型', '换模型').action(async ({ session, args }) => {
    const { bot, target } = session as SessionLike
    const selfId = bot.selfId
    const current = () => active && ctx.config.registerCommands !== false && ctx.bots.get(bot.id, bot.platform) === bot && bot.selfId === selfId && bot.status === 'online'
    if (!current()) return
    if (!permitted(session)) return session.send('当前会话没有切换模型的权限。')
    const model = ctx.llm.config.model
    const input = args.trim()
    if (/^(默认|跟随|default|auto)$/i.test(input)) {
      model.set(target, selfId, null)
      return session.send('已恢复跟随面板，下一轮生效。')
    }
    const list = await model.list()
    if (!current() || ctx.llm.config.model !== model) return
    if (!permitted(session)) return session.send('模型切换权限已变更。')
    if (!input) {
      const selected = model.get(target, selfId)
      const rows = list.slice(0, 50).map((m, i) => (i + 1) + '. ' + m.provider + '/' + m.model)
      return session.send(['当前会话模型为' + (selected ? selected.provider + '/' + selected.model : '面板默认') + '。', ...rows, '使用 /model 序号 或 /model 供应商/模型 切换。'].join('\n'))
    }
    const matches = /^\d+$/.test(input) ? list.slice(Number(input) - 1, Number(input)) :
      list.filter(m => [m.provider + '/' + m.model, m.model, m.name].some(value => value?.toLowerCase() === input.toLowerCase()))
    if (matches.length !== 1) return session.send(matches.length ? '有多个同名模型，请填写供应商/模型。' : '未找到该模型，使用 /model 查看列表。')
    const selected = matches[0]
    model.set(target, selfId, selected)
    return session.send('当前会话已切换到 ' + selected.provider + '/' + selected.model + '，下一轮生效。')
  })
}
