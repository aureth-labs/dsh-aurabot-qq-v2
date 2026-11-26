// 记忆星图共用的常量与数值工具。

export const DAY = 86_400_000;
export const GOLDEN = 2.399963229728653;
export const LAYOUT_VERSION = 7;
export const FADING_ID = 'fading';
export const FADING_LABEL = '快忘了';
export const FADING_THRESHOLD = 0.35;
// 清晰度低于阈值的长期记忆会被内置整理归档，统一放在星图上方的「归档星云」。
export const ARCHIVED_ID = 'archived';
export const ARCHIVED_LABEL = '归档星云';
// 「经历」是内置 memory 给事件记忆打的第一个标签。事件按 about 再分两类：
// 有 about 的是和这个人一起的经历（主人画画/唱歌），没 about 的是自己的经历（刷B站/抖音）。
// 团内的二级标签（B站、画画、唱歌……）作为子模块在面板里展开。
export const EVENT_ROOT_ID = 'tag:经历';
export const EVENT_ROOT_LABEL = '自己的经历';
export const EVENT_ROOT_TAG = '经历';
export const EXPERIENCE_PREFIX = 'exp:';
export const TYPE_ORDER = ['person', 'event', 'core', 'knowledge', 'outdated', 'archived'];
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));
export const round3 = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };

export const timeOf = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : fallback;
};
