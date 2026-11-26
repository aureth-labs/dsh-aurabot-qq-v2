export type DeliveryOutcome = 'rejected' | 'unknown'

export class DeliveryError extends Error {
  readonly outcome: DeliveryOutcome

  constructor(message: string, outcome: DeliveryOutcome) {
    super(message)
    this.name = 'DeliveryError'
    this.outcome = outcome
  }
}

export function isDefiniteFailure(error: unknown): boolean {
  return error instanceof DeliveryError && error.outcome === 'rejected'
}
