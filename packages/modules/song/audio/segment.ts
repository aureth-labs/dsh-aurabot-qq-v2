

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type ValidateSongClipOptions = Partial<Record<'startSec' | 'durationSec', any>>// 每次点歌的片段参数；不修改面板默认值，不影响旧的 /sing 用法。
export class SongClipError extends Error {}

export function validateSongClip({ startSec, durationSec } : ValidateSongClipOptions = {}, maxSec = 120) {
  if (startSec === undefined && durationSec === undefined) return { ok: true, clip: null }
  if (startSec !== undefined && (!Number.isSafeInteger(startSec) || startSec < 0 || startSec > 86400)) return { ok: false, message: '开始位置请填 0～86400 的整数秒数。' }
  if (durationSec !== undefined && (!Number.isSafeInteger(durationSec) || durationSec < 1)) return { ok: false, message: '时长请填大于 0 的整数秒数。' }
  const limit = Number(maxSec) > 0 ? Number(maxSec) : 120
  if (durationSec > limit) return { ok: false, message: `这次最多唱 ${limit} 秒；想更长，请先在翻唱面板调整「语音条最长」。` }
  return { ok: true, clip: { startSec: startSec ?? 0, durationSec: durationSec ?? limit } }
}

export function selectedWindow(duration, clip) {
  if (!(duration > 0) || !Number.isFinite(duration)) throw new SongClipError('读不到歌曲时长，没法准确截取；请换一首或稍后再试。')
  if (clip.startSec >= duration) throw new SongClipError(`开始位置超过了歌尾（歌曲约 ${Math.floor(duration)} 秒），请把开始秒数调小。`)
  return { start: clip.startSec, length: Math.min(clip.durationSec, duration - clip.startSec) }
}

// 无指定片段时保留原来的缓存身份；不同片段不能串用成品。
export const clipCacheParts = (clip, cfg) => clip ? ['segment-v1', clip.startSec, clip.durationSec] : [cfg.maxVoiceSec, cfg.clipStart]
export const clipLabel = clip => clip ? `第 ${clip.startSec} 秒起，最多 ${clip.durationSec} 秒` : ''
export const clipFade = length => {
  const fadeIn = Math.min(1.5, length / 4), fadeOut = Math.min(3, length / 4)
  return `afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, length - fadeOut)}:d=${fadeOut}`
}

/** 可选尾参数：开始=60 时长=30；不写参数时完全沿用旧歌名/变调解析。 */
