import { currentPersona, personaNow } from '../../../src/persona/personas.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'

export interface PersonaService {
  current(): { id: string; name: string; body: string }
}

export const name = '人格'
export function apply(ctx: PluginContext) {
  const service: PersonaService = {
    current() {
      const config = ctx.root.config
      const card = currentPersona(personaNow(config))
      return card ? { id: card.id, name: card.name, body: card.body } : { id: '', name: 'AuraBot', body: '' }
    },
  }
  ctx.provide('persona', service)
  return service
}
