import { useState, useEffect } from './ui/react.ts'
import { cx, h } from './ui/ui.ts'

// 自动记忆原本按来源分别限额；调整总数时按当前比例分配整数名额。
const MEMORY_CAPACITY_DEFAULT = { auto: 2000, event: 600, diary: 400 }

// 「翻一翻」首屏一页 60 条，后面的点「加载更多」再取；不要一次拉 300 条。
const MEMORY_PAGE_SIZE = 60

const memoryCapacity = (value) => Object.fromEntries(Object.entries(MEMORY_CAPACITY_DEFAULT).map(([key, fallback]) => {
  const n = Number(value?.[key])
  return [key, value?.[key] != null && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback]
}))

const resizeMemoryCapacity = (current, total) => {
  const values = memoryCapacity(current)
  let weights = Object.values(values)
  let sum = weights.reduce((a, n) => a + n, 0)
  if (!sum) { weights = Object.values(MEMORY_CAPACITY_DEFAULT); sum = 3000 }
  const limits = weights.map((n) => Math.floor(n * total / sum))
  let extra = total - limits.reduce((a, n) => a + n, 0)
  while (extra-- > 0) {
    let best = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] * (limits[best] + 1) > weights[best] * (limits[i] + 1)) best = i
    limits[best]++
  }
  return Object.fromEntries(Object.keys(MEMORY_CAPACITY_DEFAULT).map((key, i) => [key, limits[i]]))
}

const SOURCE = { tool: 'ta自己记的', auto: '每日整理', diary: '空间日记', panel: '你加的', event: 'ta的经历', import: '导入的', abstract: '长期印象' }

// 人物记忆的数据直接保存，不走全局设置草稿。
const PERSON_FIELDS = [['alias', '称呼'], ['style', '说话方式'], ['persona', '性格'], ['handle', '怎么相处'], ['text', '小档案']]

const personName = (p) => p.alias || p.name || p.qq

const memoryDate = (at) => {
  if (!at) return '时间未知'
  const d = new Date(at)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const gistSource = (id) => String(id || '').startsWith('group:') ? '群 ' + String(id).slice(6)
  : String(id || '').startsWith('private:') ? '私聊 ' + String(id).slice(8) : (id || '来源未知')

const gistLevel = (g) => g.kind === 'seen' ? '看过的内容' : g.level === 1 ? '梗概' : g.level === 2 ? '印象' : '其他'

const memoryEnded = (m) => Boolean(m.invalidAt || (m.validUntil && m.validUntil <= Date.now()))

const FACES = ['#4d7fc4', '#3e9c8f', '#8a6fc0', '#c07a4d', '#c05f7e', '#5f8f4e']

const faceColor = (qq) => FACES[[...String(qq)].reduce((n, c) => n + c.charCodeAt(0), 0) % FACES.length]

/** QQ 头像，读不到就用名字的第一个字。 */

function PersonFace({ p, big }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [p.qq])
  const name = personName(p)
  return h('span', { className: cx('ab-pm-face', big && 'big'), style: { background: faceColor(p.qq) }, 'aria-hidden': 'true' },
    broken ? [...name][0] || '?' : h('img', { src: 'https://q1.qlogo.cn/g?b=qq&s=100&nk=' + encodeURIComponent(p.qq), alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setBroken(true) }))
}

export { MEMORY_CAPACITY_DEFAULT, MEMORY_PAGE_SIZE, memoryCapacity, resizeMemoryCapacity, SOURCE, PERSON_FIELDS, personName, memoryDate, gistSource, gistLevel, memoryEnded, FACES, faceColor, PersonFace }
