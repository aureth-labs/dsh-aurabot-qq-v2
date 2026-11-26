import { acknowledged } from '../bot/send-events.ts'

export function reallySent(receipt: unknown): boolean {
  if (!acknowledged(receipt) || receipt == null) return false
  if (Array.isArray(receipt)) return receipt.some(reallySent)
  if (typeof receipt === 'object') {
    const result = receipt as { id?: unknown; message_id?: unknown; ok?: boolean }
    return reallySent(result.id ?? result.message_id ?? (result.ok === true))
  }
  if (typeof receipt === 'string') return Boolean(receipt) && !receipt.startsWith('sim-')
  return typeof receipt === 'number' || receipt === true
}
