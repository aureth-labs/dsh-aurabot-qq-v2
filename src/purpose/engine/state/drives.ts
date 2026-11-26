// 驱动与心情：需要、情绪、人格偏向怎么影响「现在想干嘛」。

import { DEFAULT_EMOTIONS, emotionLabels, emotionProfiles, profileOf, resolveEmotion } from '../../../features/mood/emotions.ts'
import { PURPOSE_STATE_VERSION, FOLLOW_UP_WEIGHT, DEFAULT_PURPOSE_CONFIG, MINUTE, HOUR, DAY, isPlainObject, clampInt, clip, redactNumbers } from './types.ts'
import type { NormalizePurposeConfigOptions, EnsurePurposeScheduleOptions, BestReplyHourShiftOptions, BestReplyWeekdayShiftOptions, PlanNextFireOptions, EvaluatePurposeTickOptions, MarkPurposeDeliveredOptions, MarkPurposeSkipOptions, ApplyPurposeOutcomeOptions, PrunePurposeStateOptions, CollectMaterialsOptions, DeriveDrivesOptions, AppraiseMaterialOptions, SatisfyDrivesOptions, NormalizeMoodsOptions, DeriveMoodsOptions, AnalyzeEventOptions, MakeGoalOptions, HypothesesForEventOptions, MergeGoalOptions, PersonaGoalSpecOptions, FormGoalHypothesesOptions, ActionForNeedOptions, IntentForNeedOptions, MinePurposeSeedsOptions, AddOptions, SelectPurposeOptions, BuildPurposePromptOptions, ParseFeelingsOptions, AddPendingPurposeOptions, SummarizePurposeStateOptions } from './types.ts'
import { clamp01 } from '../goal/goals.ts'

export const DESIRE_RE = /想玩|想吃|想买|想去|想要|好想|想试试|想学|求推荐|求带/;
export const PLAN_RE = /明天|后天|周末|下周|考试|面试|加班|出差|回家|生日|旅行|医院|搬家|开会|比赛|约会|放假|开学/;
export const QUESTION_RE = /[?？]|吗|呢|怎么|为什么|有没有|要不要|能不能|是不是|咋/;
export const PROMISE_RE = /回头|下次|改天|待会|晚点|明天|之后|再聊|再告诉|再说/;

// ── 需求维度：把「看到的东西」抽象成「我想要什么」────────────────────────────
// 这不是心理学定论，而是一套可解释、可单测的近似：
//   注意力（哪条记忆值得看）→ 抽象（它指向哪种需要）→ 情绪（它让我什么感觉）
//   → 意图（我想做什么）→ 行动（分享 / 索取 / 邀请 / 倾诉）。
// 目的不是关键词映射，而是这五步的合流。
export const PURPOSE_NEEDS = Object.freeze([
  'play', 'learn', 'install', 'connect', 'care', 'share', 'identity', 'create', 'consume',
]);

export const NEED_LABELS = Object.freeze({
  play: '玩', learn: '学', install: '装', connect: '陪', care: '关心',
  share: '分享', identity: '自我', create: '创作', consume: '体验',
});

export const ACTION_LABELS = Object.freeze({
  share: '分享', ask: '索取', invite: '邀请', confide: '倾诉', follow: '追问', curiosity: '好奇',
});

export const EMOTION_LABELS = emotionLabels(DEFAULT_EMOTIONS);

// 情绪的二维画像：valence（正负 -1~1）与 arousal（强弱 0~1）。
// 离散标签好让模型读懂，数值好让桌宠表情/语气跟着强度走。
// 2026-11-17 起这张表由「心情项」配置生成（features/mood-emotions.js），
// 这里保留默认十项的快照只为兼容旧调用；真正取值一律走 emotionProfile(emotion, emotions)。
export const EMOTION_PROFILES = emotionProfiles(DEFAULT_EMOTIONS);

/** 情绪 → { valence, arousal }；未知情绪回中性偏弱。emotions 不传时按出厂十项。 */
export function emotionProfile(emotion, emotions = DEFAULT_EMOTIONS) {
  return profileOf(emotions, emotion);
}

/** 情绪键 → 用户配的标签（删掉的项返回空串，调用方按「没有标签」处理）。 */
export function emotionLabelFor(emotions, emotion) {
  if (!emotion) return '';
  const labels = emotionLabels(emotions);
  return labels[emotion] || '';
}

export const DEFAULT_DRIVES = Object.freeze({
  play: 0.20, learn: 0.12, install: 0.10, connect: 0.28, care: 0.22,
  share: 0.20, identity: 0.14, create: 0.05, consume: 0.05,
});

const NEED_WORDS = Object.freeze({
  play: ['游戏', '玩', '联机', '开黑', '副本', '抽卡', '主机', 'steam', 'switch', '手游', '桌游', '比赛', '攻略', '怎么玩', 'mod', '皮肤'],
  learn: ['教程', '原理', '解析', '知识', '课程', '论文', '科普', '技巧', '拆解', '学会', '怎么做到', '为什么'],
  install: ['插件', '安装', '配置', '部署', '工具', '软件', '更新', '扩展', '源码', 'harness', 'dsh', '装好', '装上', '装个', '想装'],
  connect: ['主人', '陪', '寂寞', '孤独', '抱', '亲', '喜欢', '爱', '关系', '一起', '聊天', '晚安', '早安', '想你'],
  care: ['面试', '考试', '加班', '累', '生病', '医院', '压力', '难过', '开心', '吃饭', '睡觉', '工作', '休息'],
  share: ['好笑', '离谱', '可爱', '好看', '梗', '笑死', '分享', '给你看', '有趣', '震撼', '绝了'],
  identity: ['ai', '机器人', '人机', '意识', '记忆', '自我', '是谁', '模型', '人格', '灵魂'],
  create: ['写文', '画画', '二创', '剪辑', '编曲', '做视频', '手工', '创作', '拍'],
  consume: ['想吃', '想喝', '想买', '想去', '展览', '店', '旅行', '门票', '礼物', '好吃', '好喝'],
});

// 人格卡里的「我是一个什么样的人」→ 动机先验。不是给模型看的标签，
// 而是让同一套机制在载入不同人格卡时，天然偏向不同的需要（爱玩的人更容易想玩，
// 黏人的人更容易想陪，技术宅更容易想装/学）。
const PERSONA_WORDS = Object.freeze({
  play: ['游戏', '爱玩', '贪玩', '娱乐', '二次元', '番剧', '梗', '好玩', '轻松'],
  learn: ['好奇', '好学', '学习', '研究', '知识', '技术', '原理', '聪明', '思考'],
  install: ['技术', '插件', '工具', '动手', '折腾', '配置', '代码', 'dsh', 'harness'],
  connect: ['黏人', '粘人', '怕孤独', '寂寞', '陪伴', '依赖', '亲近', '撒娇', '想主人', '缺爱'],
  care: ['温柔', '关心', '体贴', '照顾', '心软', '共情', '在意'],
  share: ['话多', '话痨', '分享', '表达', '吐槽', '嘴碎', '爱说'],
  identity: ['ai', '机器人', '自我', '身份', '意识', '存在', '人格', '灵魂', '人机'],
  create: ['创作', '写文', '画画', '做视频', '剪辑', '手工', '想表达'],
  consume: ['吃', '美食', '零食', '甜', '买', '逛', '旅行', '可爱的东西'],
});

export const POSITIVE_RE = /开心|喜欢|爱|可爱|好笑|笑死|厉害|治愈|温暖|惊喜|幸福|好玩|想玩|想吃|绝了|赞/;
export const NEGATIVE_RE = /难过|累|焦虑|害怕|孤独|寂寞|羡慕|嫉妒|生气|烦|压力|遗憾|哭|担心|崩溃/;
const AROUSAL_RE = /笑死|炸|疯|激动|震撼|刺激|太|超|绝了|!!!|！！/;
export const RELATION_RE = /爱|关系|人机|机器人|ai|寂寞|孤独|陪|想你|主人/;
const SELF_REF_RE = /ai|人工智能|机器人|模型|人格|插件|harness|dsh/;

// ── 否定前缀守卫 ────────────────────────────────────────────────────────────
// 「不想玩」「别装了」这类话若按裸关键词计数，会被误算成正面欲望。
// 约定：命中词往前看 4 个字符，出现否定前缀就视作反义。
const NEG_PREFIX_RE = /(?:不想|不要|不用|没有|没什么|别|不爱|懒得|不打算|无意|拒绝|取消|放弃)/;

/** 命中位置是否被否定前缀覆盖。 */
export function isNegated(text, index) {
  if (index < 0) return false;
  return NEG_PREFIX_RE.test(String(text ?? '').slice(Math.max(0, index - 4), index));
}

/** 文本里是否存在一次「未被否定」的词命中。 */
export function findAffirmative(text, word) {
  const t = String(text ?? '').toLowerCase();
  const w = String(word ?? '').toLowerCase();
  if (!w) return false;
  let idx = t.indexOf(w);
  while (idx >= 0) {
    if (!isNegated(t, idx)) return true;
    idx = t.indexOf(w, idx + w.length);
  }
  return false;
}

/** 0~1 的驱动向量；坏值回默认，不抛。 */
export function normalizeDrives(input) {
  const out = { ...DEFAULT_DRIVES };
  if (!input || typeof input !== 'object') return out;
  for (const need of PURPOSE_NEEDS) {
    const n = Number(input[need]);
    if (Number.isFinite(n)) out[need] = Math.min(1, Math.max(0, n));
  }
  return out;
}

/** 一段文本指向哪些需要（0~1/维）；没有任何命中时至少给 share 一点底。 */
export function needAffinity(text, roleName = '', roleAliases = []) {
  const t = String(text ?? '').toLowerCase();
  const out: Record<string, any> = {};
  let any = 0;
  for (const need of PURPOSE_NEEDS) {
    let hits = 0;
    for (const word of NEED_WORDS[need]) if (findAffirmative(t, word)) hits += 1;
    if (need === 'identity' && [roleName, ...roleAliases].some((name) => name && t.includes(String(name).toLowerCase()))) hits += 1;
    const value = Math.min(1, hits / 2.5);
    out[need] = value;
    if (value > 0) any += 1;
  }
  if (!any) out.share = 0.3;
  // 交叉增强：提到「插件/AI/自己」时，既可能是「装」也可能是「自我」；
  // 游戏 + 一起/主人 时，既可能是「玩」也可能是「陪」。
  if (out.install > 0 && out.identity > 0) out.identity = Math.min(1, out.identity + 0.2);
  if (out.play > 0 && out.connect > 0) out.play = Math.min(1, out.play + 0.15);
  return out;
}

// 人格卡里的「性格倾向」→ 引擎参数覆写。只认显式写的词，第一个命中的词生效。
const PERSONA_OVERRIDES = Object.freeze([
  { key: 'riskScale', value: 1.25, words: ['胆小', '谨慎', '怕麻烦', '稳重点', '别乱花钱'] },
  { key: 'riskScale', value: 0.8, words: ['大胆', '敢试', '爱折腾', '勇于尝试'] },
  { key: 'dailyMaxBonus', value: 1, words: ['话痨', '话多', '爱分享', '多聊聊', '嘴碎'] },
  { key: 'dailyMaxBonus', value: -1, words: ['高冷', '少打扰', '别烦我', '安静点'] },
  { key: 'connectFloor', value: 0.1, words: ['黏人', '粘人', '怕孤独', '缺爱'] },
]);

/**
 * 人格卡 → 动机先验。只做「这个人更可能在乎什么」的偏置，不替代素材/目标。
 * 返回 { bias, traits, overrides, text, hasText }；换人格卡后 deriveDrives / 目标生成会跟着变。
 */
export function analyzePersona(text) {
  const raw = String(text ?? '');
  const t = raw.toLowerCase();
  const bias: Record<string, any> = {};
  const traits = [];
  for (const need of PURPOSE_NEEDS) {
    let hits = 0;
    for (const word of PERSONA_WORDS[need]) if (t.includes(String(word).toLowerCase())) hits += 1;
    const value = Math.min(0.28, hits * 0.07);
    bias[need] = value;
    if (hits > 0) traits.push({ need, label: NEED_LABELS[need], hits, bias: value });
  }
  traits.sort((a, b) => b.hits - a.hits || b.bias - a.bias);
  // 性格覆写：胆量 / 话多程度 / 黏人地板。同 key 有多个规则命中时，
  // 按「词在文本里出现得更早」的生效（主人先写的性格优先）。
  const overrides: Record<string, any> = {};
  const bestIdx: Record<string, any> = {};
  for (const rule of PERSONA_OVERRIDES) {
    for (const word of rule.words) {
      const idx = t.indexOf(word);
      if (idx < 0) continue;
      if (bestIdx[rule.key] == null || idx < bestIdx[rule.key]) {
        bestIdx[rule.key] = idx;
        overrides[rule.key] = rule.value;
      }
    }
  }
  return {
    bias,
    traits,
    overrides,
    text: clip(raw.replace(/\s+/g, ' ').trim(), 300),
    hasText: Boolean(raw.trim()),
  };
}

/**
 * 人格覆写并进引擎配置（纯函数，不改入参）：
 *   · riskScale：胆量乘在风险表上；
 *   · dailyMaxBonus：每日上限 ±1（dailyMax=0 表示不限，不动）；
 *   · connectFloor：黏人地板，deriveDrives 里抬 connect 的下限。
 */
export function applyPersonaOverrides(config, persona = null) {
  const ov = persona?.overrides;
  if (!ov || typeof ov !== 'object') return config;
  const out = { ...config };
  if (Number.isFinite(ov.riskScale)) {
    out.riskScale = Math.min(2, Math.max(0.3, (Number(config.riskScale) || 1) * ov.riskScale));
  }
  if (Number.isFinite(ov.dailyMaxBonus) && (Number(out.dailyMax) || 0) > 0) {
    out.dailyMax = clampInt(out.dailyMax + ov.dailyMaxBonus, out.dailyMax, 0, 24);
  }
  out.connectFloor = Number.isFinite(ov.connectFloor)
    ? Math.min(0.3, Math.max(0, ov.connectFloor))
    : 0;
  return out;
}
export function cleanTopic(text, max = 24) {
  const s = String(text ?? '')
    .replace(/^[《「【\[\s]+|[》」】\]\s]+$/g, '')
    .replace(/[，。！？；、,.!?;:~～]+$/g, '')
    .replace(/[吗呢啊吧呀哦嘛啦]+$/g, '')
    .replace(/(怎么玩|怎么样|是什么|好不好|在哪|多少钱|干什么|是什么样)$/g, '')
    .replace(/[，。！？；、,.!?;:~～]+$/g, '')
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 从一句话/标题里抽一个可复述的「那件事」——模板里要用它，不能只写「那个东西」。 */
export function extractTopic(text, title = '') {
  if (title) return cleanTopic(title);
  const raw = String(text ?? '');
  const quoted = /《([^》]{2,30})》|「([^」]{2,30})」|【([^】]{2,30})】/.exec(raw);
  if (quoted) return cleanTopic(quoted[1] || quoted[2] || quoted[3]);
  const afterDemonstrative = /(?:那个|这个|一个|这款|那款|一部|一款)([^\s，。！？；、,.!?;]{2,18})/.exec(raw);
  if (afterDemonstrative) return cleanTopic(afterDemonstrative[1]);
  const plugin = /([\u4e00-\u9fffA-Za-z0-9_-]{2,16}插件)/.exec(raw);
  if (plugin) return cleanTopic(plugin[1]);
  return cleanTopic(clip(raw, 18));
}

function isSelfReference(text, roleName = '', roleAliases = []) {
  const raw = String(text ?? '').toLowerCase();
  if ([roleName, ...roleAliases].some((name) => name && raw.includes(String(name).toLowerCase()))) return true;
  return SELF_REF_RE.test(raw);
}

export function emotionCues(text) {
  const raw = String(text ?? '');
  return {
    positive: POSITIVE_RE.test(raw),
    negative: NEGATIVE_RE.test(raw),
    arousal: AROUSAL_RE.test(raw) ? 0.85 : 0.4,
  };
}

/** 把素材压成注意力需要的样子：自我相关 / 需求向量 / 主题 / 情绪线索。 */
export function enrichMaterial(item, roleName = '', roleAliases = []) {
  const text = `${item?.title ?? ''} ${item?.text ?? ''} ${item?.quote ?? ''}`;
  return {
    ...item,
    selfRef: isSelfReference(text, roleName, roleAliases),
    needAffinity: needAffinity(text, roleName, roleAliases),
    topic: item?.topic || extractTopic(text, item?.title),
    cues: emotionCues(text),
  };
}

/**
 * 驱动状态：会随时间衰减，也会被「主人多久没理我」和「最近总看到什么」推高。
 * 这是「为什么今天特别想玩 / 特别想找人说话」的可解释来源。
 */
export function deriveDrives({
  drives,
  drivesAt = 0,
  materials = [],
  now = Date.now(),
  lastMasterAt = 0,
  personaBias = null,
  needFeedback = null,
  halfLifeHours = 8,
  connectFloor = 0,
} : DeriveDrivesOptions = {}) {
  const next: Record<string, number> = normalizeDrives(drives);
  const hours = drivesAt > 0 ? Math.min(72, Math.max(0, (now - drivesAt) / HOUR)) : 0;
  const decay = Math.pow(0.5, hours / Math.max(1, Number(halfLifeHours) || 8));
  for (const need of PURPOSE_NEEDS) {
    next[need] = DEFAULT_DRIVES[need] + (next[need] - DEFAULT_DRIVES[need]) * decay;
  }
  // 长期反馈学习：某需要的主动搭话攒够了样本（≥5 次有回音），
  // 正反馈率 ≥60% 的抬地板（主人吃这套），≤30% 的向默认值加速回落（主人不吃这套）。
  if (needFeedback && typeof needFeedback === 'object') {
    for (const need of PURPOSE_NEEDS) {
      const s = needFeedback[need];
      const pos = Number(s?.positive) || 0;
      const neg = Number(s?.negative) || 0;
      if (pos + neg < 5) continue;
      if (pos / (pos + neg) >= 0.6) {
        next[need] = Math.min(1, Math.max(next[need], DEFAULT_DRIVES[need] + 0.08));
      } else if (pos / (pos + neg) <= 0.3) {
        next[need] = DEFAULT_DRIVES[need] + (next[need] - DEFAULT_DRIVES[need]) * 0.85;
      }
    }
  }
  // 人格卡先验：爱玩/黏人/技术宅/爱分享…在同样素材下会更容易被相应需要打动。
  // 用「地板」而不是累加：否则每轮都 +bias，几十轮后所有驱动都会被顶到 1。
  if (personaBias && typeof personaBias === 'object') {
    for (const need of PURPOSE_NEEDS) {
      const bias = Number(personaBias[need]);
      if (Number.isFinite(bias) && bias > 0) {
        next[need] = Math.min(1, Math.max(next[need], DEFAULT_DRIVES[need] + Math.min(0.3, bias)));
      }
    }
  }
  const hoursSinceMaster = lastMasterAt > 0 ? Math.max(0, (now - lastMasterAt) / HOUR) : 24;
  // 连接需求会随「多久没和主人说话」慢慢涨；这也是「寂寞/想陪」不是随机出现的原因。
  next.connect = Math.min(0.95, next.connect + Math.min(0.5, (hoursSinceMaster / 24) * 0.4));
  // 黏人地板（人格覆写 connectFloor）：黏人的人格卡 connect 至少站在此线之上。
  const cFloor = Math.min(0.3, Math.max(0, Number(connectFloor) || 0));
  if (cFloor > 0) next.connect = Math.min(0.95, Math.max(next.connect, DEFAULT_DRIVES.connect + cFloor));
  // 最近反复看到的内容，会把对应需求推高（看多了游戏会想玩，看多了工具会想装）。
  for (const material of materials.slice(0, 24)) {
    const affinity = material.needAffinity ?? needAffinity(`${material.title ?? ''} ${material.text ?? ''}`);
    for (const need of PURPOSE_NEEDS) {
      next[need] = Math.min(1, next[need] + affinity[need] * 0.045);
    }
  }
  return { drives: next, drivesAt: now };
}

export function topNeedOf(affinity, drives = DEFAULT_DRIVES) {
  let best = 'share';
  let bestScore = -1;
  for (const need of PURPOSE_NEEDS) {
    const score = (Number(affinity?.[need]) || 0) * (0.35 + (Number(drives?.[need]) || 0));
    if (score > bestScore) { best = need; bestScore = score; }
  }
  return best;
}

/** 轻量 appraisal：不是「识别情绪词」，而是「这件事对我意味着什么」。 */
export function appraiseMaterial({ material, need, now = Date.now(), lastMasterAt = 0 } : AppraiseMaterialOptions = {}) {
  const text = `${material?.title ?? ''} ${material?.text ?? ''}`;
  const cues = material?.cues ?? emotionCues(text);
  const self = Boolean(material?.selfRef);
  const hoursSinceMaster = lastMasterAt > 0 ? Math.max(0, (now - lastMasterAt) / HOUR) : 24;
  if (self && RELATION_RE.test(text) && hoursSinceMaster >= 6) return 'lonely';
  if (/羡慕|嫉妒|别人|他们|都在/.test(text) && !self) return 'envious';
  if (need === 'care' && cues.negative) return 'worried';
  if (need === 'identity' && self && cues.positive) return 'proud';
  if (need === 'learn' || need === 'install' || need === 'identity') return 'curious';
  if ((need === 'play' || need === 'consume') && (cues.positive || cues.arousal > 0.6)) return 'excited';
  if (need === 'connect' && cues.positive) return 'affectionate';
  if (need === 'share' && (cues.positive || cues.arousal > 0.6)) return 'amused';
  if (!cues.positive && !cues.negative && hoursSinceMaster >= 8) return 'bored';
  return 'content';
}

/** 一轮结束后满足/消耗驱动：真正说出去了才降，没说出去只轻微回落。 */
export function satisfyDrives(drives, { need = '', action = '', outcome = 'sent' } : SatisfyDrivesOptions = {}) {
  const next: Record<string, number> = normalizeDrives(drives);
  if (outcome === 'sent') {
    if (need && next[need] != null) next[need] *= 0.45;
    if (action === 'confide' || need === 'connect') next.connect *= 0.55;
    next.share *= 0.9;
  } else if (outcome === 'silent') {
    if (need && next[need] != null) next[need] *= 0.85;
  }
  return next;
}

/** 心情向量归一化：只认十种已知情绪，每维钳到 0~1；未知键丢弃。 */
export function normalizeMoods(raw : NormalizeMoodsOptions = {}) {
  const next: Record<string, any> = {};
  if (isPlainObject(raw)) {
    for (const emotion of Object.keys(EMOTION_LABELS)) {
      const v = Number(raw[emotion]);
      if (Number.isFinite(v)) next[emotion] = clamp01(v);
    }
  }
  return next;
}

/**
 * 【已废弃】心情向量的跨轮推导。
 *
 * 2026-11-17 起心情向量的衰减/抬升统一由心情模块做（features/mood-emotions.js 的
 * deriveEmotionVector + features/mood.js 的 feel()）。这里保留一个薄壳只为两件事：
 *   1. 老测试/老调用还能跑（行为等价于旧实现，十项固定）；
 *   2. 迁移时不需要改历史数据的语义。
 * 新代码不要再用它——它不认用户配的心情项，也不跟心情的标量共用半衰期。
 */
export function deriveMoods({ moods = {}, moodsAt = 0, lastEmotion = '', now = Date.now(), halfLifeHours = 6 } : DeriveMoodsOptions = {}) {
  const next = normalizeMoods(moods);
  const hours = moodsAt > 0 ? Math.min(72, Math.max(0, (now - moodsAt) / HOUR)) : 0;
  const decay = Math.pow(0.5, hours / Math.max(1, Number(halfLifeHours) || 6));
  for (const emotion of Object.keys(next)) next[emotion] *= decay;
  if (EMOTION_LABELS[lastEmotion]) {
    next[lastEmotion] = Math.min(1, (next[lastEmotion] || 0) + 0.45);
  }
  return { moods: next, moodsAt: now };
}

// ── 目标假设层：把「看到的事」变成「一个带归属/置信度/风险的猜测」───────────────
// Codex 的提醒是对的：只按关键词生成「想玩/想装」会把「群友想玩」误当成「我想玩」。
// 所以这里不直接产出结论，而是产出 goal hypothesis：
//   谁的目标（自己 / 主人 / 群友 / 视频里的人）
//   + 证据 + 置信度 + 价值 + 紧迫度 + 风险 + 下一步
// 一次视频只能把置信度抬到 0.4~0.5；重复出现、自我相关、主人直接说，才会继续上升。
// 用户反馈（主人回复）会更新置信度/状态，而不是让一个猜测永久变成欲望。
export const GOAL_OWNERS = Object.freeze(['self', 'owner', 'member', 'media']);
export const GOAL_OWNER_LABELS = Object.freeze({ self: '我', owner: '主人', member: '群友', media: '视频里' });
export const GOAL_STATUSES = Object.freeze(['hypothesis', 'active', 'confirmed', 'rejected', 'done', 'expired']);

