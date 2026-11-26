export function reallySent(receipt: { message_id?: unknown } | null | undefined) {
  return receipt?.message_id != null && !String(receipt.message_id).startsWith('sim-')
}
