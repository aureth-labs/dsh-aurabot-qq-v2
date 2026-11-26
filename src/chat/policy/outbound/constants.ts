// 出站治理的契约常量（设计稿 §3「账本」/ §4「档位与因果」）。

export const LEDGER_FILE = 'ledger.json'
export const LEDGER_VERSION = 1
export const LEDGER_MAX_ITEMS = 200
export const LEDGER_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_TEXT_BYTES = 8 * 1024

export const DEFAULT_TIER = 'pass'
export const TIERS = ['pass', 'gate', 'broker']

export const ACTIVE_MODES = ['purpose', 'auto']
export const LEGACY_ACTIVE_MODES = { speakup: 'purpose' }
export const POLICY_READY_STATE = 'ready'

export const CAUSES = ['reply', 'delegation', 'background', 'unknown']
export const KNOWN_STATES = ['pending', 'sending', 'sent', 'dropped', 'failed', 'uncertain', 'expired']
export const RESERVE_REASONS = ['quiet', 'budget', 'cooldown', 'busy', 'error']
