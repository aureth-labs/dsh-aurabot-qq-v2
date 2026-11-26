import { h, type Element } from '../../../../../../src/core/message/element/element.ts'
import type { OneBotBot } from '../bot.ts'
import { fromOneBot } from '../element.ts'
import { forwardBody, readForward } from './forward.ts'

export const forwardBudget = () => ({ requests: 12, deadline: Date.now() + 5000 })

export function createForwardExpansion(bot: OneBotBot, enabled: boolean) {
  return async function expand(elements: Element[], messageId?: string, budget = forwardBudget()) {
    if (!enabled || !elements.some(el => el.type === 'forward')) return elements
    const self = bot.selfId
    const outerId = elements.filter(el => el.type === 'forward').length === 1 ? messageId : undefined
    let count = 0
    const gateway = { call(action, params) {
      const remaining = budget.deadline - Date.now()
      if (budget.requests-- <= 0 || remaining <= 0 || bot.selfId !== self || bot.status !== 'online') return
      return bot.internal(action, params, { timeoutMs: remaining })
    } }
    const output: Element[] = []
    for (const el of elements) {
      if (el.type !== 'forward' || el.children?.length || ++count > 5) {
        output.push(el)
        continue
      }
      const id = String(el.attrs.id ?? el.attrs.res_id ?? el.attrs.forward_id ?? '')
      const result = await readForward(gateway, { id, outerId, content: el.attrs.content }, { selfId: self })
      if (bot.selfId !== self || bot.status !== 'online') return elements
      const children = [h.text(forwardBody(result)), ...fromOneBot([...result.images, ...result.stickers])]
      output.push(h('forward', id ? { id } : {}, [h('message', {}, children)]))
    }
    return output
  }
}
