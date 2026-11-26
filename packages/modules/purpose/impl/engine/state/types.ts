// 目的机制的共享类型与默认值：排程、素材、驱动、目标、选择、提示词都从这里取。

// 心情项（情绪字典）的唯一真相在心情模块那边：这里只借用出厂的默认十项做快照与兜底。
import {
  DEFAULT_EMOTIONS, emotionLabels, emotionProfiles, profileOf, resolveEmotion,
} from '../../../../../../src/persona/emotions.ts';

/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type NormalizePurposeConfigOptions = Partial<Record<'ownerQQ', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type EnsurePurposeScheduleOptions = Partial<Record<'now' | 'config' | 'random', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type BestReplyHourShiftOptions = Partial<Record<'maxShiftMs', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type BestReplyWeekdayShiftOptions = Partial<Record<'minSamples', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type PlanNextFireOptions = Partial<Record<'now' | 'config' | 'lastRunAt' | 'countToday' | 'replyHours' | 'replyWeekday' | 'random', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type EvaluatePurposeTickOptions = Partial<Record<'now' | 'config' | 'state' | 'env' | 'random', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type MarkPurposeDeliveredOptions = Partial<Record<'now' | 'planned', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type MarkPurposeSkipOptions = Partial<Record<'now' | 'reason' | 'nextFireAt', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type ApplyPurposeOutcomeOptions = Partial<Record<'now' | 'config' | 'outcome' | 'text' | 'memo' | 'planned' | 'random', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type PrunePurposeStateOptions = Partial<Record<'now' | 'config', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type CollectMaterialsOptions = Partial<Record<'now' | 'config' | 'ownerUin' | 'ownerKey' | 'roleName' | 'roleAliases' | 'conversations' | 'biliEntries' | 'memoryRecords' | 'followUpRecords', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type DeriveDrivesOptions = Partial<Record<'drives' | 'drivesAt' | 'materials' | 'now' | 'lastMasterAt' | 'personaBias' | 'needFeedback' | 'halfLifeHours' | 'connectFloor', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type AppraiseMaterialOptions = Partial<Record<'material' | 'need' | 'now' | 'lastMasterAt', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type SatisfyDrivesOptions = Partial<Record<'need' | 'action' | 'outcome', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type NormalizeMoodsOptions = Partial<Record<'at' | 'outcome' | 'kind' | 'need' | 'action' | 'emotion' | 'purpose' | 'text' | 'planned' | 'sourceId' | 'goalId' | 'goalOwner' | 'confidence' | 'id' | 'source' | 'createdAt' | 'expiresAt' | 'hits' | 'day' | 'countToday' | 'lastRunAt' | 'lastAttemptAt' | 'lastSentAt' | 'lastOutcome' | 'lastPurpose' | 'lastText' | 'nextFireAt' | 'attempts' | 'drives' | 'drivesAt' | 'replyHours' | 'replyWeekday' | 'replyHoursSeen' | 'needFeedback' | 'lastEmotion' | 'lastEmotionText' | 'moods' | 'moodsAt' | 'moodsMigratedAt' | 'lastGoalId' | 'lastMaterialCount' | 'lastCandidateCount' | 'goals' | 'observations' | 'pending' | 'history' | 'lastSkip' | 'toLowerCase' | 'replace' | 'trim' | 'includes' | 'key' | 'domain' | 'object' | 'count' | 'firstAt' | 'lastAt' | 'subjects' | 'positive' | 'negative' | 'seenIds' | 'intent' | 'owner' | 'evidence' | 'value' | 'urgency' | 'risk' | 'nextStep' | 'status' | 'lastSeenAt' | 'lastActionAt' | 'lastFeedbackAt' | 'sightings', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type DeriveMoodsOptions = Partial<Record<'moods' | 'moodsAt' | 'lastEmotion' | 'now' | 'halfLifeHours', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type AnalyzeEventOptions = Partial<Record<'drives' | 'persistence' | 'roleName', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type MakeGoalOptions = Partial<Record<'owner' | 'domain' | 'object' | 'intent' | 'action' | 'evidence' | 'confidence' | 'value' | 'urgency' | 'risk' | 'emotion' | 'now' | 'ttlDays' | 'source' | 'status', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type HypothesesForEventOptions = Partial<Record<'drives' | 'now' | 'lastMasterAt' | 'hoursSinceMaster' | 'riskScale', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type MergeGoalOptions = Partial<Record<'fresh', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type PersonaGoalSpecOptions = Partial<Record<'now' | 'lastMasterAt' | 'hoursSinceMaster', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type FormGoalHypothesesOptions = Partial<Record<'materials' | 'goals' | 'observations' | 'drives' | 'now' | 'lastMasterAt' | 'config' | 'roleName' | 'persona', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type ActionForNeedOptions = Partial<Record<'emotion' | 'hoursSinceMaster', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type IntentForNeedOptions = Partial<Record<'emotion' | 'hoursSinceMaster' | 'relation', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type MinePurposeSeedsOptions = Partial<Record<'materials' | 'now' | 'roleName' | 'config' | 'drives' | 'history' | 'lastMasterAt', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type AddOptions = Partial<Record<'need' | 'emotion' | 'action' | 'topic', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type SelectPurposeOptions = Partial<Record<'seeds' | 'goals' | 'pending' | 'history' | 'config' | 'drives' | 'now' | 'lastMasterAt' | 'random' | 'emotions', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type BuildPurposePromptOptions = Partial<Record<'now' | 'config' | 'mode' | 'ownerUin' | 'ownerName' | 'token' | 'contextBlocks' | 'materials' | 'candidates' | 'selected' | 'pending' | 'history' | 'stats' | 'drives' | 'emotions', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type ParseFeelingsOptions = Partial<Record<'need', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type AddPendingPurposeOptions = Partial<Record<'text' | 'kind' | 'need' | 'action' | 'emotion' | 'now' | 'config', any>>
/** 迁移期选项对象：属性名固定，值按调用方传。 */
export type SummarizePurposeStateOptions = Partial<Record<'config' | 'now' | 'emotions', any>>

export const PURPOSE_STATE_VERSION = 1;
export const FOLLOW_UP_WEIGHT = 4;

/** 默认值刻意保守：白天每 2.5~5 小时最多一次，一天最多 4 次，23:30~08:30 不打扰。 */
/** 主动搭话的默认配置：字段类型写宽，具体取值由面板 / 人格卡覆写。 */
export interface PurposeConfigShape {
  enabled: boolean
  ownerUin: string
  gapMinMs: number
  gapMaxMs: number
  initialDelayMinMs: number
  dailyMax: number
  quietStart: string
  quietEnd: string
  idleThresholdMs: number
  materialWindowHours: number
  biliWindowDays: number
  maxMaterials: number
  minMaterials: number
  retryMs: number
  maxAttempts: number
  historyLimit: number
  pendingTtlDays: number
  maxCandidates: number
  promptMaxChars: number
  pendingShareProbability: number
  lonelyEmotionWeight: number
  enviousEmotionWeight: number
  needRepeatPenalty: number
  needRepeatPenalty2: number
  driveHalfLifeHours: number
  riskScale: number
}

export const DEFAULT_PURPOSE_CONFIG: Readonly<PurposeConfigShape> = Object.freeze({
  enabled: true,
  ownerUin: '',
  gapMinMs: 150 * 60 * 1000,
  gapMaxMs: 300 * 60 * 1000,
  initialDelayMinMs: 30 * 60 * 1000,
  dailyMax: 4,
  quietStart: '23:30',
  quietEnd: '08:30',
  idleThresholdMs: 30 * 60 * 1000,
  materialWindowHours: 72,
  biliWindowDays: 7,
  maxMaterials: 36,
  minMaterials: 2,
  retryMs: 15 * 60 * 1000,
  maxAttempts: 3,
  historyLimit: 60,
  pendingTtlDays: 14,
  maxCandidates: 6,
  promptMaxChars: 16000,
  pendingShareProbability: 0.5,
  lonelyEmotionWeight: 1.2,
  enviousEmotionWeight: 1.1,
  needRepeatPenalty: 0.72,
  needRepeatPenalty2: 0.65,
  driveHalfLifeHours: 8,
  riskScale: 1,
});

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function isPlainObject(value): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function clip(text, max = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 群聊素材里常带 QQ 号；给主人看的摘要不带号，只留事。 */
export function redactNumbers(text) {
  return String(text ?? '').replace(/\b\d{6,12}\b/g, '[号码]');
}

