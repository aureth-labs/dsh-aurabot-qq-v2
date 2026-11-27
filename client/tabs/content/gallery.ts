import { useState, useEffect } from '../../core/ui/react.ts'
import { API, get, getCached, post } from '../../core/api/api.ts'
import { setPath, timeAgo } from '../../core/ui/format.ts'
import { Btn, Card, Empty, Row, h, useField } from '../../core/ui/ui.ts'

/** 「她的画作」：读存图目录里最近的 N 张，可以单张删除、开文件夹。 */

function PaintGallery({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const shown = Math.min(50, Math.max(1, Number(draft.imageGen && draft.imageGen.galleryShown) || 20))
  const [data, setData] = useState(null)
  const load = async () => {
    const r = await getCached('/image/gallery?limit=' + shown).catch(() => null)
    setData(r && r.ok ? r : { items: [], total: 0, dir: '' })
  }
  useEffect(() => { load() }, [shown])
  const del = async (file) => {
    if (!confirm('删掉这张画？\n' + file)) return
    const r = await post('/image/gallery/delete', { file }).catch(() => ({ ok: false }))
    toast(r.message || (r.ok ? '删掉了' : '删除失败'), r.ok ? 'ok' : 'err')
    load()
  }
  return h(Card, {
    title: 'ta的画作' + (data ? '（显示最近 ' + data.items.length + ' 张 / 共 ' + data.total + ' 张）' : ''),
    desc: 'ta画过的图都存在本机（不会自动删），这里只是面板里显示多少张。想看全部或者清理，点「打开文件夹」。',
    right: h('div', { className: 'ab-flex' },
      h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新'),
      h(Btn, { small: true, kind: 'ghost', onClick: () => post('/image/open-folder').then((r) => toast(r.message, r.ok ? 'ok' : 'err')).catch(() => toast('打不开文件夹', 'err')) }, '打开文件夹')),
  },
    h(Row, { label: '面板显示最近', hint: '最多 50 张；只影响面板显示，不删文件' },
      f.num('imageGen.galleryShown', { min: 1, max: 50 }), h('span', { className: 'ab-muted' }, '张')),
    data && data.dir ? h('div', { className: 'ab-muted ab-small', style: { margin: '4px 0 8px', wordBreak: 'break-all' } }, '存图目录：' + data.dir) : null,
    !data ? h(Empty, { icon: '⏳', text: '加载中…' })
      : data.items.length === 0 ? h(Empty, { icon: '🎨', text: 'ta还没画过图。在聊天里说「画一张……」，画好的图会出现在这里。' })
        : h('div', { className: 'ab-shots' }, data.items.map((it) => h(PaintCell, { key: it.file, it, onDelete: () => del(it.file) }))),
  )
}

function PaintCell({ it, onDelete }) {
  const src = API + '/image/gallery/image?file=' + encodeURIComponent(it.file)
  const cap = it.prompt ? '「' + it.prompt + '」' : '画作'
  const when = it.at ? timeAgo(it.at) : ''
  return h('div', { className: 'ab-shot' },
    h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: cap, loading: 'lazy' })),
    h('div', { className: 'cap', title: cap }, cap + (when ? '　' + when : '')),
    h('button', { type: 'button', className: 'ab-btn sm danger x', title: '删除', onClick: onDelete }, '✕'),
  )
}

function CodexSub({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [status, setStatus] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => get('/image/codex/status').then(setStatus).catch(() => setStatus({ loggedIn: false }))
  useEffect(() => { refresh() }, [])
  useEffect(() => {
    if (!waiting) return undefined
    let active = true
    const timer = setInterval(async () => {
      const r = await get('/image/codex/login/status').catch(() => null)
      if (!active || !r) return
      if (r.state === 'done' || r.state === 'error') {
        clearInterval(timer); setWaiting(null); setInput(''); refresh()
        toast(r.state === 'done' ? '登录成功' : r.error || '登录失败')
      }
    }, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [Boolean(waiting)])
  const act = (path, body = {}) => async () => {
    setBusy(true)
    const r = await post(path, body).catch(() => ({ ok: false, message: '请求失败' }))
    setBusy(false)
    if (!r.ok) { toast(r.message || '操作失败'); return }
    setInput('')
    if (path.endsWith('/login')) setWaiting({ url: r.url, needPaste: r.needPaste })
    else { setWaiting(null); refresh(); toast(path.endsWith('/logout') ? '已退出 ChatGPT' : path.endsWith('/cancel') ? '已取消登录' : '登录成功') }
  }
  // 1455 被系统保留时：没登录（或正在登录）才提示并显示粘贴框；登录完成后收起，只留「重新登录」
  const callbackUnavailable = Boolean(status && status.callback && status.callback.available === false)
  const needManualCallback = callbackUnavailable && (!status?.loggedIn || Boolean(waiting))
  return h('div', null,
    h('div', { className: 'ab-note', style: { margin: '8px 0' } }, '实验性订阅接法：使用非公开图片端点，可用性和额度由账号、工作区及服务端决定。登录信息仅存本机。'),
    needManualCallback
      ? h('div', { className: 'ab-note warn', style: { margin: '8px 0' } }, '本机 1455 端口被系统保留（Windows 开了 Hyper-V / WSL 时常见）：插件没法自动接收回调，浏览器会显示「无法访问」，但地址栏里就是完整回调地址，复制回来粘贴即可完成登录。')
      : null,
    h(Row, { label: 'ChatGPT 账号' },
      h('span', { className: 'ab-small' }, status === null ? '读取登录状态…' : status.loggedIn ? '已登录：' + (status.email || status.accountId) : '尚未登录'),
      h(Btn, { small: true, onClick: act('/image/codex/login'), disabled: busy || Boolean(waiting) }, status?.loggedIn ? '重新登录 ChatGPT' : '登录 ChatGPT'),
      status?.loggedIn ? h(Btn, { small: true, onClick: act('/image/codex/logout'), disabled: busy }, '退出') : null),
    (waiting || needManualCallback) ? h('div', { className: 'ab-note' },
      h('div', null, waiting
        ? (waiting.needPaste ? '1455 收不到回调：' : '') + '在浏览器完成登录后，把地址栏里的完整回调地址粘到下面。'
        : '先在浏览器完成登录，再把地址栏里的完整回调地址粘到下面；点上面的登录按钮会生成并打开授权链接。'),
      waiting?.url
        ? h('a', { href: waiting.url, target: '_blank', rel: 'noreferrer', style: { display: 'block', wordBreak: 'break-all' } }, '打开 ChatGPT 授权页')
        : null,
      h('input', { className: 'ab-input', value: input, type: 'password', autoComplete: 'off', placeholder: waiting ? '粘贴完整回调地址' : '完成浏览器登录后再粘贴', onChange: (e) => setInput(e.target.value) }),
      h(Btn, { small: true, onClick: act('/image/codex/complete', { input }), disabled: busy || !waiting || !input.trim() }, '完成登录'),
      waiting ? h(Btn, { small: true, onClick: act('/image/codex/cancel'), disabled: busy }, '取消登录') : null) : null,
    // 预设只是提示，模型名允许自己填（#256）：新模型出现时不用改源码。
    h(Row, { label: '模型', hint: '常用：gpt-image-2 / gpt-image-2.5-flare / gpt-image-2.5-sunburst；也可直接填服务端支持的自定义模型名' },
      h('input', { className: 'ab-input', style: { width: 260 }, value: draft.imageGen?.codex?.model ?? '', onChange: (e) => setDraft(setPath(draft, 'imageGen.codex.model', e.target.value)) })),
    h(Row, { label: '质量', hint: '所选模型需支持该选项' }, f.select('imageGen.codex.quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })), { width: 180 })),
    h(Row, { label: '背景' }, f.select('imageGen.codex.background', ['auto', 'opaque', 'transparent'].map((value) => ({ value, label: value })), { width: 180 })),
    h('div', { className: 'ab-muted ab-small' }, '订阅接法通过构图提示引导，实际尺寸由服务端选择。'),
  )
}


export { PaintGallery, PaintCell, CodexSub }

