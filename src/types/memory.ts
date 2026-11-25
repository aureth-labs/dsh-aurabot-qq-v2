/**
 * 记忆库的数据形状。
 *
 * 记忆是整份 JSON 落盘、按行存进 SQLite 的「文档型」数据，字段会随着迁移不断加，
 * 所以这里只声明业务真正会读写的字段，其余历史字段用索引签名兜住，避免每加一个字段就要改一次类型。
 */

/** 平台侧原文的溯源信息（「看到过」类记忆用）。 */
export interface MemoryMeta {
  platform?: string
  id?: string
  url?: string
  title?: string
  author?: string
  [field: string]: any
}

/** 跟进事项：隔几天再问一次，问满两次就放下。 */
export interface MemoryFollowUp {
  tries: number
  at: number
  /** 跟进时要问的原话。 */
  question?: string
}

/** 一条记忆。 */
export interface MemoryItem {
  id: string
  text: string
  about?: string
  aboutName?: string
  about_qq?: string
  tags?: string[]
  importance?: number
  source?: string
  chatId?: string
  /** 最后一次改动时间，算遗忘用。 */
  at?: number
  /** 这件事在聊天里说出来的时间，给她看的是这个。 */
  saidAt?: number
  hits?: number
  lastHit?: number
  validFrom?: number
  validUntil?: number
  invalidAt?: number
  archivedAt?: number
  supersededBy?: string
  kind?: string
  meta?: MemoryMeta
  speaker?: string
  status?: string
  /** 事实档位：0~3 是数字档，'core' 是永久档，历史数据两种都有。 */
  tier?: string | number
  scope?: string
  followUp?: MemoryFollowUp
  related?: string[]
  assocSeen?: number
  [field: string]: any
}

/** 归档进「星云」的摘要条目。 */
export interface MemoryGist {
  id: string
  text: string
  chatId?: string
  kind?: string
  about?: string
  level?: number
  [field: string]: any
}

/**
 * 联想边：记忆 id → 相关记忆及其权重。
 * 历史数据里权重有两种写法：`{ 对方id: 权重 }` 和 `[[对方id, 权重], …]`，两种都要认。
 */
export type MemoryAssocMap = Record<string, any>

/** 整份记忆库。 */
export interface MemoryState {
  items: MemoryItem[]
  gists?: MemoryGist[]
  assoc?: MemoryAssocMap
  rev?: number
  [field: string]: any
}

/** 写入一条记忆时的入参。 */
export interface MemoryInput {
  text?: string
  about?: string
  aboutName?: string
  tags?: string[]
  importance?: number
  source?: string
  chatId?: string
  saidAt?: number
  speaker?: string
  status?: string
  scope?: string
  tier?: string | number
  validFrom?: string | number
  validUntil?: string | number
  kind?: string
  meta?: MemoryMeta
  followUp?: MemoryFollowUp | null
  guard?: ((item: MemoryItem) => boolean) | null
  acquaintedOnly?: boolean
}

/** 记忆星图上的星点状态。 */
export interface MemoryStar {
  id: string
  S?: number
  lastHit?: number
  fixedLabel?: boolean
  x?: number
  y?: number
  z?: number
  [field: string]: any
}

/**
 * 语义索引的对外接口。
 *
 * 有两套实现：`remote`（兼容 OpenAI 的 embedding 服务）和 `local`（本机 bge-small）。
 * 本地实现多出 `all / neighbors / ready / modelStatus` 这几个只有离线模型才用得上的方法，
 * 所以这里按「共同契约 + 可选扩展」来声明，调用方不必关心拿到的是哪一套。
 */
export interface VectorIndex {
  embed(texts: string[]): Promise<number[][]>
  queryVector(text: string): Promise<number[] | null>
  search(vec: number[], ids?: string[] | null, limit?: number): Array<{ id: string; similarity: number }>
  sync(items: MemoryItem[], latest?: () => any): Promise<any>
  count(items?: MemoryItem[]): number
  status(items?: MemoryItem[]): any
  test(text?: string): Promise<any>
  reset?(): any
  mode?: string
  model?: string
  readonly error?: string
  validIds?: any
  all?: any
  neighbors?: any
  ready?: any
  modelStatus?: any
  [field: string]: any
}
