export class ServiceError extends Error {
  constructor(name: string, readyWhenPresent: boolean, message: string) {
    super(message)
    this.service = name
    this.readyWhenPresent = readyWhenPresent
  }
  readonly service: string
  readonly readyWhenPresent: boolean
}

export class ServiceRegistry {
  private readonly table = new Map<string, { impl: object; provider: string }>()
  private readonly listeners = new Set<(name: string, present: boolean) => void>()

  onChange(listener: (name: string, present: boolean) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  provide(name: string, impl: unknown, provider = ''): () => void {
    const key = String(name || '').trim()
    if (!key || !impl || typeof impl !== 'object') throw new TypeError('服务需要名称和实现对象')
    const current = this.table.get(key)
    if (current) throw new ServiceError(key, false, `服务「${key}」已由「${current.provider}」提供，「${provider}」无法重复注册`)
    const item = { impl, provider }
    this.table.set(key, item)
    for (const fn of this.listeners) fn(key, true)
    return () => {
      if (this.table.get(key) !== item) return
      this.table.delete(key)
      for (const fn of this.listeners) fn(key, false)
    }
  }

  get<T = any>(name: string): T | null {
    return (this.table.get(name)?.impl as T) ?? null
  }

  has(name: string) { return this.table.has(name) }

  require<T = any>(name: string): T {
    const value = this.get<T>(name)
    if (!value) throw new ServiceError(name, true, `缺少服务「${name}」，请启用对应的提供插件`)
    return value
  }

  names(): string[] { return [...this.table.keys()].sort() }
}
