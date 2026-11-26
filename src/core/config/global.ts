import type { Owner } from './owners.ts'

export interface GlobalConfig {
  /** 指令前缀；null = 不带前缀。默认 [null, '/']。 */
  commandPrefixes: Array<string | null>
  /** 指令消费消息后是否继续走中间件（默认 false，和 Koishi 一致）。 */
  middlewareAfterCommand: boolean
  owners: Owner[]
  ownerQQ: string
  ownerIds: string[]
  ownerName: string
  ownerLevel: 'full' | 'social' | 'chat'
  allow: { private: string[]; groups: string[] }
}

export const GLOBAL_CONFIG_DEFAULTS: GlobalConfig = {
  commandPrefixes: [null, '/'],
  middlewareAfterCommand: false,
  owners: [],
  ownerQQ: '',
  ownerIds: [],
  ownerName: '主人',
  ownerLevel: 'full',
  allow: { private: [], groups: [] },
}

/** 指令前缀：清洗成 null 或单字符，空列表回落到默认。 */
export function commandPrefixesOf(cfg: any): Array<string | null> {
  const list = Array.isArray(cfg?.commandPrefixes) ? cfg.commandPrefixes : []
  const cleaned = list.map((x) => (x == null || String(x) === '' ? null : String(x).slice(0, 1)))
  return cleaned.length ? cleaned : GLOBAL_CONFIG_DEFAULTS.commandPrefixes
}
