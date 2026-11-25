import { useEffect, useState } from './../core/react.ts'
import { get } from './../core/api.ts'
import { Btn, Card, cx, h } from './../core/ui.ts'

// 机器人列表：内置 QQ + 插件通过 ctx.adapter() 挂上来的平台。
// 这里只负责「看得见」，接不接入是各平台自己的事（QQ 在「连接」页）。

const STATUS_TEXT: Record<string, string> = {
  online: '在线',
  offline: '离线',
  connecting: '连接中',
  registered: '已注册',
  error: '出错',
}

// ab-dot 只认 ok / warn / err 三个类名，其余走默认灰点
const STATUS_CLASS: Record<string, string> = {
  online: 'ok',
  connecting: 'warn',
  error: 'err',
}

interface BotRow {
  platform: string
  name: string
  id: string
  selfId: string
  status: string
}

export function Bots({ toast }: { toast?: (message: string) => void }) {
  const [rows, setRows] = useState(null)
  const [message, setMessage] = useState('')

  const load = async () => {
    const data = await get('/panel/bots')
    if (data.ok === false) {
      setMessage(String(data.message || '取不到机器人列表'))
      setRows([])
      return
    }
    setMessage('')
    setRows((data.bots || []) as BotRow[])
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => { clearInterval(timer) }
  }, [])

  return h(Card, { title: '机器人', desc: '一个平台一个号算一个实例。插件装上适配器后会自动出现在这里。' },
    h('div', { className: 'ab-flex', style: { justifyContent: 'flex-end', marginBottom: 8 } },
      h(Btn, { small: true, kind: 'ghost', onClick: async () => { await load(); toast && toast('已刷新') } }, '刷新')),
    message ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, message) : null,
    rows === null
      ? h('div', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 读取中…')
      : rows.length === 0
        ? h('div', { className: 'ab-muted ab-small' }, '还没有机器人。QQ 在「连接」页接入；其它平台装上对应的适配器插件即可。')
        : h('div', null, ...rows.map((row) => h(BotLine, { key: `${row.platform}:${row.id}`, row }))),
  )
}

function BotLine({ row }: { row: BotRow }) {
  const status = String(row.status || '')
  return h('div', { className: 'ab-row ab-flex', style: { alignItems: 'center', gap: 10, padding: '8px 0' } },
    h('i', { className: cx('ab-dot', STATUS_CLASS[status] || '') }),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', null, row.name || row.platform),
      h('div', { className: 'ab-muted ab-small' },
        `${row.platform} · ${row.selfId || '未登录'} · ${row.id}`)),
    h('span', { className: 'ab-small' }, STATUS_TEXT[status] || status || '未知'))
}
