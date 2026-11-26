export type DeliveryOutcome = 'rejected' | 'unknown'

export class DeliveryError extends Error {
  readonly code = 'AURABOT_DELIVERY'
  readonly outcome: DeliveryOutcome

  constructor(message: string, outcome: DeliveryOutcome) {
    super(message)
    this.name = 'DeliveryError'
    this.outcome = outcome
  }
}

export function isDefiniteFailure(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'AURABOT_DELIVERY' && 'outcome' in error && error.outcome === 'rejected'
}
