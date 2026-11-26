// 全局配置：不属于任何一个插件，所有平台、所有插件共用。
// 面板「权限」「聊天」页读的就是这里的键；插件自己的配置在 packages/<id>/config.ts。

export interface GlobalConfig {
  /** 指令前缀；null = 不带前缀。默认 [null, '/']。 */
  commandPrefixes: Array<string | null>
  /** 指令消费消息后是否继续走中间件（默认 false，和 Koishi 一致）。 */
  middlewareAfterCommand: boolean
  /** 主人 ID（第一个是主主人；多平台可以有多个）。 */
  ownerQQ: string
  ownerIds: string[]
  ownerName: string
  ownerLevel: 'full' | 'social' | 'chat'
  allow: { private: string[]; groups: string[] }
}

export const GLOBAL_CONFIG_DEFAULTS: GlobalConfig = {
  commandPrefixes: [null, '/'],
  middlewareAfterCommand: false,
  ownerQQ: '',
  ownerIds: [],
  ownerName: '主人',
  ownerLevel: 'full',
  allow: { private: [], groups: [] },
}

/** 所有主人 ID（去重、去空）。ownerQQ 是第一个，ownerIds 是补充。 */
export function ownersOf(cfg: any): string[] {
  const list = [cfg?.ownerQQ, ...(Array.isArray(cfg?.ownerIds) ? cfg.ownerIds : [])]
  return [...new Set(list.map((id) => String(id ?? '').trim()).filter(Boolean))]
}

export function isOwnerOf(cfg: any, id: unknown): boolean {
  return ownersOf(cfg).includes(String(id ?? '').trim())
}

/** 指令前缀：清洗成 null 或单字符，空列表回落到默认。 */
export function commandPrefixesOf(cfg: any): Array<string | null> {
  const list = Array.isArray(cfg?.commandPrefixes) ? cfg.commandPrefixes : []
  const cleaned = list.map((x) => (x == null || String(x) === '' ? null : String(x).slice(0, 1)))
  return cleaned.length ? cleaned : GLOBAL_CONFIG_DEFAULTS.commandPrefixes
}
