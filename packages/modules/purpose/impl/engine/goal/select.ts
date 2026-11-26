// 选择：把素材与目标排成候选，挑这一轮真正要做的那个。

import { DEFAULT_EMOTIONS, emotionLabels, emotionProfiles, profileOf, resolveEmotion } from '../../../../../../src/persona/emotions.ts'
import { PURPOSE_STATE_VERSION, FOLLOW_UP_WEIGHT, DEFAULT_PURPOSE_CONFIG, MINUTE, HOUR, DAY, isPlainObject, clampInt, clip, redactNumbers } from '../state/types.ts'
import type { NormalizePurposeConfigOptions, EnsurePurposeScheduleOptions, BestReplyHourShiftOptions, BestReplyWeekdayShiftOptions, PlanNextFireOptions, EvaluatePurposeTickOptions, MarkPurposeDeliveredOptions, MarkPurposeSkipOptions, ApplyPurposeOutcomeOptions, PrunePurposeStateOptions, CollectMaterialsOptions, DeriveDrivesOptions, AppraiseMaterialOptions, SatisfyDrivesOptions, NormalizeMoodsOptions, DeriveMoodsOptions, AnalyzeEventOptions, MakeGoalOptions, HypothesesForEventOptions, MergeGoalOptions, PersonaGoalSpecOptions, FormGoalHypothesesOptions, ActionForNeedOptions, IntentForNeedOptions, MinePurposeSeedsOptions, AddOptions, SelectPurposeOptions, BuildPurposePromptOptions, ParseFeelingsOptions, AddPendingPurposeOptions, SummarizePurposeStateOptions } from '../state/types.ts'
import { DEFAULT_DRIVES } from '../state/drives.ts'
import { normalizeDrives } from '../state/drives.ts'
import { needAffinity } from '../state/drives.ts'
import { topNeedOf } from '../state/drives.ts'
import { appraiseMaterial } from '../state/drives.ts'
import { hashId } from '../plan/materials.ts'
import { actionForNeed } from './goals.ts'
import { QUESTION_RE } from '../state/drives.ts'
import { PLAN_RE } from '../state/drives.ts'
import { PROMISE_RE } from '../state/drives.ts'
import { DESIRE_RE } from '../state/drives.ts'
import { textSimilarity } from '../plan/materials.ts'
import { isDuplicateText } from '../plan/materials.ts'
import { PURPOSE_NEEDS } from '../state/drives.ts'
import { emotionCues } from '../state/drives.ts'
import { kindForAction } from './goals.ts'
import { NEED_LABELS } from '../state/drives.ts'
import { ACTION_LABELS } from '../state/drives.ts'
import { emotionLabelFor } from '../state/drives.ts'
import { emotionProfile } from '../state/drives.ts'
import { clamp01 } from './goals.ts'
import { goalToCandidate } from './goals.ts'

export function minePurposeSeeds({
  materials = [],
  now = Date.now(),
  roleName = '',
  config = DEFAULT_PURPOSE_CONFIG,
  drives = DEFAULT_DRIVES,
  history = [],
  lastMasterAt = 0,
} : MinePurposeSeedsOptions = {}) {
  const seeds = [];
  const query = normalizeDrives(drives);
  const hoursSinceMaster = lastMasterAt > 0 ? Math.max(0, (now - lastMasterAt) / HOUR) : 24;
  const selfTimes = materials
    .filter((m) => m.kind === 'self' && (m.meta?.type === 'private' || (!m.meta?.type && (!m.meta?.key || String(m.meta.key).startsWith('private:')))))
    .map((m) => Number(m.at) || 0);
  const answeredAfter = (at, ms = 45 * MINUTE) => selfTimes.some((t) => t > at && t - at <= ms);
  const textOf = (m) => `${m?.title ?? ''} ${m?.text ?? ''} ${m?.quote ?? ''}`;
  const add = (kind, text, material, weight = 1, extra : AddOptions = {}) => {
    const clean = clip(text, 120);
    if (!clean || clean.length < 4) return;
    const aff = material?.needAffinity ?? needAffinity(textOf(material), roleName);
    const need = extra.need || topNeedOf(aff, query);
    const emotion = extra.emotion || appraiseMaterial({ material, need, now, lastMasterAt });
    seeds.push({
      id: `seed-${hashId(`${need}|${kind}|${clean}`)}`,
      kind,
      need,
      action: extra.action || actionForNeed(need, extra.topic || material?.topic, { emotion, hoursSinceMaster }),
      emotion,
      topic: extra.topic || material?.topic || '',
      text: clean,
      source: material?.source || '',
      sourceId: material?.id || '',
      at: Number(material?.at) || now,
      weight: Math.max(0.2, Number(weight) || 1),
      evidence: clip(material?.text || material?.title || '', 120),
    });
  };

  for (const m of materials) {
    const text = String(m.text ?? '');
    if (m.kind === 'memory-follow-up') {
      add('memory-follow-up', `想顺口问问：${m.meta.question}`, m, FOLLOW_UP_WEIGHT, { need: 'care', action: 'follow' });
    } else if (m.kind === 'owner') {
      if (QUESTION_RE.test(text) && !answeredAfter(m.at)) {
        add('curiosity', `想接上主人之前问的「${clip(text, 36)}」`, m, 1.25, {
          need: 'connect', action: 'curiosity',
        });
      }
      if (PLAN_RE.test(text)) {
        add('care', `想知道主人「${clip(text, 32)}」后来怎么样了`, m, 1.35, {
          need: 'care', action: 'ask',
        });
      }
    } else if (m.kind === 'self' && PROMISE_RE.test(text)) {
      add('follow-up', `你之前说过「${clip(text, 32)}」，想跟主人补一句`, m, 1.15, {
        need: 'care', action: 'follow',
      });
    } else if (m.kind === 'video') {
      const title = m.title ? `《${m.title}》` : '';
      if (DESIRE_RE.test(`${text} ${m.title ?? ''}`)) {
        add('ask', `你在B站看到${title || '一个东西'}，有点想试试，想跟主人提一句`, m, 1.2, {
          need: topNeedOf(m.needAffinity || needAffinity(text, roleName), query), action: 'ask',
        });
      } else if (m.meta?.favorite || Number(m.meta?.score) >= 12 || (m.quote && m.quote.length >= 12)) {
        add('share', `想跟主人说说你在B站看的${title || '那条视频'}`, m, 1.0, {
          need: 'share', action: 'share',
        });
      } else {
        add('share', `想把B站看到的${title || '一件小事'}讲给主人听`, m, 0.55, {
          need: 'share', action: 'share',
        });
      }
    } else if (m.kind === 'dynamic') {
      add('share', `你发过一条B站动态「${clip(m.text, 32)}」，想跟主人聊聊`, m, 0.8, {
        need: 'create', action: 'share',
      });
    } else if (m.kind === 'memory') {
      add('share', `突然想起「${clip(m.text, 34)}」，想跟主人提一句`, m, 0.9, {
        need: 'connect', action: 'share',
      });
    } else if (m.kind === 'thought' && m.source === 'bili') {
      add('share', `你在B站想过「${clip(m.text, 34)}」，想跟主人说说`, m, 0.85, {
        need: 'share', action: 'share',
      });
    } else if (m.kind === 'thought') {
      const kind = m.meta?.motivation === 'curiosity' ? 'curiosity' : 'share';
      add(kind, `你心里还惦记着「${clip(m.text, 36)}」`, m, 1.5, {
        need: topNeedOf(m.needAffinity || needAffinity(text, roleName), query),
        action: kind === 'curiosity' ? 'curiosity' : 'share',
      });
    } else if (m.kind === 'member') {
      const addressed = roleName ? text.includes(roleName) : /@/.test(text);
      if (addressed && QUESTION_RE.test(text)) {
        add('curiosity', `群里有人问「${clip(text, 32)}」，你想弄清楚`, m, 0.6, {
          need: 'learn', action: 'curiosity',
        });
      }
    }
  }

  // ② 推断层不在这里：`formGoalHypotheses` 负责「注意力 + 归属 + 置信度/风险」。
  //    这一层只产出「明确说出口/明确欠着」的种子；否则群友想玩会被误当成她想玩。

  // 没有可靠种子时给两个很轻的兜底，避免「素材有、但一条目的都提不出来」。
  if (!seeds.length && materials.length > 0) {
    add('share', '把最近看到的一件小事讲给主人听', materials[0], 0.5, { need: 'share', action: 'share' });
    add('ask', '想问主人一件一直没问出口的小事', materials[0], 0.45, { need: 'connect', action: 'ask' });
  }

  // 同一件事只留权重最高的一条；同 need+topic 也只留一条（避免「想玩A」写三遍）。
  const unique = [];
  const seenNeedTopic = new Set();
  for (const seed of seeds.sort((a, b) => b.weight - a.weight)) {
    if (unique.some((s) => textSimilarity(s.text, seed.text) >= 0.75)) continue;
    const key = `${seed.need}|${seed.topic}`;
    if (seed.topic && seenNeedTopic.has(key)) continue;
    if (seed.topic) seenNeedTopic.add(key);
    unique.push(seed);
  }
  return unique.slice(0, 16);
}

/**
 * 在「新提炼的候选」和「上次没说完的事」之间选一个。
 * 返回 { purpose, candidates, fromPending }。
 */
export function selectPurpose({
  seeds = [],
  goals = [],
  pending = [],
  history = [],
  config = DEFAULT_PURPOSE_CONFIG,
  drives = DEFAULT_DRIVES,
  now = Date.now(),
  lastMasterAt = 0,
  random = Math.random,
  // 心情项：用户在心情页配了哪些情绪，这里就只认哪些（删掉的项映射到最接近的一项，
  // 而不是产出提示词里没有标签的空情绪）。
  emotions = DEFAULT_EMOTIONS,
} : SelectPurposeOptions = {}) {
  const recent = (Array.isArray(history) ? history : []).slice(-10);
  const query = normalizeDrives(drives);
  const hoursSinceMaster = lastMasterAt > 0 ? Math.max(0, (now - lastMasterAt) / HOUR) : 24;
  const candidates = [];
  const add = (item, weight, fromPending) => {
    const text = clip(item?.text, 120);
    if (!text) return;
    const followUp = item?.kind === 'memory-follow-up';
    if (!followUp && isDuplicateText(text, recent)) return;
    // 同一个目标已经主动说过：就算换了措辞也不重复。
    if (item?.goalId && recent.some((h) => h && h.goalId === item.goalId)) return;
    // 同一件 B站 视频 / 同一条记忆已经用过：就算措辞不同也换一个，别复读。
    if (!followUp && item?.sourceId && recent.some((h) => h && h.sourceId && h.sourceId === item.sourceId)) return;
    if (candidates.some((c) => textSimilarity(c.text, text) >= 0.8)) return;
    const needAff = item.needAffinity || needAffinity(text);
    const need = PURPOSE_NEEDS.includes(item.need) ? item.need : topNeedOf(needAff, query);
    const rawEmotion = item.emotion || appraiseMaterial({
      material: { text, title: '', selfRef: Boolean(item.selfRef), cues: emotionCues(text), needAffinity: needAff },
      need,
      now,
      lastMasterAt,
    });
    // 写死的情绪键可能已被用户在「心情项」里删掉：映射到最接近的一项（删了「无聊」→「平静」），
    // 一项都没配上时才留空字符串（提示词会跳过强弱措辞，不至于崩）。
    const emotion = resolveEmotion(emotions, rawEmotion) || '';
    let action = item.action || actionForNeed(need, item.topic || '', { emotion, hoursSinceMaster });
    // 高风险目标只能「问」或「说」，不能默认替她做（装/买/联系别人）。
    if ((Number(item.risk) || 0) >= 0.5 && !['ask', 'share'].includes(action)) action = 'ask';
    candidates.push({
      id: item.id || `candidate-${hashId(text)}`,
      kind: String(item.kind || kindForAction(action, need)).slice(0, 20),
      need,
      needLabel: NEED_LABELS[need] || need,
      action: ACTION_LABELS[action] ? action : 'share',
      actionLabel: ACTION_LABELS[action] || ACTION_LABELS.share,
      emotion,
      emotionLabel: emotionLabelFor(emotions, emotion),
      emotionProfile: emotionProfile(emotion, emotions),
      topic: String(item.topic || '').slice(0, 40),
      text,
      source: String(item.source || '').slice(0, 20),
      sourceId: String(item.sourceId || '').slice(0, 80),
      at: Number(item.at) || 0,
      weight: Math.max(0.1, Number(weight) || 1),
      evidence: clip(item.evidence || '', 120),
      fromPending: Boolean(fromPending),
      goalId: item.goalId || '',
      goalOwner: item.goalOwner || '',
      goalOwnerLabel: item.goalOwnerLabel || '',
      confidence: Number.isFinite(Number(item.confidence)) ? clamp01(item.confidence, 0) : null,
      risk: Number.isFinite(Number(item.risk)) ? clamp01(item.risk, 0) : null,
      value: Number.isFinite(Number(item.value)) ? clamp01(item.value, 0) : null,
      nextStep: String(item.nextStep || '').slice(0, 80),
    });
  };

  for (const goal of Array.isArray(goals) ? goals : []) {
    // 被拒绝/已完成/过期的目标不再主动提；新证据会把 rejected 重新变回 hypothesis。
    if (!goal || ['rejected', 'done', 'expired'].includes(goal.status)) continue;
    const candidate = goalToCandidate(goal);
    if (candidate) add(candidate, 1, false);
  }
  for (const seed of Array.isArray(seeds) ? seeds : []) add(seed, seed?.weight ?? 1, false);
  for (const p of Array.isArray(pending) ? pending : []) add(p, (Number(p?.weight) || 1) + 0.35, true);

  // 驱动越高的需要，越容易在这一次被选中；寂寞/羡慕这种情绪会再推一把。
  for (const c of candidates) {
    if (c.goalId) {
      // 目标假设：置信度/价值/风险都参与排序；风险高的不因为「想说」就排前面。
      c.weight *= 0.55 + (c.confidence ?? 0.3) * 0.7 + (c.value ?? 0.4) * 0.35 - (c.risk ?? 0.1) * 0.25;
    }
    c.weight *= 0.65 + 0.55 * (query[c.need] ?? 0);
    if (c.emotion === 'lonely') c.weight *= config.lonelyEmotionWeight;
    if (c.emotion === 'envious') c.weight *= config.enviousEmotionWeight;
  }

  // 需要也要轮换：连续两次都在「陪」/「玩」，第三次先换一个维度，别把人设聊成单曲循环。
  const lastNeeds = recent.map((h) => h?.need).filter(Boolean);
  for (const c of candidates) {
    if (lastNeeds.slice(-3).includes(c.need)) c.weight *= config.needRepeatPenalty;
    if (lastNeeds.slice(-2).length === 2 && lastNeeds.slice(-2).every((n) => n === c.need)) c.weight *= config.needRepeatPenalty2;
  }

  // 连续分享/连续索取都容易腻：按最近 3 次的类型轻轻调权。
  const lastKinds = recent.slice(-3).map((h) => String(h?.kind || ''));
  const shares = lastKinds.filter((k) => k === 'share').length;
  const asks = lastKinds.filter((k) => k === 'ask' || k === 'curiosity').length;
  for (const c of candidates) {
    if (shares >= 2 && c.kind !== 'share') c.weight *= 1.35;
    if (asks >= 2 && ['share', 'care', 'follow-up'].includes(c.kind)) c.weight *= 1.2;
  }

  candidates.sort((a, b) => b.weight - a.weight);
  // 候选去重：同一需要最多 2 个、同一目标归属最多 2 个；否则记忆卡一多，
  // 提示词会被 6 条一模一样的「想找主人说话」占满。
  const maxCandidates = Math.max(3, Number(config.maxCandidates) || 6);
  const diverse = [];
  const byNeed = new Map();
  const byOwner = new Map();
  for (const c of candidates) {
    const needCount = byNeed.get(c.need) || 0;
    const ownerCount = c.goalOwner ? (byOwner.get(c.goalOwner) || 0) : 0;
    if (needCount >= 2) continue;
    if (c.goalOwner && ownerCount >= 2) continue;
    diverse.push(c);
    byNeed.set(c.need, needCount + 1);
    if (c.goalOwner) byOwner.set(c.goalOwner, ownerCount + 1);
    if (diverse.length >= maxCandidates) break;
  }
  if (diverse.length < 3) {
    for (const c of candidates) {
      if (diverse.includes(c)) continue;
      diverse.push(c);
      if (diverse.length >= 3) break;
    }
  }
  const top = diverse;
  if (!top.length) return { purpose: null, candidates: [], fromPending: false };

  const followUp = top.find((c) => c.kind === 'memory-follow-up');
  if (followUp) return { purpose: followUp, candidates: top, fromPending: false };

  // 有一半概率优先处理「心里惦记着的事」——人也会先把没说完的话说完（概率可配置）。
  const pendingTop = top.filter((c) => c.fromPending);
  if (pendingTop.length && random() < config.pendingShareProbability) {
    return { purpose: pendingTop[0], candidates: top, fromPending: true };
  }
  const total = top.reduce((sum, c) => sum + c.weight, 0);
  let roll = random() * total;
  for (const c of top) {
    roll -= c.weight;
    if (roll <= 0) return { purpose: c, candidates: top, fromPending: Boolean(c.fromPending) };
  }
  return { purpose: top[0], candidates: top, fromPending: Boolean(top[0].fromPending) };
}

// ── 提示词 ──────────────────────────────────────────────────────────────────

export const KIND_LABEL = {
  share: '分享',
  ask: '索取',
  care: '关心',
  curiosity: '好奇',
  'follow-up': '追问',
};

