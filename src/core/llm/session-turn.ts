import { targetKey } from '../pipeline/target.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SessionLike } from '../../types/core/session.ts'
import type { Target } from '../../types/core/target.ts'
import type { ToolTurn, TurnTool } from './tool-turn.ts'

export interface SessionPrompt {
  text: string
  system: string
  sessionId: string
  images?: Array<{ data: string; mediaType: string }>
  maxTokens: number
}
interface Scope {
  sessionId: string
  owner: () => boolean
  active: boolean
}
interface Where {
  images?: SessionPrompt['images']
  target: Target
  level: 'full' | 'social'
  sessionId: string
  chat: { kind: SessionLike['type']; chatId: string; userId: string; channelId: string }
}
interface Options {
  isOwner: (session: SessionLike) => boolean
  tools: (where: Where) => TurnTool[]
  generate: (prompt: SessionPrompt, tools: ToolTurn) => Promise<string>
}
export interface Dialogue {
  respond(
    session: SessionLike,
    prompt: SessionPrompt,
    active: () => boolean,
    extras?: () => TurnTool[],
    beforeTool?: () => boolean,
  ): Promise<string>
}
const scope = new AsyncLocalStorage<Scope>()
export function sessionOwner(sessionId: string): boolean | undefined {
  const value = scope.getStore()
  if (!value) return undefined
  return value.active && value.sessionId === sessionId && value.owner()
}
export function createDialogue(options: Options): Dialogue {
  return {
    async respond(session, prompt, active, extras = () => [], beforeTool) {
      const { sessionId } = prompt
      const owner = () => active() && options.isOwner(session)
      const current = { sessionId, owner, active: true }
      try {
        return await scope.run(current, () =>
          options.generate(prompt, {
            active: () => current.active && active(),
            beforeTool,
            available: () => {
              if (!current.active || !active()) return []
              const target = session.target
              const primary = extras()
              const names = new Set(primary.map((t) => t.name))
              const registered = options.tools({
                sessionId,
                target,
                images: prompt.images,
                level: owner() && session.isPrivate ? 'full' : 'social',
                chat: {
                  kind: session.type,
                  chatId: targetKey(target),
                  userId: session.userId,
                  channelId: session.channelId,
                },
              })
              return [...primary, ...registered.filter((t) => !names.has(t.name))]
            },
          }),
        )
      } finally {
        current.active = false
      }
    },
  }
}
