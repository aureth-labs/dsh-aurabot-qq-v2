import { DAY, FADING_ID, FADING_LABEL, FADING_THRESHOLD, ARCHIVED_ID, ARCHIVED_LABEL, EVENT_ROOT_ID, EVENT_ROOT_LABEL, EXPERIENCE_PREFIX, TYPE_ORDER, LAYOUT_VERSION, clamp, round3, timeOf } from './shared.ts'

/** 迁移用：和内置 memory.js 当前的 tau 公式保持一致，上线当天亮度不变。 */
export function initialStability(item) {
  const hitDays = Math.min(10, Math.max(0, Number(item.hitDays) || 0));
  const importance = clamp(item.importance ?? 0.5, 0, 1);
  return 20 * (1 + hitDays) * (0.5 + importance);
}

/** 艾宾浩斯保留率 R 和显示亮度 b。 */
export function brightness(star, item, now = Date.now()) {
  const last = timeOf(star?.lastHit, 0) || timeOf(item?.lastHit, 0) || timeOf(item?.at, now);
  const age = Math.max(0, (now - last) / DAY);
  const S = Math.max(1, Number(star?.S) || initialStability(item || {}));
  const retention = Math.exp(-age / S);
  const importance = clamp(item?.importance ?? 0.5, 0, 1);
  return clamp(retention * (0.6 + 0.4 * importance), 0, 1);
}

export function regionOf(item) {
  if (item?.archivedAt) return 'archived';
  if (item?.invalidAt) return 'outdated';
  if (item?.source === 'event') return 'event';
  if (item?.about) return 'person';
  if ((Number(item?.importance) || 0) >= 0.8) return 'core';
  return 'knowledge';
}

export function grams(text) {
  const s = String(text || '').replace(/[^\p{L}\p{N}]+/gu, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  if (!out.size && s) out.add(s);
  return out;
}

export function similarity(a, b) {
  const A = a instanceof Set ? a : grams(a);
  const B = b instanceof Set ? b : grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/**
 * 只按「同人物 / 同标签 / 高相似 / 被取代」建边，每颗星最多 5 条。
 * 不做全量两两比较，避免 3000 条时变成一坨毛球。
 */
export function buildEdges(items, perStar = 5) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const pairs = new Map();
  const add = (a, b, kind, weight) => {
    if (!a || !b || a === b) return;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const cur = pairs.get(key);
    if (!cur || cur.weight < weight) pairs.set(key, { a, b, kind, weight });
  };

  const BUCKET_LIMIT = 80;

  // 桶先收集全部成员，建边时再按等间距抽样到 BUCKET_LIMIT 条。
  // 直接截前 80 条会让大人物/大标签的后半段记忆永远没有边。
  const sampleBucket = (ids) => {
    if (ids.length <= BUCKET_LIMIT) return ids;
    const step = (ids.length - 1) / (BUCKET_LIMIT - 1);
    const sampled = [];
    for (let i = 0; i < BUCKET_LIMIT; i += 1) sampled.push(ids[Math.round(i * step)]);
    return sampled;
  };

  const buckets = new Map();
  const push = (key, id) => {
    if (!key) return;
    let set = buckets.get(key);
    if (!set) { set = new Set(); buckets.set(key, set); }
    set.add(id);
  };
  const text = new Map();
  for (const it of items) {
    if (!it || !it.id || it.invalidAt || it.archivedAt) continue;
    text.set(it.id, grams(it.text));
    if (it.about) push(`p:${it.about}`, it.id);
    for (const tag of Array.isArray(it.tags) ? it.tags.slice(0, 3) : []) push(`t:${tag}`, it.id);
  }

  for (const [key, members] of buckets) {
    const ids = sampleBucket([...members]);
    const kind = key.startsWith('p:') ? 'person' : 'tag';
    const base = kind === 'person' ? 0.5 : 0.4;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) add(ids[i], ids[j], kind, base);
    }
  }

  // 相似度只算一次：以前这段放在桶循环里，同一对星同属 N 个桶就被算 N 次
  // （实测真实数据有一对被算了 4 遍，整体 13% 是重复计算）。
  // 现在先把所有「同桶候选对」收集进集合去重，再统一算一次相似度。
  const simPairs = new Set<string>();
  const simKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const [, members] of buckets) {
    const ids = sampleBucket([...members]);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) simPairs.add(simKey(ids[i], ids[j]));
    }
  }
  for (const key of simPairs) {
    const sep = key.indexOf('\u0000');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    if (similarity(text.get(a), text.get(b)) >= 0.35) add(a, b, 'similar', 0.6);
  }

  for (const it of items) {
    if (it?.supersededBy && byId.has(it.supersededBy)) add(it.id, it.supersededBy, 'conflict', 1);
  }

  const ranked = [...pairs.values()].sort((x, y) => y.weight - x.weight);
  const count = new Map();
  const out = [];
  for (const edge of ranked) {
    if ((count.get(edge.a) || 0) >= perStar || (count.get(edge.b) || 0) >= perStar) continue;
    out.push(edge);
    count.set(edge.a, (count.get(edge.a) || 0) + 1);
    count.set(edge.b, (count.get(edge.b) || 0) + 1);
  }
  return out;
}

export function brightnessLabel(value) {
  if (value >= 0.7) return '清晰';
  if (value >= FADING_THRESHOLD) return '有点模糊';
  if (value >= 0.05) return '快忘了';
  return '几乎想不起';
}

// ─────────────────────────────────────────────────────────────
// 和 Aurabot rc1 的档位对接（这一段是移植时新加的，上面全是原版算法）
//
// 记忆中枢原本对着 1.1.24 的 tier 值域 `short / long / core` 写的；
// rc1（1.2.0）的 tier 是数字 `0 / 1 / 2 / 3` 加上字符串 `'core'`。
//
// 语义对照（用户确认过）：
//   rc1 0     永久档      → 星图 core（永久）
//   rc1 1     琐碎/临时    → 星图 short（临时）
//   rc1 2     一般/长期    → 星图 long（长期）
//   rc1 3     重要        → 星图 core（永久）
//   rc1 'core' 长期印象    → 星图 core（永久）
//   rc1 undefined 未分档   → 星图 long（长期）——和中枢默认一致
// 反查（星图 → rc1 数字档，用于手动分层）：
//   short → 1，long → 2，core → 3
// ─────────────────────────────────────────────────────────────
export const TIER_TO_STAR = { 0: 'core', 1: 'short', 2: 'long', 3: 'core', core: 'core' };
export const STAR_TO_TIER = { short: 1, long: 2, core: 3 };
export const STAR_TIER_LABEL = { short: '临时', long: '长期', core: '永久' };

/** rc1 的 tier 值 → 星图用的 tier 标签。认不出来的统一按「长期」。 */
export function toStarTier(tier) {
  if (tier === undefined || tier === null) return 'long';
  const key = typeof tier === 'string' ? tier : Number(tier);
  return TIER_TO_STAR[key] || 'long';
}

/**
 * 星图的 tier 标签（short/long/core）→ rc1 的数字档（0~3）。
 * 认不出来的返回 null（调用方据此拒绝改档）。
 * 兼容直接传数字的情况（面板/导入有时手上已经是 0~3）。
 */
export function toHostTier(starTier) {
  if (Number.isInteger(starTier) && starTier >= 0 && starTier <= 3) return starTier
  const n = STAR_TO_TIER[String(starTier || '')]
  return Number.isInteger(n) ? n : null
}
