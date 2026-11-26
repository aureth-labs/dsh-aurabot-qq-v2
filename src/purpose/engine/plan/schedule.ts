// 排程与状态迁移：几点该开口、本次轮到谁、发完之后状态怎么走。

import { DEFAULT_EMOTIONS, emotionLabels, emotionProfiles, profileOf, resolveEmotion } from '../../../features/mood/emotions.ts'
import { PURPOSE_STATE_VERSION, FOLLOW_UP_WEIGHT, DEFAULT_PURPOSE_CONFIG, MINUTE, HOUR, DAY, isPlainObject, clampInt, clip, redactNumbers } from '../state/types.ts'
import type { PurposeConfigShape, NormalizePurposeConfigOptions, EnsurePurposeScheduleOptions, BestReplyHourShiftOptions, BestReplyWeekdayShiftOptions, PlanNextFireOptions, EvaluatePurposeTickOptions, MarkPurposeDeliveredOptions, MarkPurposeSkipOptions, ApplyPurposeOutcomeOptions, PrunePurposeStateOptions, CollectMaterialsOptions, DeriveDrivesOptions, AppraiseMaterialOptions, SatisfyDrivesOptions, NormalizeMoodsOptions, DeriveMoodsOptions, AnalyzeEventOptions, MakeGoalOptions, HypothesesForEventOptions, MergeGoalOptions, PersonaGoalSpecOptions, FormGoalHypothesesOptions, ActionForNeedOptions, IntentForNeedOptions, MinePurposeSeedsOptions, AddOptions, SelectPurposeOptions, BuildPurposePromptOptions, ParseFeelingsOptions, AddPendingPurposeOptions, SummarizePurposeStateOptions } from '../state/types.ts'
import { clamp01 } from '../goal/goals.ts'
import { DEFAULT_DRIVES } from '../state/drives.ts'
import { PURPOSE_NEEDS } from '../state/drives.ts'
import { GOAL_OWNERS } from '../state/drives.ts'
import { hashId } from './materials.ts'
import { normalizeDrives } from '../state/drives.ts'
import { normalizeMoods } from '../state/drives.ts'
import { normalizeGoals } from '../goal/goals.ts'
import { updateObservations } from '../goal/goals.ts'
import { satisfyDrives } from '../state/drives.ts'
import { applyFeelingDeltas } from '../reply/prompt.ts'
import { addPendingPurpose } from '../reply/prompt.ts'
import { resolvePendingPurpose } from '../reply/prompt.ts'

export function localDateKey(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function clockText(hh, mm) {
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** `"8:00"` / `"08:00"` → `{ hh, mm, text }`；非法值回退 fallback。 */
export function parseClock(value, fallback = '08:00') {
  const pick = (raw) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  };
  const parsed = pick(value) ?? pick(fallback) ?? { hh: 8, mm: 0 };
  return { ...parsed, text: clockText(parsed.hh, parsed.mm) };
}

function minutesOfDay(at) {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

/** 安静时段是否包含 now；quietStart === quietEnd 视为不启用。 */
export function inQuietHours(now, config: Partial<PurposeConfigShape> = DEFAULT_PURPOSE_CONFIG) {
  const start = parseClock(config.quietStart, '23:30');
  const end = parseClock(config.quietEnd, '08:30');
  if (start.text === end.text) return false;
  const s = start.hh * 60 + start.mm;
  const e = end.hh * 60 + end.mm;
  const m = minutesOfDay(now);
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
}

/** 下一个「安静结束」时刻（严格晚于 now）。 */
export function quietEndAfter(now, config: Partial<PurposeConfigShape> = DEFAULT_PURPOSE_CONFIG) {
  const end = parseClock(config.quietEnd, '08:30');
  const d = new Date(now);
  d.setHours(end.hh, end.mm, 0, 0);
  while (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 下一天的起点（安静结束优先；没设安静时段就取次日 00:05）。 */
export function nextDayStartAfter(now, config: Partial<PurposeConfigShape> = DEFAULT_PURPOSE_CONFIG) {
  const start = parseClock(config.quietStart, '23:30');
  const end = parseClock(config.quietEnd, '08:30');
  if (start.text !== end.text) return quietEndAfter(now, config);
  const d = new Date(now);
  d.setHours(0, 5, 0, 0);
  while (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function normalizePurposeConfig(input: Record<string, any> = {}, { ownerQQ = '' } : NormalizePurposeConfigOptions = {}) {
  const src = isPlainObject(input) ? input : {};
  const fallbackOwner = String(ownerQQ ?? '').replace(/[^\d]/g, '').slice(0, 12);
  const rawOwner = String(src.ownerUin ?? '').replace(/[^\d]/g, '').slice(0, 12);
  const gapMinMs = clampInt(src.gapMinMs, DEFAULT_PURPOSE_CONFIG.gapMinMs, 5 * MINUTE, 24 * HOUR);
  const gapMaxMs = clampInt(src.gapMaxMs, Math.max(gapMinMs, DEFAULT_PURPOSE_CONFIG.gapMaxMs), gapMinMs, 24 * HOUR);
  return {
    enabled: src.enabled !== false,
    ownerUin: rawOwner || fallbackOwner,
    gapMinMs,
    gapMaxMs,
    initialDelayMinMs: clampInt(src.initialDelayMinMs, DEFAULT_PURPOSE_CONFIG.initialDelayMinMs, MINUTE, 12 * HOUR),
    // 0 = 不限次数（仍受 token 额度与安静时段约束）。
    dailyMax: clampInt(src.dailyMax, DEFAULT_PURPOSE_CONFIG.dailyMax, 0, 24),
    quietStart: parseClock(src.quietStart, DEFAULT_PURPOSE_CONFIG.quietStart).text,
    quietEnd: parseClock(src.quietEnd, DEFAULT_PURPOSE_CONFIG.quietEnd).text,
    idleThresholdMs: clampInt(src.idleThresholdMs, DEFAULT_PURPOSE_CONFIG.idleThresholdMs, 0, 12 * HOUR),
    materialWindowHours: clampInt(src.materialWindowHours, DEFAULT_PURPOSE_CONFIG.materialWindowHours, 1, 24 * 14),
    biliWindowDays: clampInt(src.biliWindowDays, DEFAULT_PURPOSE_CONFIG.biliWindowDays, 1, 60),
    maxMaterials: clampInt(src.maxMaterials, DEFAULT_PURPOSE_CONFIG.maxMaterials, 6, 80),
    minMaterials: clampInt(src.minMaterials, DEFAULT_PURPOSE_CONFIG.minMaterials, 0, 20),
    retryMs: clampInt(src.retryMs, DEFAULT_PURPOSE_CONFIG.retryMs, MINUTE, 6 * HOUR),
    maxAttempts: clampInt(src.maxAttempts, DEFAULT_PURPOSE_CONFIG.maxAttempts, 1, 10),
    historyLimit: clampInt(src.historyLimit, DEFAULT_PURPOSE_CONFIG.historyLimit, 10, 200),
    pendingTtlDays: clampInt(src.pendingTtlDays, DEFAULT_PURPOSE_CONFIG.pendingTtlDays, 1, 90),
    maxCandidates: clampInt(src.maxCandidates, DEFAULT_PURPOSE_CONFIG.maxCandidates, 3, 10),
    promptMaxChars: clampInt(src.promptMaxChars, DEFAULT_PURPOSE_CONFIG.promptMaxChars, 4000, 30000),
    pendingShareProbability: clamp01(src.pendingShareProbability, DEFAULT_PURPOSE_CONFIG.pendingShareProbability),
    lonelyEmotionWeight: Math.min(2, Math.max(1, Number(src.lonelyEmotionWeight) || DEFAULT_PURPOSE_CONFIG.lonelyEmotionWeight)),
    enviousEmotionWeight: Math.min(2, Math.max(1, Number(src.enviousEmotionWeight) || DEFAULT_PURPOSE_CONFIG.enviousEmotionWeight)),
    needRepeatPenalty: Math.min(1, Math.max(0.3, Number(src.needRepeatPenalty) || DEFAULT_PURPOSE_CONFIG.needRepeatPenalty)),
    needRepeatPenalty2: Math.min(1, Math.max(0.3, Number(src.needRepeatPenalty2) || DEFAULT_PURPOSE_CONFIG.needRepeatPenalty2)),
    driveHalfLifeHours: clampInt(src.driveHalfLifeHours, DEFAULT_PURPOSE_CONFIG.driveHalfLifeHours, 1, 72),
    riskScale: Math.min(2, Math.max(0.3, Number(src.riskScale) || 1)),
  };
}

export function createPurposeState(now = Date.now()) {
  return {
    version: PURPOSE_STATE_VERSION,
    day: localDateKey(now),
    countToday: 0,
    lastRunAt: 0,
    lastAttemptAt: 0,
    lastSentAt: 0,
    lastOutcome: '',
    lastPurpose: '',
    lastText: '',
    nextFireAt: 0,
    attempts: 0,
    // 驱动向量：为什么今天特别想玩 / 特别想找人说话。跨天保留，随时间衰减。
    drives: { ...DEFAULT_DRIVES },
    drivesAt: now,
    // 主人回复时段直方图（24 桶计数 + 星期 7 桶 + 已记素材 id）：往主人更容易在线的小时/日子轻推排程。
    replyHours: new Array(24).fill(0),
    replyWeekday: new Array(7).fill(0),
    replyHoursSeen: [],
    // 需要维度的长期正反馈账本：{ play: {positive, negative, neutral} ... }。
    needFeedback: {},
    lastEmotion: '',
    lastEmotionText: '',
    // 【已废弃·仅为迁移保留】心情向量 2026-11-17 起归心情模块（mood.json 的 emotions/emotionsAt）。
    // 这里只负责把老存档里的这两个字段读出来交给接线层迁移（purpose/module.js 的 loadState），
    // 引擎自己不再写、面板不再读；等老用户都迁过一轮后连同 normalize 分支一起删。
    moods: {},
    moodsAt: 0,
    moodsMigratedAt: 0,
    lastGoalId: '',
    // 给设置页画「这一轮链路」用的计数（不参与决策）。
    lastMaterialCount: 0,
    lastCandidateCount: 0,
    // 目标假设 / 观察账本：让「一次视频」不等于「永久欲望」，也区分群友的想玩与她的想玩。
    goals: [],
    observations: [],
    pending: [],
    history: [],
    lastSkip: null,
  };
}

function normalizeHistoryEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const at = Number(raw.at) || 0;
  if (!at) return null;
  return {
    at,
    outcome: String(raw.outcome ?? '').slice(0, 20),
    kind: String(raw.kind ?? '').slice(0, 20),
    need: PURPOSE_NEEDS.includes(raw.need) ? raw.need : '',
    action: String(raw.action ?? '').slice(0, 20),
    emotion: String(raw.emotion ?? '').slice(0, 20),
    purpose: clip(raw.purpose, 120),
    text: clip(raw.text, 200),
    planned: clip(raw.planned, 120),
    sourceId: clip(raw.sourceId, 80),
    goalId: String(raw.goalId ?? '').slice(0, 24),
    goalOwner: GOAL_OWNERS.includes(raw.goalOwner) ? raw.goalOwner : '',
    confidence: Number.isFinite(Number(raw.confidence)) ? clamp01(raw.confidence, 0) : null,
  };
}

function normalizePendingEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const text = clip(raw.text, 120);
  if (!text) return null;
  return {
    id: String(raw.id ?? '').slice(0, 24) || `p-${hashId(text)}`,
    kind: String(raw.kind ?? 'share').slice(0, 20),
    need: PURPOSE_NEEDS.includes(raw.need) ? raw.need : '',
    action: String(raw.action ?? '').slice(0, 20),
    emotion: String(raw.emotion ?? '').slice(0, 20),
    text,
    source: String(raw.source ?? '').slice(0, 20),
    createdAt: Number(raw.createdAt) || Date.now(),
    expiresAt: Number(raw.expiresAt) || 0,
    hits: clampInt(raw.hits, 0, 0, 99),
  };
}

export function normalizePurposeState(raw, now = Date.now()) {
  const base = createPurposeState(now);
  if (!isPlainObject(raw)) return base;
  base.day = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.day ?? '')) ? String(raw.day) : localDateKey(now);
  base.countToday = clampInt(raw.countToday, 0, 0, 99);
  base.lastRunAt = Number(raw.lastRunAt) || 0;
  base.lastAttemptAt = Number(raw.lastAttemptAt) || 0;
  base.lastSentAt = Number(raw.lastSentAt) || 0;
  base.lastOutcome = String(raw.lastOutcome ?? '').slice(0, 24);
  base.lastPurpose = clip(raw.lastPurpose, 120);
  base.lastText = clip(raw.lastText, 200);
  base.nextFireAt = Number(raw.nextFireAt) || 0;
  base.attempts = clampInt(raw.attempts, 0, 0, 20);
  base.drives = normalizeDrives(raw.drives);
  base.drivesAt = Number(raw.drivesAt) || 0;
  base.replyHours = normalizeReplyHours(raw.replyHours);
  base.replyWeekday = normalizeCounts(raw.replyWeekday, 7);
  base.replyHoursSeen = (Array.isArray(raw.replyHoursSeen) ? raw.replyHoursSeen : []).map(String).slice(-200);
  base.needFeedback = normalizeNeedFeedback(raw.needFeedback);
  base.lastEmotion = String(raw.lastEmotion ?? '').slice(0, 20);
  base.lastEmotionText = clip(raw.lastEmotionText, 30);
  base.moods = normalizeMoods(raw.moods);
  base.moodsAt = Number(raw.moodsAt) || 0;
  // 迁移标记：旧向量搬去心情模块后打在状态文件上，normalize 必须保留它，否则每次启动都会重新搬。
  base.moodsMigratedAt = Number(raw.moodsMigratedAt) || 0;
  base.lastGoalId = String(raw.lastGoalId ?? '').slice(0, 24);
  base.lastMaterialCount = clampInt(raw.lastMaterialCount, 0, 0, 999);
  base.lastCandidateCount = clampInt(raw.lastCandidateCount, 0, 0, 99);
  base.goals = normalizeGoals(raw.goals, now);
  base.observations = updateObservations(raw.observations, [], now);
  base.pending = (Array.isArray(raw.pending) ? raw.pending : []).map(normalizePendingEntry).filter(Boolean).slice(-20);
  base.history = (Array.isArray(raw.history) ? raw.history : []).map(normalizeHistoryEntry).filter(Boolean).slice(-200);
  base.lastSkip = isPlainObject(raw.lastSkip)
    ? { at: Number(raw.lastSkip.at) || 0, reason: String(raw.lastSkip.reason ?? '').slice(0, 80) }
    : null;
  return base;
}

/** 跨天重置今日次数（不重置 nextFireAt；排程会自己纠正）。 */
export function ensurePurposeDay(state, now = Date.now()) {
  const day = localDateKey(now);
  if (state.day !== day) {
    state.day = day;
    state.countToday = 0;
  }
  return state;
}

/** 首次启动 / 状态里没有 nextFireAt 时，排一个初始延迟（落在安静时段就推到安静结束）。 */
export function ensurePurposeSchedule(state, { now = Date.now(), config = DEFAULT_PURPOSE_CONFIG, random = Math.random } : EnsurePurposeScheduleOptions = {}) {
  if (!state.nextFireAt) {
    let at = now + Math.max(MINUTE, Math.min(config.initialDelayMinMs, config.gapMinMs));
    // 重启后的首次排程同样吃时段学习（老状态里已有的直方图不该只在 gap 排程里生效）。
    const shift = bestReplyHourShift(at, state.replyHours);
    if (shift > 0) at += shift;
    if (inQuietHours(at, config)) at = quietEndAfter(at, config) + Math.round(random() * 20 * MINUTE);
    state.nextFireAt = at;
  }
  return state;
}

// ── 主人回复时段直方图（轻量学习：她慢慢知道主人几点最容易回）────────────────
function normalizeCounts(raw, len) {
  const out = new Array(len).fill(0);
  if (Array.isArray(raw)) {
    for (let h = 0; h < len; h += 1) {
      const n = Number(raw[h]);
      if (Number.isFinite(n) && n > 0) out[h] = Math.min(9999, Math.round(n));
    }
  }
  return out;
}

const normalizeReplyHours = (raw) => normalizeCounts(raw, 24);

/** 需要维度的反馈账本：坏值丢弃，计数钳到 0~9999。 */
function normalizeNeedFeedback(raw) {
  const out: Record<string, any> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const need of PURPOSE_NEEDS) {
    const s = raw[need];
    if (!s || typeof s !== 'object') continue;
    const entry = {
      positive: clampInt(s.positive, 0, 0, 9999),
      negative: clampInt(s.negative, 0, 0, 9999),
      neutral: clampInt(s.neutral, 0, 0, 9999),
    };
    if (entry.positive || entry.negative || entry.neutral) out[need] = entry;
  }
  return out;
}

/** 把素材里主人的私聊发言时刻记进 24 小时 × 星期直方图（按素材 id 去重，无 id 用时刻键）。 */
export function recordOwnerReplyHours(state, materials, now = Date.now()) {
  const hist = normalizeReplyHours(state.replyHours);
  const week = normalizeCounts(state.replyWeekday, 7);
  const seen = new Set(Array.isArray(state.replyHoursSeen) ? state.replyHoursSeen.map(String) : []);
  let changed = false;
  for (const m of Array.isArray(materials) ? materials : []) {
    if (m?.kind !== 'owner') continue;
    const at = Number(m.at) || 0;
    if (!at || at > now) continue;
    const id = String(m.id ?? '') || `t:${at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const d = new Date(at);
    hist[d.getHours()] += 1;
    week[d.getDay()] += 1;
    changed = true;
  }
  if (changed) {
    state.replyHours = hist;
    state.replyWeekday = week;
    state.replyHoursSeen = [...seen].slice(-200);
  }
  return state;
}

/**
 * 基于直方图给候选时刻找更好的落点：只在 +0~maxShift 内向后找，
 * 且只有某小时的回复密度明显更高（>1.1×）才移过去；样本 <5 条时不偏置。
 */
export function bestReplyHourShift(at, replyHours = [], { maxShiftMs = 3 * HOUR } : BestReplyHourShiftOptions = {}) {
  const hist = normalizeReplyHours(replyHours);
  const total = hist.reduce((s, v) => s + v, 0);
  if (total < 5) return 0;
  const score = (t) => hist[new Date(t).getHours()] / total;
  let best = 0;
  let bestScore = score(at);
  for (let off = 15 * MINUTE; off <= maxShiftMs; off += 15 * MINUTE) {
    const s = score(at + off);
    if (s > bestScore * 1.1) { bestScore = s; best = off; }
  }
  return best;
}

/**
 * 星期分桶：今天是不是主人常回话的日子？不是就往未来 7 天里第一个高回流日挪（≤7 天）。
 * 样本 <7 条不偏置；今天已是高回流日（≥最佳日 50%）不动。
 * 分散度门槛：非零桶 <2 不偏置——样本全挤在一个星期几（某一天聊得特别多）不代表
 * 「主人只在那天回话」，照着偏会把下次主动整整推走一周（2026-11-06 实测踩到）。
 */
export function bestReplyWeekdayShift(at, replyWeekday = [], { minSamples = 7 } : BestReplyWeekdayShiftOptions = {}) {
  const hist = normalizeCounts(replyWeekday, 7);
  const total = hist.reduce((s, v) => s + v, 0);
  if (total < minSamples) return 0;
  const days = hist.filter((v) => v > 0).length;
  if (days < 2) return 0;
  const best = Math.max(...hist);
  if (best <= 0) return 0;
  const cur = hist[new Date(at).getDay()];
  if (cur >= best * 0.5) return 0;
  for (let add = 1; add <= 7; add += 1) {
    const t = new Date(at);
    t.setDate(t.getDate() + add);
    if (hist[t.getDay()] >= best * 0.8) return t.getTime() - at;
  }
  return 0;
}

/**
 * 下一次该在什么时候主动找主人。
 * · 距上次「真正完成」至少 gapMin~gapMax；
 * · 桥接停机很久后只补一枪（不连着补）；
 * · 有回复时段直方图时，向主人更可能在线的小时轻推（最多 3 小时）；
 *   星期分桶再往主人常回话的日子轻推（最多 7 天，样本 <7 不偏置）；
 * · 算出来落在安静时段就推到安静结束 + 0~20 分钟抖动。
 */
export function planNextFire({
  now = Date.now(),
  config = DEFAULT_PURPOSE_CONFIG,
  lastRunAt = 0,
  countToday = 0,
  replyHours = [],
  replyWeekday = [],
  random = Math.random,
} : PlanNextFireOptions = {}) {
  const min = Math.max(5 * MINUTE, Number(config.gapMinMs) || DEFAULT_PURPOSE_CONFIG.gapMinMs);
  const max = Math.max(min, Number(config.gapMaxMs) || min);
  const gap = Math.round(min + random() * (max - min));
  let at;
  if (config.dailyMax > 0 && countToday >= config.dailyMax) {
    at = nextDayStartAfter(now, config);
  } else if (lastRunAt > 0) {
    at = lastRunAt + gap;
    // 停机很久：别攒一堆补发，只补一枪（2 分钟后）。
    if (at < now + 2 * MINUTE) at = now + 2 * MINUTE;
  } else {
    at = now + Math.max(MINUTE, Math.min(config.initialDelayMinMs, min));
  }
  // 时段学习：主人常在几点回，就往那几点轻推一下（停在安静时段判定之前，之后还会被推离安静）。
  const shift = bestReplyHourShift(at, replyHours);
  if (shift > 0) at += shift;
  // 星期学习：今天不是主人常回话的日子，就挪到下一个高回流日的同一时刻。
  const dayShift = bestReplyWeekdayShift(at, replyWeekday);
  if (dayShift > 0) at += dayShift;
  if (inQuietHours(at, config)) at = quietEndAfter(at, config) + Math.round(random() * 20 * MINUTE);
  return at;
}

function waitUntil(at, reason) {
  return { action: 'wait', reason, nextFireAt: Math.max(0, Math.round(at)) };
}

/**
 * 每次 tick 的判定：能不能现在主动找主人。
 * env 由接线层提供（都是便宜的状态，不读大文件）：
 *   enabled / modeOk / dshReady / paused / ownerAllowed / busy / friendOk / budgetBlocked / ownerIdleMs
 */
export function evaluatePurposeTick({ now = Date.now(), config = DEFAULT_PURPOSE_CONFIG, state, env = {}, random = Math.random } : EvaluatePurposeTickOptions = {}) {
  ensurePurposeDay(state, now);
  if (!config.enabled || env.enabled === false) return waitUntil(0, 'disabled');
  if (env.modeOk === false) return waitUntil(now + 5 * MINUTE, 'mode');
  if (env.dshReady === false) return waitUntil(now + 5 * MINUTE, 'dsh');
  if (env.paused === true) return waitUntil(now + 10 * MINUTE, 'paused');
  if (env.ownerAllowed === false) return waitUntil(now + HOUR, 'owner-not-allowed');
  if (inQuietHours(now, config)) {
    // 安静时段不在每次 tick 上抖动（否则状态文件每分钟都在变）；到点后由 planNextFire 再加随机。
    return waitUntil(quietEndAfter(now, config), 'quiet');
  }
  if (config.dailyMax > 0 && state.countToday >= config.dailyMax) {
    return waitUntil(nextDayStartAfter(now, config), 'daily-max');
  }
  if (state.nextFireAt && now < state.nextFireAt) return waitUntil(state.nextFireAt, 'waiting');
  if (env.busy === true) return waitUntil(now + 5 * MINUTE, 'busy');
  const idle = Number(env.ownerIdleMs);
  if (Number.isFinite(idle) && idle >= 0 && idle < config.idleThresholdMs) {
    const remain = Math.max(MINUTE, config.idleThresholdMs - idle);
    return waitUntil(now + Math.min(30 * MINUTE, remain), 'owner-active');
  }
  if (env.friendOk === false) return waitUntil(now + 6 * HOUR, 'not-friend');
  if (env.budgetBlocked === true) return waitUntil(now + 30 * MINUTE, 'budget');
  return { action: 'run', reason: 'due', nextFireAt: now };
}

/** 投递出去就先占今日次数（不管最后她有没有发消息，模型回合已经花钱了）。 */
export function markPurposeDelivered(state, { now = Date.now(), planned = null } : MarkPurposeDeliveredOptions = {}) {
  ensurePurposeDay(state, now);
  state.countToday += 1;
  state.lastAttemptAt = now;
  state.attempts = (Number(state.attempts) || 0) + 1;
  state.lastOutcome = 'pending';
  if (planned?.text) state.lastPurpose = clip(planned.text, 120);
  return state;
}

export function markPurposeSkip(state, { now = Date.now(), reason = '', nextFireAt = 0 } : MarkPurposeSkipOptions = {}) {
  state.lastSkip = { at: now, reason: String(reason ?? '').slice(0, 80) };
  if (nextFireAt > 0) state.nextFireAt = nextFireAt;
  return state;
}

/**
 * 一轮结束后的状态迁移。
 * outcome: sent（真发出）/ silent（她选择不发）/ failed（投递或回合出错）/ delivery-failed
 */
export function applyPurposeOutcome(state, {
  now = Date.now(),
  config = DEFAULT_PURPOSE_CONFIG,
  outcome = 'sent',
  text = '',
  memo = null,
  planned = null,
  random = Math.random,
} : ApplyPurposeOutcomeOptions = {}) {
  ensurePurposeDay(state, now);
  state.lastRunAt = now;
  state.lastOutcome = String(outcome ?? 'sent').slice(0, 24);
  state.lastPurpose = clip(memo?.purpose || planned?.text || state.lastPurpose || '', 120);
  state.lastText = clip(text || state.lastText || '', 200);
  const need = PURPOSE_NEEDS.includes(memo?.need) ? memo.need : (PURPOSE_NEEDS.includes(planned?.need) ? planned.need : '');
  const action = memo?.action || planned?.action || '';
  const emotion = memo?.emotionText ? '' : (planned?.emotion || '');
  state.lastEmotion = String(emotion || planned?.emotion || state.lastEmotion || '').slice(0, 24);
  state.lastEmotionText = clip(memo?.emotionText || state.lastEmotionText || '', 30);
  // 心情向量不在这里结算了（2026-11-17 下沉到心情模块）：接线层拿到这一轮的 emotion 后
  // 调 mood.feel()，那边统一做衰减 + 抬升，并且与聊天里判出来的心情共用同一套心情项。
  // 目标假设记账：这次主动说了/没说，都会影响下一次的置信度；主人回复在 formGoalHypotheses 里结算。
  const goalId = String(planned?.goalId || '').slice(0, 24);
  const goal = goalId ? (Array.isArray(state.goals) ? state.goals : []).find((g) => g?.id === goalId) : null;
  state.lastGoalId = goalId;
  if (goal && (state.lastOutcome === 'sent' || state.lastOutcome === 'silent')) {
    goal.attempts = Math.min(20, (Number(goal.attempts) || 0) + 1);
    goal.lastActionAt = now;
    if (state.lastOutcome === 'sent') {
      if (goal.status === 'hypothesis') goal.status = 'active';
      goal.confidence = Math.min(0.95, (Number(goal.confidence) || 0.3) + 0.03);
    } else {
      goal.confidence = Math.max(0.05, (Number(goal.confidence) || 0.3) - 0.03);
    }
  }
  // 驱动满足：真发出去了，对应的「想玩/想装/想陪」才会降；没发出去只轻微回落。
  state.drives = satisfyDrives(state.drives, { need, action, outcome: state.lastOutcome });
  state.drivesAt = now;
  // 显式感受结算：模型在备忘里自己报的喜/欲/意，叠加在满足衰减之后（两层不互相冲抵）。
  if (memo?.feelings?.drives) {
    state.drives = applyFeelingDeltas(state.drives, memo.feelings.drives);
    state.drivesAt = now;
  }
  if (state.lastOutcome === 'sent') {
    state.lastSentAt = now;
    state.attempts = 0;
    // 发出去了但备忘标记待续：记一条「心里还惦记着」，下次优先接着问。
    if (memo?.status === '待续') {
      addPendingPurpose(state, {
        text: memo.followUp && memo.followUp !== '无' ? memo.followUp : (memo.purpose || ''),
        kind: memo.kind || 'curiosity',
        need: need || planned?.need || '',
        action: action || planned?.action || '',
        emotion: emotion || planned?.emotion || '',
        now,
        config,
      });
    } else if (memo?.status === '完成') {
      resolvePendingPurpose(state, memo.purpose || '');
    } else if (planned?.fromPending && planned?.text) {
      // 没写备忘，但这次本来就是接着「惦记的事」说的：默认这件事已经推进过一轮。
      resolvePendingPurpose(state, planned.text);
    }
  } else if (state.lastOutcome === 'silent') {
    state.attempts = 0;
    if (memo?.status === '待续') {
      addPendingPurpose(state, {
        text: memo.followUp && memo.followUp !== '无' ? memo.followUp : (memo.purpose || ''),
        kind: memo.kind || 'curiosity',
        need: need || planned?.need || '',
        action: action || planned?.action || '',
        emotion: emotion || planned?.emotion || '',
        now,
        config,
      });
    }
  }

  state.history.push({
    at: now,
    outcome: state.lastOutcome,
    kind: clip(memo?.kind || planned?.kind || '', 20),
    need,
    action,
    emotion: emotion || planned?.emotion || '',
    purpose: state.lastPurpose,
    text: state.lastText,
    planned: clip(planned?.text || '', 120),
    sourceId: clip(planned?.sourceId || '', 80),
    goalId,
    goalOwner: goal?.owner || planned?.goalOwner || '',
    confidence: goal?.confidence ?? planned?.confidence ?? null,
  });

  const retry = state.lastOutcome !== 'sent' && state.lastOutcome !== 'silent'
    && Number(state.attempts) < Number(config.maxAttempts);
  state.nextFireAt = retry
    ? now + Math.max(MINUTE, Number(config.retryMs) || DEFAULT_PURPOSE_CONFIG.retryMs)
    : planNextFire({ now, config, lastRunAt: now, countToday: state.countToday, replyHours: state.replyHours, replyWeekday: state.replyWeekday, random });
  prunePurposeState(state, { now, config });
  return state;
}

export function prunePurposeState(state, { now = Date.now(), config = DEFAULT_PURPOSE_CONFIG } : PrunePurposeStateOptions = {}) {
  const ttlMs = Math.max(1, Number(config.pendingTtlDays) || DEFAULT_PURPOSE_CONFIG.pendingTtlDays) * DAY;
  state.pending = (Array.isArray(state.pending) ? state.pending : [])
    .filter((p) => p && p.text && (!p.expiresAt || Number(p.expiresAt) > now))
    .map((p) => ({ ...p, expiresAt: Number(p.expiresAt) || now + ttlMs }))
    .slice(-20);
  const limit = Math.max(10, Number(config.historyLimit) || DEFAULT_PURPOSE_CONFIG.historyLimit);
  state.history = (Array.isArray(state.history) ? state.history : []).slice(-limit);
  return state;
}

// ── 素材 ────────────────────────────────────────────────────────────────────

