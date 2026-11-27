import { useState, Fragment } from '../../core/ui/react.ts'
import { API, get, post } from '../../core/api/api.ts'
import { Btn, Card, Row, cx, h, useField } from '../../core/ui/ui.ts'

/** 已有 OneBot v11 机器人的地址和令牌。 */

function OneBotFields({ draft, f }) {
  return h(Fragment, null,
    h(Row, { label: 'WebSocket 地址', hint: '正向 WebSocket（OneBot v11），收消息靠它，必填。DSH 在 Docker 里的话，要填 DSH 容器能访问到的地址' }, f.text('ext.adapter-qq-onebot-v11.wsUrl', { size: 'wide', placeholder: 'ws://127.0.0.1:3001' })),
    h(Row, { label: 'WebSocket 令牌', hint: '对方设了 access_token 就填，没设留空' }, f.text('ext.adapter-qq-onebot-v11.wsToken', { type: 'password', placeholder: '没有就留空' })),
    h(Row, { label: 'HTTP 地址', hint: '可选。填了就用 HTTP 调接口，不填就都走 WebSocket' }, f.text('ext.adapter-qq-onebot-v11.httpUrl', { size: 'wide', placeholder: 'http://127.0.0.1:3000' })),
    h(Row, { label: 'HTTP 令牌' }, f.text('ext.adapter-qq-onebot-v11.httpToken', { type: 'password', placeholder: '没有就留空' })))
}

function Connect({ st, draft, setDraft, toast, reload }) {
  const f = useField(draft, setDraft)
  const [moveTo, setMoveTo] = useState('')
  // 远端桌宠直连：对外地址的本地编辑态（null = 跟着服务端当前值显示）
  const [pubBase, setPubBase] = useState(null)
  const conn = st.onebot.state === 'connected'
  const login = st.onebot.login
  const testBtns = h('div', { className: 'ab-flex', style: { marginTop: 8 } },
    h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接'),
    h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '重新连接'))
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '接上 QQ（OneBot v11）', desc: '让你的 OneBot 服务（NapCat / LLOneBot / Lagrange / Docker 里的实现等）登录机器人号 ' + (draft.ext?.['adapter-qq-onebot-v11']?.selfId || '') + '，把它的正向 WebSocket 地址填在这里，保存后插件就会去连。插件只连接，不会启动或注入任何东西；连上后会先核对登录的是不是机器人号，不是就断开。',
      right: h('a', { className: 'ab-small', href: 'https://github.com/aureth-labs/dsh-aurabot-qq-v2', target: '_blank', rel: 'noreferrer' }, '接入文档 ↗') },
      h(OneBotFields, { draft, f }),
      h(Row, { label: '机器人 QQ 号' }, f.text('ext.adapter-qq-onebot-v11.selfId')),
      testBtns),
    h(Card, { title: 'QQ 会话放在哪', desc: '每个 QQ 私聊 / 群都是 DSH 里「Aurabot · QQ」工作区下的一个会话，ta在会话里读写文件也在这个文件夹。改了以后新开的会话放到新位置；已有的会话还在原来的地方，想全部挪过去就在「概览」点「重新开始所有 QQ 会话」。' },
      h(Row, { label: '工作区文件夹', hint: '填完整路径（比如 D:\\Aurabot\\qq-chats）；留空 = 默认位置' }, f.text('workspaceDir', { size: 'wide', placeholder: st.workspaceDir || '' })),
      h('div', { className: 'ab-muted ab-small' }, '现在用的：' + (st.workspaceDir || '—') + (st.workspaceReal && st.workspaceReal !== st.workspaceDir ? '（文件实际在 ' + st.workspaceReal + '）' : '')),
      h(Row, { label: '把现有文件搬过去', hint: '填一个空文件夹的完整路径。已有会话照常接着聊，原路径留一个联接指过去；聊天记录和记忆在用户目录的 .dsh 里，不跟着搬。她正在跑命令时搬不了' },
        h('div', { className: 'ab-flex' },
          h('input', { className: 'ab-input', value: moveTo, placeholder: 'D:\\Aurabot\\qq-chats', onChange: (e) => setMoveTo(e.target.value) }),
          h(Btn, { small: true, disabled: !moveTo.trim(), onClick: async () => {
            const r = await post('/workspace/move', { to: moveTo.trim() })
            toast(r.message, r.ok ? 'ok' : 'err')
            if (r.ok) { setMoveTo(''); reload() }
          } }, '搬过去')))),
    h(Card, { title: '连接状态' },
      h('div', { className: 'ab-kv' },
        h('span', null, 'QQ 网关'), h('span', null, h('span', { className: 'ab-flex' }, h('i', { className: cx('ab-dot', conn ? 'ok' : st.onebot.state === 'connecting' ? 'warn' : 'err') }), { connected: '已连上', connecting: '连接中', disconnected: '断开了，正在重连', stopped: '没启动（总开关关着）', unconfigured: '还没配置' }[st.onebot.state] || st.onebot.state)),
        h('span', null, '登录的号'), h('span', null, login ? login.nickname + '（' + login.uin + '）' + (login.uin !== draft.ext?.['adapter-qq-onebot-v11']?.selfId ? ' ⚠ 不是机器人号！' : '') : '—'),
        h('span', null, 'HTTP'), h('span', null, st.onebot.endpoint.httpUrl || '—'),
        h('span', null, 'WebSocket'), h('span', null, st.onebot.endpoint.wsUrl || '—'),
      ),
      !conn && st.onebot.problem ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, st.onebot.problem) : null,
      h('div', { className: 'ab-flex', style: { marginTop: 10 } }, h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '重新连接')),
    ),
    // 远端桌宠直连（2026-11-02）：插件跑在服务器（无桌面）时，桌宠在你自己电脑上运行、直连这里。
    (() => {
      const savedPubBase = ((st.config && st.config.ext && st.config.ext.pet) || {}).publicBaseUrl || ''
      const curPubBase = pubBase == null ? savedPubBase : pubBase
      return h(Card, { title: '远端桌宠直连（可选）', desc: '插件跑在服务器（无桌面）上时，桌宠可以在你自己的电脑上运行、直连这里的插件。填插件对外的完整地址（含 https://，通常是反代域名），点「验证并保存」——插件会请求该地址下自己的一个只读接口，回 200 才算通。保存后「桌宠」页会出现「下载客户端包」，服务器上的 Electron 安装/启动按钮自动隐藏。留空并保存 = 回到同机模式。⚠ 跨机必须用 https：明文 http 的跨机访问会被直接阻断（安全只靠桌宠令牌一道闸）。' },
        h(Row, { label: '插件对外地址', hint: savedPubBase ? '当前已配置：' + savedPubBase + '。清空并保存 = 关闭远端直连' : '留空 = 同机模式（桌宠和插件在同一台电脑，不用动这里）' },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', style: { width: 'min(320px, 100%)' }, placeholder: 'https://bot.example.com', value: curPubBase, onChange: (e) => setPubBase(e.target.value) }),
            h(Btn, { small: true, disabled: !String(curPubBase).trim(), onClick: async () => {
              const r = await post('/panel/pet/public-base', { publicBaseUrl: String(curPubBase).trim() })
              toast(r.message || (r.ok ? '已保存' : '没成功'), r.ok ? 'ok' : 'err')
              if (r.ok) { setPubBase(null); reload() }
            } }, '验证并保存'),
            h(Btn, { small: true, kind: 'ghost', disabled: !String(curPubBase).trim(), title: '服务器自己打不通自己的公网地址（hairpin NAT）时用：不验证直接保存', onClick: async () => {
              const addr = String(curPubBase).trim()
              if (!window.confirm(`确定跳过验证保存「${addr}」吗？\n\n若该地址指向本机/内网（局域网自测），保存会记入审计日志；公网部署请务必用 https 公网域名。`)) return
              const r = await post('/panel/pet/public-base', { publicBaseUrl: addr, force: true, confirm: true })
              toast(r.message || (r.ok ? '已保存' : '没成功'), r.ok ? 'ok' : 'err')
              if (r.ok) { setPubBase(null); reload() }
            } }, '跳过验证保存'),
            savedPubBase ? h(Btn, { small: true, kind: 'ghost', onClick: async () => {
              const r = await post('/panel/pet/public-base', { publicBaseUrl: '' })
              toast(r.message || (r.ok ? '已清空' : '没成功'), r.ok ? 'ok' : 'err')
              if (r.ok) { setPubBase(null); reload() }
            } }, '关闭远端直连') : null)))
    })(),
  )
}

/** 选一张图片当头像（最多 5MB）。 */

async function pickAvatar(toast, reload) {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = 'image/png,image/jpeg,image/gif,image/webp'
  const file: any = await new Promise((res) => { inp.onchange = () => res(inp.files && inp.files[0]); inp.click() })
  if (!file) return
  if (file.size > 5 * 1024 * 1024) return toast('图片太大了，最多 5MB', 'err')
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file) })
  const r = await post('/avatar/upload', { data })
  toast(r.message, r.ok ? 'ok' : 'err')
  reload()
}

const avatarSrc = (st) => API + '/avatar?v=' + ((st.avatar && st.avatar.at) || 0)

function AvatarCard({ st, toast, reload }) {
  const custom = st.avatar && st.avatar.custom
  return h('div', { className: 'ab-card', style: { marginTop: 12, padding: 14 } },
    h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 12 } },
      h('img', { src: avatarSrc(st), alt: '头像', style: { width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', objectPosition: '50% 18%', border: '2px solid var(--ab-line)' } }),
      h('div', null, h('b', null, '头像'), h('div', { className: 'ab-muted ab-small' }, custom ? '用的是你上传的图片' : '默认的大肥鱼'))),
    h('div', { className: 'ab-flex', style: { marginTop: 10, flexWrap: 'wrap' } },
      h(Btn, { small: true, kind: 'primary', onClick: () => pickAvatar(toast, reload) }, '换一张'),
      custom ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/avatar/reset'); toast(r.message, 'ok'); reload() } }, '恢复默认') : null,
      h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('把这张图设成机器人号的 QQ 头像？')) return; const r = await post('/avatar/sync-qq'); toast(r.message, r.ok ? 'ok' : 'err') } }, '同步成 QQ 头像')),
    h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '这是面板里显示的头像；点「同步成 QQ 头像」才会改机器人号在 QQ 上的头像。'))
}

export { OneBotFields, Connect, pickAvatar, avatarSrc, AvatarCard }
