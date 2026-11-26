export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface TurnReceipt {
  ok: boolean
  silent?: boolean
  text?: string
  error?: string
  result?: { sent?: string }
  suppressed?: boolean
}

export interface PushToSessionOptions {
  assertAuthorized?: () => void
  turnToken?: object
  onTurnEnd?: (receipt: TurnReceipt) => void
  onDelivered?: (...args: unknown[]) => unknown
  steer?: boolean
  queryText?: string
  extraSenders?: Array<string | number>
  speakers?: Array<string | number>
  directRequester?: unknown
  quoteIds?: string[]
  autoReply?: unknown
  archiveMessages?: Record<string, unknown>[]
  suppressDelivery?: boolean
  wantVoice?: boolean
}

export interface RunTurnInChatOptions {
  noTools?: boolean
  timeoutMs?: number
  userText?: string
  kind?: string
  suppressDelivery?: boolean
}

export interface ReceiveOwnerMessageOptions {
  text?: string
  image?: Buffer
  wav?: Buffer
  via?: string
  originId?: string
  assertAuthorized?: () => void
}

export interface RunSystemTurnOptions {
  timeoutMs?: number
  noTools?: boolean
  key?: string
  presetId?: string
  level?: string
  model?: ModelSelection
}
