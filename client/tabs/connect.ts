import { useState, useEffect, Fragment } from '../core/react.ts'
import { API, get, post } from '../core/api.ts'
import { copy, setPath, timeAgo } from '../core/format.ts'
import { Btn, Card, Choices, Row, cx, h, useField } from '../core/ui.ts'

function SnowLumaAuth({ running, toast, onChange }) {
  const [s, setS] = useState(null)
  const load = () => get('/snowluma/login-check').then(setS)
  useEffect(() => { if (running) load() }, [running])
  if (!running) return h('span', { className: 'ab-muted ab-small' }, '启动后插件会自动管理控制台密码，你不用设置。')
  if (!s) return h('span', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 检查中…')
  if (s.ok) return h(PasswordPeek, { toast, auto: s.passwordAuto })
  return h('div', null,
    h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, '插件登不上 SnowLuma 控制台：' + (s.message || '') + '。多半是之前手动设过密码。'),
    h('div', { style: { marginTop: 6 } }, h(Btn, { small: true, kind: 'primary', onClick: async () => {
      if (!confirm('会先停掉 SnowLuma、清掉它的旧控制台密码，再用插件生成的新密码重新启动。机器人号需要稍后重新接入。继续吗？')) return
      const r = await post('/snowluma/reset-password'); toast(r.message); load(); onChange && onChange()
    } }, '重置为自动密码')))
}

/** 控制台密码：插件登得上时显示状态，能看一眼、复制（打开 SnowLuma 自己的控制台要用）。 */

function PasswordPeek({ toast, auto }) {
  const [pw, setPw] = useState('')
  const peek = async () => { const r = await get('/snowluma/password'); setPw(r.password || '（还没有）') }
  return h('div', { className: 'ab-flex' },
    h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, auto ? '✓ 控制台密码由插件自动管理' : '✓ 用的是你设的控制台密码'),
    pw ? h('code', { className: 'ab-small' }, pw) : null,
    h(Btn, { small: true, kind: 'ghost', onClick: () => (pw ? setPw('') : peek()) }, pw ? '隐藏' : '显示密码'),
    h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await get('/snowluma/password'); copy(r.password || '', toast, '密码复制好了，打开 SnowLuma 控制台时粘贴') } }, '复制密码'))
}

/** 在面板里阅读并同意 SnowLuma 的用户协议和隐私说明（必须由用户本人勾选、点击）。 */

function Agreement({ running, toast, onChange }) {
  const [a, setA] = useState(null)
  const [tab, setTab] = useState(0)
  const [agree, setAgree] = useState(false)
  const load = () => get('/snowluma/agreements').then(setA)
  useEffect(() => { if (running) load() }, [running])
  if (!running) return h('span', { className: 'ab-muted ab-small' }, '先启动 SnowLuma。')
  if (!a) return h('span', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 读取协议…')
  if (!a.ok) return h('span', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, '读不到协议：' + a.message)
  if (!a.consentRequired) return h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '✓ 已同意 SnowLuma 的用户协议和隐私说明（版本 ' + a.version + '）')
  const doc = a.documents[tab] || a.documents[0]
  return h('div', { style: { width: '100%' } },
    h('div', { className: 'ab-seg', style: { marginBottom: 8 } }, a.documents.map((d, i) => h('button', { key: d.id, type: 'button', className: i === tab ? 'on' : '', onClick: () => setTab(i) }, d.title.split('/')[0].trim()))),
    doc ? h('div', { className: 'ab-logs', style: { maxHeight: 260, padding: '12px 14px', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' } }, doc.text) : null,
    h('label', { className: 'ab-flex', style: { marginTop: 10, cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: agree, onChange: (e) => setAgree(e.target.checked), style: { accentColor: 'var(--ab-sea)', width: 16, height: 16 } }),
      h('span', null, '我已阅读并同意以上 SnowLuma 用户协议和隐私说明')),
    h('div', { className: 'ab-flex', style: { marginTop: 8 } },
      h(Btn, { kind: 'primary', small: true, disabled: !agree, onClick: async () => { const r = await post('/snowluma/consent', { version: a.version, agree: true }); toast(r.ok ? '已同意' : r.message, r.ok ? 'ok' : 'err'); load(); onChange && onChange() } }, '同意'),
      h('span', { className: 'ab-muted ab-small' }, 'SnowLuma 是独立的第三方项目，仅限个人非商业使用；使用非官方 QQ 工具有账号风险，请用小号。')))
}

/** 用什么接 QQ：插件帮你管 SnowLuma，或接你已有的 OneBot v11 机器人。 */

function GatewayChoice({ draft, setDraft }) {
  return h(Choices, { value: draft.gateway || 'snowluma', onChange: (v) => setDraft(setPath(draft, 'gateway', v)), options: [
    { value: 'snowluma', label: '用 SnowLuma（Windows，推荐）', desc: '插件帮你启动、接入机器人号、断线重连' },
    { value: 'onebot', label: '接我已有的 OneBot 机器人', desc: 'NapCat、LLOneBot、Lagrange、Docker 里的 SnowLuma 等任何 OneBot v11 实现；Linux / Docker 部署选这个' },
  ] })
}

/** 已有 OneBot 机器人的地址和令牌。 */

function OneBotFields({ draft, f }) {
  return h(Fragment, null,
    h(Row, { label: 'WebSocket 地址', hint: '正向 WebSocket（OneBot v11），收消息靠它，必填。DSH 在 Docker 里的话，要填 DSH 容器能访问到的地址' }, f.text('snowluma.wsUrl', { size: 'wide', placeholder: 'ws://127.0.0.1:3001' })),
    h(Row, { label: 'WebSocket 令牌', hint: '对方设了 access_token 就填，没设留空' }, f.text('snowluma.wsToken', { type: 'password', placeholder: draft.snowluma.wsTokenSet ? '已保存' : '没有就留空' })),
    h(Row, { label: 'HTTP 地址', hint: '可选。填了就用 HTTP 调接口，不填就都走 WebSocket' }, f.text('snowluma.httpUrl', { size: 'wide', placeholder: 'http://127.0.0.1:3000' })),
    h(Row, { label: 'HTTP 令牌' }, f.text('snowluma.httpToken', { type: 'password', placeholder: draft.snowluma.httpTokenSet ? '已保存' : '没有就留空' })))
}

function Connect({ st, draft, setDraft, toast, reload, openWizard }) {
  const f = useField(draft, setDraft)
  const sl = st.snowluma
  const [procs, setProcs] = useState(null)
  const [otherProcs, setOtherProcs] = useState([])
  const [moveTo, setMoveTo] = useState('')
  // 远端桌宠直连：对外地址的本地编辑态（null = 跟着服务端当前值显示）
  const [pubBase, setPubBase] = useState(null)
  const conn = st.onebot.state === 'connected'
  const loadProcs = async () => { const r = await get('/snowluma/processes'); setProcs(r.list || []); setOtherProcs(r.others || []); if (!r.ok) toast(r.message) }
  const act = (p) => async () => { const r = await post(p); toast(r.message || (r.ok ? '好了' : '没成功')); reload() }
  const login = st.onebot.login
  const external = draft.gateway === 'onebot'
  const testBtns = h('div', { className: 'ab-flex', style: { marginTop: 8 } },
    h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接'),
    h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '重新连接'))
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '用什么接 QQ', right: openWizard ? h(Btn, { small: true, kind: 'ghost', onClick: openWizard }, '重新走一遍设置向导') : null }, h(GatewayChoice, { draft, setDraft })),
    external ? h(Card, { title: '接上 QQ（已有的 OneBot 机器人）', desc: '让你的 OneBot 服务登录机器人号 ' + (draft.botQQ || '') + '，把它的正向 WebSocket 地址填在这里，保存后插件就会去连。插件只连接，不会启动或注入任何东西；连上后会先核对登录的是不是机器人号，不是就断开。' },
      h(OneBotFields, { draft, f }),
      h(Row, { label: '机器人 QQ 号' }, f.text('botQQ')),
      testBtns) :
    h(Card, { title: '接上 QQ（SnowLuma）', desc: 'SnowLuma 是让机器人号上线的 QQ 网关。按协议规定它需要你自己下载、解压并同意它的用户协议；控制台密码、启动、接入、断线重连都交给 Aurabot。',
      },
      h('div', { className: 'ab-steps' },
        h('div', { className: cx('ab-step', sl.installed && 'done') }, h('div', null,
          h('b', null, '下载 SnowLuma'), h('div', { className: 'ab-muted ab-small' }, '打开官方发布页，下载 Windows 完整版（名字类似 SnowLuma-v2.x.x-win-x64.zip，不带 lite）。'),
          h('div', { style: { marginTop: 6 } }, h(Btn, { small: true, onClick: () => window.open(sl.downloadPage, '_blank') }, '打开下载页 ↗')))),
        h('div', { className: cx('ab-step', sl.installed && 'done') }, h('div', null,
          h('b', null, '解压到一个纯英文的目录'), h('div', { className: 'ab-muted ab-small' }, '推荐 C:\\Aurabot\\snowluma。解压后这个目录里应该直接能看到 index.mjs 和 node.exe。'),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } }, f.text('snowluma.dir', { size: 'wide', placeholder: 'C:\\Aurabot\\snowluma' })),
          !sl.installed && sl.reason ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', marginTop: 4 } }, sl.reason) : sl.installed ? h('div', { className: 'ab-small', style: { color: sl.compat && sl.compat.status !== 'ok' ? 'var(--ab-warn)' : 'var(--ab-ok)', marginTop: 4 } }, '找到了 SnowLuma v' + sl.version + (sl.compat ? '（' + sl.compat.label + '）' : '')) : null)),
        h('div', { className: cx('ab-step', sl.running && 'done') }, h('div', null,
          h('b', null, '启动'), h('div', { className: 'ab-muted ab-small' }, '后台运行，不弹窗口；以后会跟着 DSH 自动启动。'),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } },
            h(Btn, { small: true, kind: 'primary', disabled: !sl.installed || sl.running, onClick: act('/snowluma/start') }, sl.running ? '已在运行' : '启动'),
            sl.owns ? h(Btn, { small: true, kind: 'danger', onClick: act('/snowluma/stop') }, '停止') : null),
          h('div', { style: { marginTop: 6 } }, h(SnowLumaAuth, { running: sl.running, toast, onChange: reload })))),
        h('div', { className: cx('ab-step', sl.consented && 'done') }, h('div', null,
          h('b', null, '阅读并同意 SnowLuma 的用户协议'), h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } }, '同意之前 SnowLuma 不会工作。'),
          h(Agreement, { running: sl.running, toast, onChange: reload }))),
        h('div', { className: cx('ab-step', conn && login && login.uin === draft.botQQ && 'done') }, h('div', null,
          h('b', null, '登录机器人号并接入'), h('div', { className: 'ab-muted ab-small' }, '在电脑上另开一个 QQ 登录机器人号 ' + draft.botQQ + '（可以最小化），然后点「接入机器人号」。QQ 必须是 NT 版 9.9.33 及以上（SnowLuma 2.4 的要求）；旧版 QQ 注入不了，先升级 QQ。'),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } },
            h(Btn, { small: true, kind: 'primary', disabled: !sl.running, onClick: act('/snowluma/attach') }, '接入机器人号'),
            h(Btn, { small: true, disabled: !sl.running, onClick: loadProcs }, '看看有哪些 QQ 进程'),
            h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接')),
          sl.lastAttach && sl.lastAttach.at ? h('div', { className: 'ab-small', style: { marginTop: 4, color: sl.lastAttach.ok ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, timeAgo(sl.lastAttach.at) + '：' + sl.lastAttach.message) : null)),
      ),
      sl.installed && sl.compat && sl.compat.status !== 'ok' ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } },
        h('b', null, 'SnowLuma 版本提示：'), sl.compat.message, ' ',
        h('a', { href: sl.downloadPage, target: '_blank', rel: 'noreferrer' }, '打开下载页 ↗')) : null,
      procs ? h('div', { style: { marginTop: 14 } }, procs.length === 0 ? h('div', { className: 'ab-muted' }, '没找到 QQ 进程。') :
        h('table', { className: 'ab-table' }, h('thead', null, h('tr', null, ['进程', '登录的号', '昵称', 'QQ 版本', '状态', ''].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, procs.map((p) => h('tr', { key: p.pid },
            h('td', null, p.pid), h('td', null, p.uin || '识别不出'), h('td', null, p.nickname || '—'),
            h('td', { style: (p.nt === false || p.tooOld) ? { color: 'var(--ab-warn)' } : null }, (p.qqVersion || '—') + (p.nt === false ? '（非 NT）' : p.tooOld ? '（低于 9.9.33）' : '')),
            h('td', null, p.injected ? (p.connected ? '已接入' : '已注入，连接中') : '未接入'),
            h('td', null, p.isBot ? h('span', { className: 'ab-badge' }, '机器人号') : h('span', { className: 'ab-muted ab-small' }, '不会碰')))))),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '注：SnowLuma 2.4 只能注入 QQ NT 9.9.33 及以上；低于这个版本的 NT 会卡在「等待登录」，老版 QQ 则根本不会出现在这里。'),
        otherProcs.length ? h('div', { className: 'ab-note warn', style: { marginTop: 8 } }, '另外看到 ' + otherProcs.length + ' 个老版 QQ（' + otherProcs.map((p) => (p.qqVersion || '版本未知') + '，pid ' + p.pid).join('；') + '）：SnowLuma 接不了，别用它登录机器人号。') : null) : null,
    ),
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
        h('span', null, '登录的号'), h('span', null, login ? login.nickname + '（' + login.uin + '）' + (login.uin !== draft.botQQ ? ' ⚠ 不是机器人号！' : '') : '—'),
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
              // 【复审 2·P1-3】内网/本机地址需要 force + confirm 显式二次确认（后端审计要求）。
              // 公网地址不用 confirm（后端只对内网地址要它），但带上也无害——统一带，简单可靠。
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
    external ? null : h(Card, { title: '高级', desc: '一般不用动：地址和令牌会自动从 SnowLuma 的配置里读。' },
      h(Row, { label: '机器人 QQ 号' }, f.text('botQQ')),
      h(Row, { label: '控制台端口' }, f.num('snowluma.webuiPort', { min: 1, max: 65535 })),
      h(Row, { label: '控制台密码', hint: '默认由插件自动生成，上面「显示密码」能看到。想自己定一个就填在这里，保存后会真的改到 SnowLuma 上（至少 10 位，要有大小写字母和符号，不能有空格）' }, f.text('snowluma.webuiPassword', { type: 'password', placeholder: draft.snowluma.webuiPasswordSet ? (draft.snowluma.passwordAuto ? '自动管理中（不改就留空）' : '已保存（不改就留空）') : '留空 = 自动' })),
      h(Row, { label: 'SnowLuma 自己的控制台', hint: '一般用不到，想看它的原始界面时用' }, h(Btn, { small: true, disabled: !sl.running, onClick: () => window.open(sl.webui, '_blank') }, '打开 ↗')),
      h(Row, { label: '随 DSH 自动启动 SnowLuma' }, f.sw('snowluma.autoStart')),
      h(Row, { label: '自动接入机器人号', hint: '断线后自动重新接入，只接机器人号。' }, f.sw('snowluma.autoAttach')),
      h(Row, { label: '手动 HTTP 地址', hint: '留空 = 自动' }, f.text('snowluma.httpUrl', { placeholder: 'http://127.0.0.1:3000' })),
      h(Row, { label: '手动 WS 地址', hint: '留空 = 自动' }, f.text('snowluma.wsUrl', { placeholder: 'ws://127.0.0.1:3001' })),
      h(Row, { label: '手动 HTTP 令牌' }, f.text('snowluma.httpToken', { type: 'password', placeholder: draft.snowluma.httpTokenSet ? '已保存' : '留空 = 自动' })),
      h(Row, { label: '手动 WS 令牌' }, f.text('snowluma.wsToken', { type: 'password', placeholder: draft.snowluma.wsTokenSet ? '已保存' : '留空 = 自动' })),
    ),
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

export { SnowLumaAuth, PasswordPeek, Agreement, GatewayChoice, OneBotFields, Connect, pickAvatar, avatarSrc, AvatarCard }
