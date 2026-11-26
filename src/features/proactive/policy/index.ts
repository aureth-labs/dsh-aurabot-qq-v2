// ---------------------------------------------------------------------------
// 出站策略源：主动发言的「门闸判定」与「额度账本」（B 线）
//
// 来源：
//   · 接口契约 —— 见 docs/OUTBOUND-POLICY-DESIGN.md §4「策略源接口」；
//     tick 里的 `awake && idleOk && count < maxPerDay && Date.now() >= nextAt`；
//     reserve 复用同一判定，commit 成功才 `count++` 并重排 nextAt；
//   · 「目的引擎」判定口径 —— `src/purpose/engine.js` 的 evaluatePurposeTick（L324-348，只判不扣）
//     与 markPurposeDelivered（L351-359，投递即占「生成尝试额度」，沉默/失败也计入）。
//
export { createSharedBudget, resetSharedBudgets } from './budget.ts'
export type { CreateSharedBudgetOptions, SetLimitsOptions, TryAcquireOptions, SettleOptions } from './budget.ts'
export { createPurposePolicy } from './purpose.ts'
export type { CreatePurposePolicyOptions, EvaluateOptions, ReserveOptions, CommitOptions, ReleaseOptions, NoteAttemptOptions, ReserveReviewOptions } from './purpose.ts'
export { REASON_TEXT, REASONS, OUTCOMES } from './helpers.ts'
