export function failPrompt(title, why) {
  return [
    `有人点了一首《${title}》，但这次没唱成。`,
    `内部原因（只给你看，不要念出来，也不要提技术细节、额度、报错原文）：${why || '没说清'}`,
    '',
    '在当前聊天里跟对方说一句话：',
    '- 一句话，口语，像你自己在说话；别用客服腔（「抱歉给您带来不便」那种）',
    '- 可以说得含糊、可以撒个娇、可以说回头再试；别编一个具体的技术理由',
    '- 不要出现路径、英文报错、错误码、额度数字',
    '- 只输出这一句话，别加引号，别解释你在做什么',
    '- 实在不想说，就只输出 [沉默]',
  ].join('\n')
}

const SILENT = /^[\[【(（]\s*沉默\s*[\]】)）]$/
const LEAK = /error|enoent|traceback|http:\/\/|https:\/\/|api[ _-]?key|token|额度|字节|\d+\s*(?:mb|gb)\b/i

export function cleanFailLine(text) {
  const first = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*#-]+/, '').trim())
    .find(Boolean) || ''
  if (!first || SILENT.test(first)) return ''
  const line = first
    .replace(/^(?:大肥鱼|小鲸鱼|鲸鱼娘|我)\s*[：:]\s*/, '')
    .replace(/^[「"'“”『』]+|[」"'“”『』]+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line || SILENT.test(line) || LEAK.test(line) || /[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/[^\s/]+\//.test(line)) return ''
  if (line.length <= 60) return line
  // 太长就截到第一个句末；实在没有句末就硬截
  const cut = line.search(/[。！？!?~～]/)
  return cut >= 4 ? line.slice(0, cut + 1) : line.slice(0, 60)
}
