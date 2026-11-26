// 记忆库对外的调用选项。字段全部可选，调用方只传自己关心的那几个。

export interface MemoryVisibleOptions {
  gistChatId?: string
  includeGroup?: boolean
  groupChatId?: string
  ownerScope?: boolean
  scopeChatId?: string
  excludeAbout?: string
  onlyAbout?: boolean
  requireAbout?: boolean
  now?: number
  about?: string
  minRelevance?: number
  vectorHits?: Array<Record<string, any>>
  period?: Record<string, any> | null
  includeInvalid?: boolean
  allowAboutOnly?: boolean
  preferPersonal?: boolean
  minScore?: number
  rrf?: number | boolean
  limit?: number
  related?: number | boolean
  assocLimit?: number
  assocMap?: Record<string, any>
  assocHops?: number
  assocHopDecay?: number
  assoc?: boolean
  includeToday?: boolean
  background?: boolean
}

export type SearchOptions = MemoryVisibleOptions

export interface NormalizeRelationOptions { chatId?: string; names?: string[]; owner?: string }
export interface CompressionClustersOptions { now?: number; afterDays?: number; minItems?: number }
export interface ClearPersonMemoryOptions { keepNoMemory?: boolean; reset?: boolean }
export interface DeletePersonOptions { keepNoMemory?: boolean }
export interface SetNoMemoryOptions { deleteExisting?: boolean }

export interface RecallOptions {
  about?: string
  limit?: number
  where?: string
  context?: string
  onlyAbout?: boolean
  preferPersonal?: boolean
  requireAbout?: boolean
  shown?: boolean
  groupChatId?: string
  includeGroup?: boolean
  excludeAbout?: string
  vectorHits?: Array<Record<string, any>>
  period?: Record<string, any> | null
}

export interface RecallAsyncOptions { limit?: number }
export interface VectorHitsOptions { respectForget?: boolean }
export interface PersonaPersonOptions { notesLimit?: number }
export interface PersonaNotesOptions { limit?: number; offset?: number }

export interface SavePersonaPersonOptions {
  about?: string
  aboutName?: string
  tier?: string
  followUp?: Record<string, any>
  text?: string
  tags?: string[]
}

export type SaveChatOptions = SavePersonaPersonOptions

export interface GistsOptions { chatId?: string; level?: string | number; about?: string }
export interface TimelineOptions { kind?: string; platform?: string; chatId?: string; level?: string | number; about?: string }
export interface RecommendationsOptions { id?: string; kind?: string; chat?: Record<string, any> }
export interface CompressDetailsOptions { now?: number; maxCalls?: number }
export interface ConsolidateOptions { includeToday?: boolean; background?: boolean }
export interface PageOptions { limit?: number; offset?: number }
export interface NoteViaOptions { via?: string; qq?: string; who?: string; text?: string; at?: number }
export interface ContextViaOptions { qq?: string; query?: string }
