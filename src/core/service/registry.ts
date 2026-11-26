// 内核服务表：插件 provide，内核和其它插件 get。
//
// 服务是「能力」而不是「模块 id」：内核要合成语音时找 voice 服务，
// 谁提供都行；没有插件提供就明确报错/降级，绝不直接 import 某个插件的实现。

export interface ServiceProvider {
  name: string
  impl: any
  provider: string
}

export class ServiceRegistry {
  private readonly table = new Map<string, ServiceProvider[]>()

  provide(name: string, impl: any, provider = ''): () => void {
    const key = String(name || '').trim()
    if (!key) throw new Error('provide 需要服务名')
    if (!impl || typeof impl !== 'object') throw new Error(`服务 ${key} 的实现必须是对象`)
    const item: ServiceProvider = { name: key, impl, provider: String(provider || '') }
    const list = this.table.get(key) || []
    list.push(item)
    this.table.set(key, list)
    return () => {
      const cur = this.table.get(key) || []
      const next = cur.filter((x) => x !== item)
      if (next.length) this.table.set(key, next)
      else this.table.delete(key)
    }
  }

  get<T = any>(name: string): T | null {
    const list = this.table.get(String(name || ''))
    return list && list.length ? list[list.length - 1].impl as T : null
  }

  has(name: string): boolean {
    return Boolean(this.table.get(String(name || ''))?.length)
  }

  require<T = any>(name: string): T {
    const hit = this.get<T>(name)
    if (!hit) throw new Error(`没有插件提供「${name}」服务（先在插件市场装一个，或在面板里打开对应插件）`)
    return hit
  }

  names(): string[] {
    return [...this.table.keys()].sort()
  }
}
