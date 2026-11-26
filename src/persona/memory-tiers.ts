export const FACT_TIERS = [
  { id: 4, label: '短暂', days: 1 },
  { id: 1, label: '琐碎', days: 7 },
  { id: 5, label: '小事', days: 15 },
  { id: 2, label: '一般', days: 30, followUp: true },
  { id: 3, label: '重要', days: 90, followUp: true },
  { id: 0, label: '永久', days: null },
]
export const DEFAULT_TIER_DAYS = Object.fromEntries(FACT_TIERS.filter((t) => t.days !== null).map((t) => [t.id, t.days]))
