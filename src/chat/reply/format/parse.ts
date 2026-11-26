// 解析一轮回复：拆气泡、认语音/表情/戳一戳/引用，并给出「她说过的话」的一行文本。

import { SILENCE, tidyPunctuation, stripToolText, cleanOutboundText, stripModelArtifacts, codeRanges, insideCode, isSilence, stripSilenceMarks, stripMarkdown } from './sanitize.ts'

/** 模型偶尔把协议标签写成中文参数语法（<参数 name="sticker">名字<参数>）；转成可解析标签。 */
function normalizeParamTags (text) {
  return String(text || '').replace(/[<＜]\s*参数\s+name\s*=\s*["'“”]?\s*(sticker|voice|poke)\s*["'“”]?\s*[>＞]([\s\S]*?)[<＜]\s*\/?\s*参数\s*[>＞]/gi, (match, name, body) => {
    if (name.toLowerCase() === 'sticker') return `<sticker:${body.trim()}>`
    if (name.toLowerCase() === 'voice') return `<voice>${body.trim()}</voice>`
    return '<poke>'
  })
}

/** 解析一轮回复；在拆气泡/语音前清洗，避免协议里的竖线被误作气泡分隔符。 */
export function parseReply(text, options) {
  // 模型偶尔把「戳人」写成方括号动作（[戳了戳你：尾巴往回一收]），插件不认这种写法，
  // 会原样当文字发出去。这里统一转成 <poke>，让戳一戳变成真的系统动作。
  // 模型偶尔写中文参数标签 <参数 name="sticker">…<参数>，同样在解析前归一成协议标签。
  const forwarded = normalizeParamTags(String(text || '')).replace(/[[【]\s*戳了戳(?:你|他|她)?[^\]】]*[\]】]/g, '<poke>')
  // 模型偶尔把换行写成 HTML `<br>`：当真正的换行处理；代码示例里的字面量保留。
  const cleaned = stripModelArtifacts(cleanOutboundText(forwarded, options))
  const code = codeRanges(cleaned)
  const raw = cleaned.replace(/<br\s*\/?>/gi, (tag, offset) => insideCode(code, offset, offset + tag.length) ? tag : '\n').trim()
  if (isSilence(raw)) return { silent: true, items: [] }
  // 工具显式指定语音：仍经过同一份清洗，但正文不再当作媒体/气泡指令解析。
  if (options?.voice === true) {
    const value = stripSilenceMarks(stripMarkdown(tidyPunctuation(raw)))
    return { silent: !value, items: value ? [{ kind: 'voice', value }] : [] }
  }
  const items = []
  let replyTo = '' // 等着挂到下一条气泡上的「引用回复」编号
  const attach = (from) => {
    if (replyTo && items.length > from) {
      items[from].replyTo = replyTo
      replyTo = ''
    }
  }
  // 连续多写的竖线仍是同一个分隔符，避免 |||| 拆完残留一条 | 消息。
  for (const bubble of raw.split(/\|{3,}/)) {
    const part = bubble.trim()
    if (!part) continue
    // 依次切出 poke / reply / voice / sticker / markdown 图片，其余是文字
    const re = /<poke(?:\s+id\s*=\s*["']\d+["'])?\s*\/?>|<\/poke\s*>|<reply:\s*(\d+)\s*>|<voice>([\s\S]*?)<\/voice>|<sticker:([^>]+?)>(?:\s*<\/sticker>)?|!\[[^\]]*\]\(\s*([^)\s]+)\s*\)|\[表情[:：]\s*([^\]\n]+?)\s*\]|<text>([\s\S]*?)<\/text>|<file(?:\s+name\s*=\s*["']([^"']*)["'])?>([\s\S]*?)<\/file>|<quote\s+id\s*=\s*["'](-?\d+)["']\s*\/>/g
    let last = 0
    let m
    while ((m = re.exec(part)) !== null) {
      let from = items.length
      pushText(items, part.slice(last, m.index))
      attach(from)
      from = items.length
      if (m[0].startsWith('<poke')) {
        if (!items.some((i) => i.kind === 'poke')) items.push({ kind: 'poke', value: /["'](\d+)["']/.exec(m[0])?.[1] ?? '' })
      } else if (m[9] !== undefined) {
        replyTo = 'id:' + m[9]
      } else if (m[1] !== undefined) {
        replyTo = m[1]
      } else if (m[2] !== undefined) {
        const v = stripSilenceMarks(stripMarkdown(tidyPunctuation(m[2])))
        if (v) items.push({ kind: 'voice', value: v })
      } else if (m[3] !== undefined) {
        const v = m[3].trim()
        if (v) items.push({ kind: 'sticker', value: v })
      } else if (m[4] !== undefined) {
        items.push({ kind: 'image', value: m[4] })
      } else if (m[5] !== undefined) {
        // 模型常写成「[表情: 无语死鱼脸]」而不是 <sticker:…>：按表情名尝试匹配，匹配不到宁可不发，也不能把描述当文字发出去。
        const v = m[5].trim()
        if (v) items.push({ kind: 'sticker', value: v })
      } else if (m[6] !== undefined) {
        // <text> 只是「这段是文字」的显式写法，里面照常拆行。
        pushText(items, m[6])
      } else if (m[8] !== undefined) {
        const file = m[8].trim()
        if (file) items.push({ kind: 'file', value: file, name: (m[7] || '').trim() })
      }
      attach(from)
      last = re.lastIndex
    }
    const from = items.length
    pushText(items, part.slice(last))
    attach(from)
  }
  // 一轮最多引用一次，多的去掉（大多数时候正常发就好）
  let quoted = false
  for (const it of items) {
    if (!it.replyTo) continue
    if (quoted) delete it.replyTo
    quoted = true
  }
  if (items.length === 0) return { silent: true, items: [] }
  return { silent: false, items: capBubbles(items) }
}

const MAX_BUBBLES = 5

/** 优先合并靠后的相邻文字，尽量收在 5 条内。媒体和新的引用各自保留位置。 */
function capBubbles(items) {
  let excess = items.filter(item => item.kind === 'text').length - MAX_BUBBLES
  if (excess <= 0) return items

  // 从后往前挑可以合并的边界，纯文字仍然先保留前四条。
  const joinPrevious = new Set()
  for (let i = items.length - 1; i > 0 && excess > 0; i--) {
    if (items[i].kind === 'text' && !items[i].replyTo && items[i - 1].kind === 'text') {
      joinPrevious.add(i)
      excess--
    }
  }
  const out = []
  for (let i = 0; i < items.length; i++) {
    const first = items[i]
    if (!joinPrevious.has(i + 1)) { out.push(first); continue }
    const lines = [first.value]
    while (joinPrevious.has(i + 1)) lines.push(items[++i].value)
    out.push({ ...first, value: lines.join('\n') })
  }
  return out
}

/**
 * 一段文字拆成几条气泡：真人打字是一行一条发出去的。
 * 有代码块、或者是长篇内容（比如帮主人查东西的结果）就整段发，不拆。
 */
export function splitLines(text) {
  const t = String(text || '').trim()
  if (!t) return []
  if (t.includes('```') || t.length > 240) return [t]
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (lines.length <= 1) return lines
  // 像列表 / 步骤的多行内容（一大半以数字或符号开头）也整段发
  const listy = lines.filter((l) => /^(\d+[.、)]|[-*•·])/.test(l)).length
  if (listy >= Math.ceil(lines.length / 2)) return [t]
  return lines
}

/**
 * 把这一轮真发出去的东西写成一行（聊天流水、记忆、下次交给她时「我说过什么」都看这行）。
 * 表情必须留名字：只写 `[sticker]` 的话，她事后认不出自己发的是哪一张——
 * 被说「乱贴表情」时连自查都做不到。
 */
export function itemsToLine(items, resolveSticker: (value?: unknown) => any = () => null) {
  return (items || [])
    .map((i) => {
      if (!i) return ''
      if (i.kind === 'text' || i.kind === 'voice') return String(i.value ?? '')
    if (i.kind === 'file') return '[文件] ' + (i.name || i.value)
      if (i.kind === 'sticker') {
        const item = i.value && typeof i.value === 'object' ? i.value : resolveSticker(i.value)
        const name = item?.name || (item?.md5 ? String(item.md5).slice(0, 8) : '')
        return name ? `[表情：${name}]` : '[表情]'
      }
      return `[${i.kind}]`
    })
    .filter((s) => s !== '')
    .join(' ')
}

function pushText(items, s) {
  // 写坏的引用标签、落单的 <text> 直接去掉；混在正文里的沉默标记也全部剥掉，整行只剩标记时按沉默跳过。
  const raw = String(s || '').replace(/<\/?reply[^>]*>/g, '').replace(/<\/?text\s*>/gi, '')
  const t = stripSilenceMarks(stripMarkdown(tidyPunctuation(raw)))
  if (!t || isSilence(t)) return
  // 代码块在 stripMarkdown 之后围栏就没了，必须在原文里先判断，整段保留不拆行。
  const lines = /```|~~~/.test(raw) ? [t] : splitLines(t)
  for (const line of lines) if (!isSilence(line)) items.push({ kind: 'text', value: line })
}

/** 对方是不是明确要她发语音（「用语音说」「发个语音」「语音回我」……）。 */
export function wantsVoice(text) {
  const t = String(text || '')
  if (t.includes('不要语音') || t.includes('别发语音')) return false
  return /(用|发|来|给我|录)[^，。？！\n]{0,4}语音|语音[^，。？！\n]{0,4}(说|发|讲|回|念|唱)/.test(t)
}

/**
 * 发下一条之前停多久（毫秒）：按「打字速度」算——下一条越长停越久，再加一点随机抖动。
 * @param {string} [next] 下一条要发的内容
 */
export function bubbleDelay(next = '', rand = Math.random) {
  if (typeof next === 'function') { rand = next; next = '' }
  const len = String(next || '').length
  const typing = 350 + len * 110 // 大约每秒 9 个字
  return Math.round(Math.min(4500, Math.max(700, typing)) * (0.8 + rand() * 0.5))
}
