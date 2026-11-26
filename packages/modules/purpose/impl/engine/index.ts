/**
 * 目的机制（purpose outreach）—— 纯逻辑层。
 *
 * 本目录零 I/O：副作用（读盘、投递、生成回合）都在接线层 src/purpose/module.ts，单测只测这里。
 * 按阶段分文件：types 共享类型与默认值，schedule 排程，materials 素材，drives 驱动，
 * goals 目标，select 选择，prompt 提示词与回执。
 *
 * 来源：逻辑移植自 Mieksido/surfcore 的 purpose-engine（MIT），署名与许可原文见
 * THIRD-PARTY-NOTICES.md；已按 Aurabot 的模块与配置语境改写。
 */

export * from './state/types.ts'
export * from './plan/schedule.ts'
export * from './plan/materials.ts'
export * from './state/drives.ts'
export * from './goal/goals.ts'
export * from './goal/select.ts'
export * from './reply/prompt.ts'
