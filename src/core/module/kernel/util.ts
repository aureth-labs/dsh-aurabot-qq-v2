// 模块内核的通用小工具：延迟代理与深合并。

/**
 * 一个「用的时候才去找」的模块代理：memory.add(...) 每次都调当时在跑的那个 memory 模块；
 * 模块没在跑时，属性都是 undefined（所以调用方写 memory.add?.(...) 就不会出错）。
 */
export function lazyProxy(get: () => Record<string, any> | null): Record<string, any> {
  return new Proxy({} as Record<string, any>, {
    get(_, k) {
      const t = get()
      if (!t) return undefined
      const v = t[k as string]
      return typeof v === 'function' ? v.bind(t) : v
    },
    has: (_, k) => Boolean(get() && (k as string) in (get() as object)),
  })
}

export const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export function deepMerge(base: unknown, over: unknown): any {
  if (!isObj(over)) return over === undefined ? base : over
  const out: Record<string, any> = { ...(isObj(base) ? base : {}) }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out
}
