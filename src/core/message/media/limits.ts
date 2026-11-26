export const defaultMediaLimits = { receiveImages: true, maxImageMB: 16, maxImages: 8 }

function bounded(value: unknown, fallback: number, max: number) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback
}

export function mediaLimits(value?: Partial<typeof defaultMediaLimits>) {
  return {
    receiveImages: value?.receiveImages !== false,
    maxImageMB: bounded(value?.maxImageMB, defaultMediaLimits.maxImageMB, 64),
    maxImages: bounded(value?.maxImages, defaultMediaLimits.maxImages, 16),
  }
}
