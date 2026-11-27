import { targetKey, type Target } from '../../../src/core/pipeline/target.ts'
import type { BotLike } from '../../../src/types/adapter/bot.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { personaNow, personaScope } from '../../../src/persona/personas.ts'
import { createPurpose } from './impl/module/index.ts'
import { openOwnerChannel, ownerTargets } from './owners.ts'

type Engine = ReturnType<typeof createPurpose>
type Dependencies = Parameters<typeof createPurpose>[0]

export function createPurposeScheduler(ctx: PluginContext, deps: Dependencies) {
  let login: { bot: BotLike; self: string } | undefined
  const primaryIdentity = () => {
    const bot = ctx.host.primaryBot?.()
    if (!active || bot?.status !== 'online') return undefined
    if (login?.bot !== bot || login.self !== bot.selfId) login = { bot, self: bot.selfId }
    return login
  }
  const primary = createPurpose({ ...deps, primaryIdentity })
  const engines = new Map<string, { engine: Engine; self: string; engineBot: BotLike }>()
  let active = true, working = false, cursor = 0
  ctx.effect(() => { active = false; engines.clear() })

  function entries() {
    const primaryBot = ctx.host.primaryBot?.()
    const owners = ownerTargets(ctx)
    const legacy = ctx.root.config.ownerQQ
    if (legacy && primaryBot?.status === 'online' && ctx.isOwner(legacy, primaryBot.platform, primaryBot.id) &&
        !owners.some(t => t.platform === primaryBot.platform && t.botId === primaryBot.id && t.id === legacy)) {
      owners.unshift({ platform: primaryBot.platform, botId: primaryBot.id, type: 'private', id: legacy })
    }
    const keys = new Set(owners.map(targetKey))
    for (const key of engines.keys()) if (!keys.has(key)) engines.delete(key)
    return owners.map(target => {
      if (primaryBot && target.botId === primaryBot.id && target.platform === primaryBot.platform && target.id === legacy)
        return { target, engine: primary }
      const bot = ctx.bots.get(target.botId, target.platform)
      const key = targetKey(target)
      let entry = engines.get(key)
      if (!entry || entry.self !== bot.selfId || entry.engineBot !== bot) {
        const channel = openOwnerChannel(ctx, target, bot, () => active && engines.get(key) === entry)
        entry = { self: bot.selfId, engineBot: bot, engine: createPurpose({ ...deps, channel }) }
        engines.set(key, entry)
      }
      return { target, engine: entry.engine }
    })
  }

  function select(target?: Target) {
    const all = entries()
    if (target) return all.find(row => targetKey(row.target) === targetKey(target))?.engine
    return all.length === 1 ? all[0].engine : undefined
  }

  async function tick() {
    if (!active || working || !ctx.root.config.enabled || ctx.root.config.debug) return
    working = true
    try {
      const all = entries()
      for (let n = 0; n < all.length && active; n++) {
        const i = (cursor + n) % all.length
        if (await all[i].engine.tick()) { cursor = i + 1; return true }
      }
    } finally { working = false }
  }

  async function fire(reason = '手动', target?: Target) {
    if (!active || !ctx.root.config.enabled || ctx.root.config.debug) return { outcome: 'disabled' }
    if (working) return { outcome: 'skipped-busy' }
    const engine = select(target)
    if (!engine) return { outcome: entries().length ? 'select-owner' : 'no-owner' }
    working = true
    try { return await personaScope.run(personaNow(ctx.root.config), () => engine.fire(reason)) } finally { working = false }
  }
  return {
    ...primary, select, tick, fire, run: fire,
    status: (target?: Target) => select(target)?.status(),
    state: (target?: Target) => select(target)?.state(),
    preview: (target?: Target) => select(target)?.preview(),
    targets: () => entries().map(row => row.target),
    closeReminder(id: string) {
      for (const { engine } of entries()) if (engine.reminders().some(row => row.id === id)) return engine.closeReminder(id)
      return primary.closeReminder(id)
    },
  }
}
