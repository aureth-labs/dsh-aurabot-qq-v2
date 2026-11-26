const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/

export function fenceRanges (text) {
  const ranges = []
  let open = -1
  let openMarker = ''
  let openLen = 0
  let pos = 0
  for (const line of String(text || '').split('\n')) {
    const m = FENCE_LINE.exec(line)
    if (m) {
      const marker = m[1][0]
      const len = m[1].length
      const rest = line.slice(m[0].length)
      if (open < 0) {
        open = pos
        openMarker = marker
        openLen = len
      } else if (marker === openMarker && len >= openLen && /^[ \t]*$/.test(rest)) {
        ranges.push({ start: open, end: pos + line.length })
        open = -1
        openMarker = ''
        openLen = 0
      }
    }
    pos += line.length + 1
  }
  if (open >= 0) ranges.push({ start: open, end: String(text).length })
  return ranges
}
