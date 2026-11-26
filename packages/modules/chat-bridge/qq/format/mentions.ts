const AT_TAG = /<at:\s*([^>]{1,30}?)\s*>/g

export function memberNames(members) {
  const byName = new Map() // 名字 → Set(QQ号)
  const add = (name, qq) => {
    const n = String(name || '').trim()
    if (!n) return
    if (!byName.has(n)) byName.set(n, new Set())
    byName.get(n).add(qq)
  }
  for (const m of members || []) {
    const qq = String(m.user.id ?? '')
    if (!qq) continue
    for (const raw of [m.nick, m.user.nick, m.user.name]) {
      add(raw, qq)
      add(String(raw || '').replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*$/, ''), qq)
    }
  }
  return byName
}

export function resolveMember(who, byName) {
  const w = String(who || '').replace(/^@/, '').trim()
  if (/^\d{5,12}$/.test(w)) return w
  const hit = byName.get(w)
  return hit && hit.size === 1 ? [...hit][0] : ''
}

function longestName(rest, byName) {
  // 名字里可能带标点（「。Luna」），所以只按空白和 @ 截；最长匹配会把后面跟着的标点让出来
  const head = rest.match(/^[^\s@＠]{1,20}/)?.[0] || ''
  for (let n = head.length; n >= 1; n--) {
    const qq = resolveMember(head.slice(0, n), byName)
    if (qq) return { qq, len: n }
  }
  return null
}

export function expandMentions(segs, members, missed = []) {
  const byName = memberNames(members)
  const out = []
  const pushText = (t) => { if (t) out.push({ type: 'text', data: { text: t } }) }
  for (const seg of segs) {
    if (seg.type !== 'text') { out.push(seg); continue }
    const s = seg.data.text
    let buf = ''
    let i = 0
    while (i < s.length) {
      AT_TAG.lastIndex = i
      const tag = s[i] === '<' ? AT_TAG.exec(s) : null
      if (tag && tag.index === i) {
        const qq = resolveMember(tag[1], byName)
        if (qq) { pushText(buf); buf = ''; out.push({ type: 'at', data: { qq } }) }
        else { missed.push(tag[1].replace(/^@/, '')); buf += '@' + tag[1].replace(/^@/, '') }
        i += tag[0].length
        continue
      }
      if (s[i] === '@' || s[i] === '＠') {
        const hit = longestName(s.slice(i + 1), byName)
        if (hit) {
          pushText(buf); buf = ''
          out.push({ type: 'at', data: { qq: hit.qq } })
          i += 1 + hit.len
          if (i < s.length && !/\s/.test(s[i])) buf += ' '
          continue
        }
        const name = s.slice(i + 1).match(/^[^\s@，。！？,.!?、：:]{1,20}/)?.[0]
        if (name) missed.push(name)
      }
      buf += s[i]
      i++
    }
    pushText(buf)
  }
  return out
}

export const hasMention = (text) => /[@＠]|<at:/.test(String(text || ''))
