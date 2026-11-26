type Listener = (...args: unknown[]) => unknown
type Subscription = { owner: string; listener: Listener }
type Note = (owner: string, event: string, error: unknown) => void

export function createModuleEvents(note: Note) {
  let closed = false
  const subscriptions = new Map<string, Subscription[]>()
  function subscribe(owner: string, event: string, listener: Listener) {
    if (closed) return () => {}
    const subscription = { owner, listener }
    subscriptions.set(event, [...(subscriptions.get(event) ?? []), subscription])
    return () => {
      const remaining = subscriptions.get(event)?.filter((item) => item !== subscription)
      if (remaining?.length) subscriptions.set(event, remaining)
      else subscriptions.delete(event)
    }
  }
  async function invoke(item: Subscription, event: string, args: unknown[]) {
    try {
      return await item.listener(...args)
    } catch (error) {
      note(item.owner, event, error)
    }
  }
  function emit(event: string, ...args: unknown[]) {
    if (event === 'chat/delivery') return
    for (const item of subscriptions.get(event) ?? []) void invoke(item, event, args)
  }
  async function emitAsync(event: string, ...args: unknown[]) {
    if (event === 'chat/delivery') return
    const listeners = subscriptions.get(event) ?? []
    if (event === 'before-parse') {
      for (const item of listeners) await invoke(item, event, args)
    } else {
      await Promise.all(listeners.map(item => invoke(item, event, args)))
    }
  }
  async function claim(event: string, ...args: unknown[]) {
    for (const item of subscriptions.get(event) ?? []) if (await invoke(item, event, args)) return true
    return false
  }
  async function filter<T>(event: string, value: T, ...args: unknown[]) {
    for (const item of subscriptions.get(event) ?? []) {
      const result = await invoke(item, event, [value, ...args])
      if (result === null) return null
      if (result !== undefined) value = result as T
    }
    return value
  }
  function filterSync<T>(event: string, value: T, ...args: unknown[]) {
    for (const { owner, listener } of subscriptions.get(event) ?? []) {
      try {
        const result = listener(value, ...args)
        if (result === null) return null
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch((error) => note(owner, event, error))
        } else if (result !== undefined) value = result as T
      } catch (error) {
        note(owner, event, error)
      }
    }
    return value
  }
  return {
    subscribe,
    has: (event: string) => Boolean(subscriptions.get(event)?.length),
    emit,
    emitAsync,
    claim,
    filter,
    filterSync,
    close: () => {
      closed = true
      subscriptions.clear()
    },
  }
}
