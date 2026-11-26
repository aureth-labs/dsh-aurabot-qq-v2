import { PANEL_ID } from './core/api/constants.ts'
import { WhaleIcon } from './core/ui/icons.ts'
import { AurabotPage } from './panel.ts'

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  // 写法同 DSH 自带的「自动化任务」（order 10）和「插件」（order 0）：排在它们后面
  slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, AurabotPage))
  slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
}

export { apply }
