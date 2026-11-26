import { Btn, Card, h } from '../../core/ui/ui.ts'

const isHtml = (url: string) => !/\.(json|txt|md|xml|csv)(\?|$)/i.test(url)

/** 插件用 ctx.page() 注册的页面：默认 iframe 打开，非 HTML 的地址给「新窗口打开」。 */
export function PluginPageFrame({ page }: { page: { name: string; path: string; url: string } }) {
  const url = String(page.url || '')
  const frame = /^https?:\/\//i.test(url) || url.startsWith('/')
  return h(Card, { title: page.name, right: h('a', { href: url, target: '_blank', rel: 'noreferrer' }, h(Btn, { small: true, kind: 'ghost' }, '新窗口打开')) },
    h('div', { className: 'ab-small ab-muted', style: { marginBottom: 8 } }, page.path),
    frame && isHtml(url)
      ? h('iframe', {
          src: url,
          title: page.name,
          style: { width: '100%', height: 'calc(100vh - 250px)', minHeight: 480, border: '1px solid var(--ab-line)', borderRadius: 8, background: '#fff' },
        })
      : h('div', { className: 'ab-note' }, h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url)))
}
