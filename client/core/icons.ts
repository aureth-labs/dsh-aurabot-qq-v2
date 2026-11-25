import { h } from './ui.ts'

// ---------------- 图标 ----------------
function WhaleIcon({ size }) {
  const s = size || 16
  return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M3 13c0 3.6 3.3 6 8 6 4.6 0 8.2-2.7 8.7-6.6.1-.8.8-1.4 1.6-1.4H22c-.3-1.6-1.6-2.6-3-2.6-1.8 0-3 1.2-3.6 2.6H9c-3.4 0-6 .4-6 2Z' }),
    h('path', { d: 'M7.5 3.5c.8.9.9 2.3.2 3.3M10.5 3.5c-.8.9-.9 2.3-.2 3.3M9 6.8V9' }),
    h('circle', { cx: 7.3, cy: 13.3, r: 0.6, fill: 'currentColor' }),
  )
}

const navIcon = (d) => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d }))

function PinIcon({ filled }) {
  return h('svg', {
    width: 13, height: 13, viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
    h('path', { d: 'M12 17v5' }),
    h('path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' }))
}

/**
 * 语音接口选择：默认只露前 4 个；常用接口可置顶（最多 4 个），
 * 其余接口点「更多」再显示。置顶状态存本地，不跟设置草稿走。
 */

export { WhaleIcon, navIcon, PinIcon }
