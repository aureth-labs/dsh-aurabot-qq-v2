import { AsyncLocalStorage } from 'node:async_hooks'
import type { OutputScope } from '../context/context.ts'
import { currentPromptSources, type PromptSources } from '../../../security/leak-guard.ts'

export function createDeliverySources(
  ownerId: () => string,
  secrets: (chatId: string) => Iterable<string>,
  warn: (message: string) => void,
) {
  const outputSources = new Map<string, PromptSources>()
  const outputScope = new AsyncLocalStorage<OutputScope>()
  function sourcesFor(chatId: string) {
    let sources = outputSources.get(chatId)
    if (!sources) {
      sources = { chatId, system: new Map(), context: '', memory: [], userText: '' }
      outputSources.set(chatId, sources)
    }
    return sources
  }
  function cleaningFor(chatId: string) {
    const scope = outputScope.getStore()
    const sources =
      scope?.chatId === chatId ? scope.sources : (currentPromptSources() ?? outputSources.get(chatId))
    return {
      warn(message: string) {
        warn(chatId + '：' + message)
        if (scope?.chatId === chatId) scope.blocked = true
      },
      allowPromptEcho: scope?.chatId === chatId && scope.allowPromptEcho,
      promptSources: [
        ...(sources?.system.size ? sources.system.values() : secrets(chatId)),
        sources?.context ?? '',
        ...(sources?.memory ?? []),
      ],
      userText: sources?.userText ?? '',
      ownerPrivate: chatId === 'private:' + ownerId(),
    }
  }
  return { outputScope, outputSources, sourcesFor, cleaningFor }
}
