/** 从磁盘读进来的配置：形状未知，要过一遍 normalize。 */
export type RawConfig = Record<string, unknown>

export const isObj = (v: unknown): v is RawConfig => !!v && typeof v === 'object' && !Array.isArray(v)

export function deepMerge<T> (base: T, over: unknown): T {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base) as RawConfig
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out as T
}
