import { cx, h } from './ui/ui.ts'

function LogLine({ e }) {
  return h('div', { className: cx('ab-log', e.level) }, h('span', { className: 't' }, e.time), h('span', { className: 'a' }, e.area), h('span', { className: 'm' }, e.text))
}

/** 控制台密码状态：插件自动管理；登不上时给「重置为自动密码」。 */

export { LogLine }
