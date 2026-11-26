// 点歌参数解析：/sing 歌名 [变调] [开始=秒 时长=秒]

export function parseSingRequest(text): { song?: string; pitch?: number; startSec?: number; durationSec?: number; error?: string } {
  const input = String(text || '').trim()
  const legacy = value => {
    const m = value.match(/^(.*?)\s+([+-]\d{1,2})$/)
    return { song: (m ? m[1] : value).trim(), pitch: m ? Number(m[2]) : undefined }
  }
  if (!/(?:^|\s)(?:开始|时长)=/.test(input)) return legacy(input)
  const words = input.split(/\s+/), options: Record<string, any> = {}
  let pitch
  while (words.length) {
    const token = words.at(-1), m = /^(开始|时长)=(.*)$/.exec(token)
    if (m) {
      const key = m[1] === '开始' ? 'startSec' : 'durationSec'
      if (Object.hasOwn(options, key) || !/^\d+$/.test(m[2]) || !Number.isSafeInteger(Number(m[2]))) return { error: '片段参数每项只写一次，用整数秒数，例如：/sing 红日 李克勤 +12 开始=60 时长=30' }
      options[key] = Number(m[2]); words.pop()
    } else if (/^[+-]\d{1,2}$/.test(token)) {
      if (pitch !== undefined) return { error: '变调只写一次，例如 +12；未开始制作。' }
      pitch = Number(token); words.pop()
    } else break
  }
  if (words.some(w => /^(开始|时长)=/.test(w))) return { error: '把片段参数放在歌名后面，例如：/sing 红日 李克勤 开始=60 时长=30' }
  return { song: words.join(' '), pitch, ...options }
}
