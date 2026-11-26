import { useState, useEffect, useRef, useCallback, Fragment } from '../core/react.ts'
import { API, get, post } from '../core/api.ts'
import { fmtBytes, fmtDur, setPath, timeAgo } from '../core/format.ts'
import { LogLine } from '../core/log-line.ts'
import { Btn, Card, Empty, Row, Seg, Select, Switch, cx, h, useField } from '../core/ui.ts'
import { VoiceImport } from './memory.ts'

function RootPicker({ draft, setDraft, s }) {
  const val = draft.song.root || ''
  const cur = val || s.defaultRoot
  const [drives, setDrives] = useState([])
  const [chk, setChk] = useState(null)
  useEffect(() => { get('/song/drives').then((r) => setDrives(r.list || [])) }, [])
  useEffect(() => {
    const t = setTimeout(() => get('/song/root/check?path=' + encodeURIComponent(cur)).then(setChk), 300)
    return () => clearTimeout(t)
  }, [cur])
  const pick = (root) => setDraft(setPath(draft, 'song.root', root === s.defaultRoot ? '' : root))
  return h('div', { style: { width: '100%' } },
    h('div', { className: 'ab-drives' },
      h('button', { type: 'button', className: cx('ab-drive', !val && 'on'), onClick: () => pick(s.defaultRoot) }, h('b', null, '默认位置'), h('small', null, s.defaultRoot)),
      drives.map((d) => h('button', { key: d.drive, type: 'button', className: cx('ab-drive', val.toLowerCase() === d.root.toLowerCase() && 'on', d.freeGB < 10 && 'low'), onClick: () => pick(d.root) },
        h('b', null, d.drive + ' 盘'), h('small', null, '剩 ' + d.freeGB + ' GB / 共 ' + Math.round(d.totalGB) + ' GB'),
        h('span', { className: 'bar' }, h('i', { style: { width: Math.round((1 - d.freeGB / d.totalGB) * 100) + '%' } }))))),
    h('input', { className: 'ab-input wide', style: { marginTop: 8 }, value: val, placeholder: '或者自己填路径，留空 = 默认位置（' + s.defaultRoot + '）', onChange: (e) => setDraft(setPath(draft, 'song.root', e.target.value)) }),
    chk ? h('div', { className: 'ab-small', style: { marginTop: 4, color: !chk.ok || chk.warn ? 'var(--ab-warn)' : 'var(--ab-sub)' } },
      !chk.ok ? chk.message : ['装在 ' + cur, chk.freeGB !== null ? '这个盘还剩 ' + chk.freeGB + ' GB' : '', chk.warn].filter(Boolean).join('；')) : null,
    val && val !== s.root && s.voices.length ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '换位置后，已导入的音色要重新导入（或把原来的 models 文件夹搬过去）') : null)
}

/** 安装进度：步骤条 + 当前这一步的用时、预计、下载量和网速，一看就知道没卡住。 */

function InstallProgress({ inst }) {
  const pr = inst.progress
  const now = Date.now()
  const steps = inst.steps || []
  return h('div', { className: 'ab-install' },
    h('div', { className: 'ab-install-steps' }, steps.map((name, i) => h('div', { key: i, className: cx('st', i < inst.stepIndex && 'done', i === inst.stepIndex && 'on'), title: name },
      h('i', null, i < inst.stepIndex ? '✓' : i + 1), h('span', null, name.replace(/（.*?）/g, ''))))),
    h('div', { className: 'ab-flex', style: { marginTop: 12 } }, h('i', { className: 'ab-spin' }), h('b', null, '第 ' + (inst.stepIndex + 1) + ' / ' + steps.length + ' 步：' + inst.step), h('div', { className: 'ab-spacer' }),
      h('span', { className: 'ab-muted ab-small' }, '这一步 ' + fmtDur(now - inst.stepAt) + ' · 总共 ' + fmtDur(now - inst.startedAt))),
    inst.stepHint ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '预计：' + inst.stepHint) : null,
    pr && pr.kind === 'download' ? h('div', { className: 'ab-install-dl' },
      h('div', null, h('small', null, '已下载'), h('b', null, fmtBytes(pr.done))),
      h('div', null, h('small', null, '当前网速'), h('b', { style: { color: pr.speed < 20 * 1024 ? 'var(--ab-warn)' : undefined } }, fmtBytes(pr.speed) + '/s')),
      pr.speed < 20 * 1024 ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', flex: '1 1 220px' } }, '很慢的话：打开「用国内镜像下载」后重新点安装（已下好的不会重下），或者开着代理') : null) : null,
    pr && pr.kind === 'file' && pr.total ? h('div', { style: { marginTop: 10 } },
      h('div', { className: 'ab-flex ab-small' }, h('span', null, pr.name), h('div', { className: 'ab-spacer' }), h('span', null, fmtBytes(pr.done) + ' / ' + fmtBytes(pr.total) + '（' + Math.round((pr.done / pr.total) * 100) + '%）')),
      h('div', { className: 'ab-mood', style: { marginTop: 4 } }, h('i', { style: { width: Math.round((pr.done / pr.total) * 100) + '%' } }))) : null)
}

const SONG_PARTS = [['python', 'Python 环境'], ['applio', 'Applio（RVC 推理引擎）'], ['separator', '人声分离'], ['ffmpeg', 'ffmpeg（混音）'], ['weights', '预训练文件（音高、音色特征）'], ['separatorModel', '人声分离模型']]

function Song({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(st.song)
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [pitch, setPitch] = useState(st.config.song.pitch || 0)
  const [startSec, setStartSec] = useState('')
  const [durationSec, setDurationSec] = useState('')
  const [acct, setAcct] = useState(null)
  const load = () => get('/song/status').then((r) => r.ok && setS(r))
  // 安装中 / 正在唱的时候每 3 秒刷新一次进度
  useEffect(() => {
    load()
    const busy = s && (s.install.running || s.current || s.queue.length)
    if (!busy) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [s && s.install.running, s && Boolean(s.current), s && s.queue.length])
  if (!s) return h(Empty, { icon: '⏳', text: '加载中…' })
  const search = async () => { if (!q.trim()) return; setFound(null); const r = await get('/song/search?q=' + encodeURIComponent(q)); setFound(r.list || []); if (!r.ok) toast(r.message, 'err') }
  const validSegment = (startSec === '' || (Number.isSafeInteger(Number(startSec)) && Number(startSec) >= 0 && Number(startSec) <= 86400))
    && (durationSec === '' || (Number.isSafeInteger(Number(durationSec)) && Number(durationSec) > 0 && Number(durationSec) <= st.config.song.maxVoiceSec))
  const sing = async (song) => { if (!validSegment) return; const r = await post('/song/request', { songId: song.id, song: song.name, pitch, ...(startSec !== '' ? { startSec: Number(startSec) } : {}), ...(durationSec !== '' ? { durationSec: Number(durationSec) } : {}) }); toast(r.message, r.ok ? 'ok' : 'err'); load() }
  const voices = s.voices.map((v) => ({ value: v.id, label: v.id, desc: v.hasIndex ? '带 .index' : '' }))
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '翻唱', right: f.sw('song.enabled'), desc: '让ta用自己的声音唱歌：点歌 → 从网易云下载 → 分离人声和伴奏 → 用 RVC 换成ta的声音 → 混音 → 发语音条。主人在 QQ 里说「唱首歌」，或者发 /sing 歌名 都行。' },
      h('div', { className: cx('ab-note', s.ready ? '' : 'warn') }, s.message),
      h('div', { className: 'ab-checks', style: { marginTop: 12 } },
        SONG_PARTS.map(([k, label]) => h('div', { key: k, className: cx('ab-check', s.parts[k] && 'done') }, h('i', null, s.parts[k] ? '✓' : '·'), label)),
        h('div', { className: cx('ab-check', s.voices.length && 'done'), title: s.voices.map((v) => v.id).join('、') }, h('i', null, s.voices.length ? '✓' : '·'), s.voices.length ? '音色模型 ×' + s.voices.length : '音色模型（在下面导入）')),
      s.install.running ? null : h('div', { style: { marginTop: 12 } },
        h(Row, { label: '装到哪里', hint: '装完约 8 GB，音色模型也放这里。改了要先保存设置再点安装' }, h(RootPicker, { draft, setDraft, s })),
        h(Row, { label: '下载源', hint: '自动：安装前先测一下，官方源慢就用国内镜像（阿里云 / 南京大学 / npmmirror）' },
          h(Select, { value: draft.song.pypiMirror || 'auto', width: 220, onChange: (v) => setDraft(setPath(draft, 'song.pypiMirror', v)), options: [{ value: 'auto', label: '自动（推荐）' }, { value: 'cn', label: '一直用国内镜像' }, { value: 'off', label: '只用官方源' }] }))),
      h('div', { className: 'ab-flex', style: { marginTop: 12 } },
        h(Btn, { kind: 'primary', small: true, disabled: s.install.running || (draft.song.root || '') !== (st.config.song.root || ''), onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } },
          s.install.running ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在安装…') : Object.values(s.parts).every(Boolean) ? '重新检查 / 修复安装' : '一键安装'),
        h('span', { className: 'ab-muted ab-small' }, (draft.song.root || '') !== (st.config.song.root || '') ? '安装位置改了，先保存设置' : '需要 NVIDIA 显卡；装在 ' + s.root)),
      s.install.running ? h(InstallProgress, { inst: s.install }) : null,
      s.install.ok === true && !s.install.running ? h('div', { className: 'ab-note', style: { marginTop: 8 } }, '✓ ' + s.install.message) : null,
      s.install.log.length ? h('details', { style: { marginTop: 8 } }, h('summary', { className: 'ab-muted ab-small', style: { cursor: 'pointer' } }, '详细日志'),
        h('div', { className: 'ab-logs', style: { maxHeight: 180, marginTop: 6, padding: '8px 12px', whiteSpace: 'pre-wrap' } }, s.install.log.slice(-20).join('\n'))) : null,
      s.install.ok === false && !s.install.running ? h('div', { className: 'ab-note err', style: { marginTop: 8 } },
        h('div', null, s.install.message),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } }, '再试一次'),
          h(Btn, { small: true, onClick: () => { try { navigator.clipboard.writeText(['Aurabot ' + st.version + ' 翻唱安装失败', s.install.message, '', s.install.error || '', '', ...(s.install.log || []).slice(-30)].join('\n')); toast('报错复制好了，发给作者就行', 'ok') } catch (e) { toast('复制失败，展开「详细日志」手动复制吧', 'err') } } }, '复制报错'),
          h('span', { className: 'ab-muted ab-small' }, '已经下好的部分不会重下'))) : null,
    ),
    h(VoiceImport, { s, toast, onChange: load }),
    h(Card, { title: '声音', desc: '用哪个音色唱、默认变调和语音条的长度。' },
      h(Row, { label: '音色' }, voices.length ? h(Select, { value: draft.song.voice || (voices[0] && voices[0].value), options: voices, onChange: (v) => setDraft(setPath(draft, 'song.voice', v)) }) : h('span', { className: 'ab-muted' }, '还没有模型')),
      h(Row, { label: '自动定变调', hint: '没指定变调时，先听原唱人声是男声还是女声，再按下面的声线定 0 / +12 / -12（只升降整八度，不和伴奏跑调）' }, f.sw('song.autoPitch')),
      h(Row, { label: '她的声线', hint: '当前音色是女声还是男声，自动定变调按这个算' }, f.choices('song.selfVoice', [{ value: 'female', label: '女声' }, { value: 'male', label: '男声' }])),
      h(Row, { label: '默认变调', hint: '自动定变调关着、或者测不出原唱音高时用；面板试唱也按这个' }, f.range('song.pitch', -12, 12, 1, (v) => (v > 0 ? '+' : '') + v + ' 半音')),
      h(Row, { label: '语音条最长', hint: '歌比这个长就截一段' }, f.range('song.maxVoiceSec', 30, 300, 10, (v) => v + ' 秒')),
      h(Row, { label: '截哪一段' }, f.choices('song.clipStart', [{ value: 'auto', label: '副歌附近', desc: '自动分析音量和重复段找副歌入口（分析失败回退约 30%）' }, { value: 'head', label: '从头开始' }])),
      h(Row, { label: '人声音量' }, f.range('song.vocalVolume', 0.2, 2, 0.05, (v) => Math.round(v * 100) + '%')),
      h(Row, { label: '伴奏音量' }, f.range('song.instVolume', 0.1, 2, 0.05, (v) => Math.round(v * 100) + '%')),
      h(Row, { label: '限制点歌权限', hint: '开启时主人和权限页授权的私聊对象可以点歌。' }, f.sw('song.ownerOnly')),
    ),
    h(Card, { title: '网易云', desc: '不登录也能唱免费歌；会员歌、版权歌要填网易云的 Cookie。' },
      h(Row, { label: 'Cookie（MUSIC_U）', hint: '电脑浏览器登录 music.163.com → F12 → 应用 / 存储 → Cookie → 复制 MUSIC_U 的值。只存在本机，不显示' },
        f.text('song.neteaseCookie', { type: 'password', size: 'wide', placeholder: draft.song.neteaseCookieSet ? '已保存（不改就留空）' : '没有就留空' })),
      h('div', { className: 'ab-flex', style: { marginTop: 6 } },
        h(Btn, { small: true, onClick: async () => { const r = await get('/song/account'); setAcct(r) } }, '检查登录'),
        acct ? h('span', { className: 'ab-small', style: { color: acct.ok ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, acct.ok ? '已登录：' + acct.nickname + (acct.vip ? '（会员）' : '（不是会员，只能下免费歌）') : acct.message) : null),
    ),
    h(Card, { title: '试唱', desc: '搜一首歌让ta唱，做好会发到你的 QQ 私聊。' },
      h('div', { className: 'ab-flex' },
        h('input', { className: 'ab-input', style: { flex: '1 1 260px' }, placeholder: '歌名，可以带歌手：小幸运 田馥甄', value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => e.key === 'Enter' && search() }),
        h(Btn, { small: true, onClick: search, disabled: !q.trim() }, '搜索'),
        h('span', { className: 'ab-muted ab-small' }, '变调'),
        h('input', { className: 'ab-input sm', type: 'number', min: -24, max: 24, value: pitch, onChange: (e) => setPitch(Number(e.target.value) || 0) })),
      h(Row, { label: '这次唱哪一段', hint: `都留空沿用上方设置；只填时长就从头唱。本次最长 ${st.config.song.maxVoiceSec} 秒，改上限要先保存。` },
        h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 86400, step: 1, 'aria-label': '开始秒数', placeholder: '开始秒数', value: startSec, onChange: e => setStartSec(e.target.value) }),
        h('span', { className: 'ab-muted' }, '秒起，唱'),
        h('input', { className: 'ab-input sm', type: 'number', min: 1, max: st.config.song.maxVoiceSec, step: 1, 'aria-label': '片段时长', placeholder: '时长', value: durationSec, onChange: e => setDurationSec(e.target.value) }), h('span', { className: 'ab-muted' }, '秒')),
      !validSegment ? h('div', { className: 'ab-note warn', role: 'alert' }, '开始位置填非负整数；时长填正整数，不能超过已保存的最长时长。') : null,
      found === null ? null : found.length === 0 ? h('div', { className: 'ab-muted', style: { marginTop: 8 } }, '没搜到') :
        h('table', { className: 'ab-table', style: { marginTop: 10 } }, h('tbody', null, found.map((x) => h('tr', { key: x.id },
          h('td', null, x.name, x.vip ? h('span', { className: 'ab-badge', style: { marginLeft: 6 } }, '会员') : null),
          h('td', { className: 'ab-muted' }, x.artists),
          h('td', { className: 'ab-muted' }, Math.floor(x.durationSec / 60) + ':' + String(x.durationSec % 60).padStart(2, '0')),
          h('td', null, h(Btn, { small: true, kind: 'primary', disabled: !s.ready || !draft.song.enabled || !validSegment, onClick: () => sing(x) }, '唱给我听')))))),
      !draft.song.enabled ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '先打开上面的「翻唱」开关并保存。') : null,
      s.current ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, h('i', { className: 'ab-spin' }), ' 正在唱「' + s.current.title + '」：' + s.current.stage + (s.current.clip ? `（第 ${s.current.clip.startSec} 秒起，最多 ${s.current.clip.durationSec} 秒）` : '') + (s.queue.length ? '（后面还有 ' + s.queue.length + ' 首）' : '')) : null,
      s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
        h('div', { className: 'meta' }, timeAgo(x.at)),
        h('div', { className: 'body' }, (x.ok ? '✓ ' : '✗ ') + x.title + (x.voice ? ' · ' + x.voice + (x.pitch ? ' ' + (x.pitch > 0 ? '+' : '') + x.pitch : '') : ''), h('div', { className: 'ab-muted ab-small' }, (x.clip ? `第 ${x.clip.startSec} 秒起，最多 ${x.clip.durationSec} 秒 · ` : '') + x.message))))) : null,
    ),
  )
}

/** B 站 Cookie：SESSDATA 和 bili_jct 分两个框填（前缀已经写好），可以显示 / 隐藏；粘整串也行，会自动拆开。 */

function BiliCookie({ draft, setDraft, load }) {
  const [show, setShow] = useState(false)
  const [qr, setQr] = useState(null) // { id?, png?, state: 'loading'|'waiting'|'expired'|'error', message? }
  const qrTimer = useRef(null)
  const qrId = useRef('')
  const b = draft.bili
  const stopQr = () => { if (qrTimer.current) { clearInterval(qrTimer.current); qrTimer.current = null } }
  const cancelQr = (id) => { if (id) post('/bili/qr/cancel', { id }).catch(() => {}) }
  const closeQr = () => { const id = qrId.current; qrId.current = ''; stopQr(); setQr(null); cancelQr(id) }
  const pollQr = (id) => {
    stopQr()
    const tick = async () => {
      try {
        const r = await get('/bili/qr/status?id=' + encodeURIComponent(id))
        if (qrId.current !== id) return // 浮层已经关了，别再往旧会话上轮询
        if (r.state === 'done') {
          qrId.current = ''
          stopQr()
          setQr(null)
          if (load) load()
          return
        }
        if (r.state === 'expired' || r.state === 'error') {
          stopQr()
          setQr({ id, state: r.state, message: r.message || (r.state === 'expired' ? '二维码过期了' : '出错了，重试一下') })
        }
      } catch {}
    }
    tick()
    qrTimer.current = setInterval(tick, 1500)
  }
  const openQr = async () => {
    const old = qrId.current
    qrId.current = ''
    stopQr()
    cancelQr(old)
    setQr({ state: 'loading' })
    const r = await post('/bili/qr/start')
    if (!r || !r.id) { setQr({ state: 'error', message: (r && r.message) || '出码失败，重试一下' }); return }
    if (!r.png) { qrId.current = r.id; setQr({ id: r.id, state: 'error', message: r.message || '没出码，重试一下' }); return }
    qrId.current = r.id
    setQr({ id: r.id, png: r.png, state: 'waiting' })
    pollQr(r.id)
  }
  // 组件卸载时一定要清定时器并通知后端收浏览器
  useEffect(() => () => { const id = qrId.current; qrId.current = ''; if (qrTimer.current) clearInterval(qrTimer.current); cancelQr(id) }, [])
  const modal = !qr ? null : h('div', {
    style: { position: 'fixed', inset: 0, background: 'rgba(12,28,38,.45)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    onClick: closeQr,
  }, h('div', {
    style: { background: '#fff', borderRadius: 12, padding: '20px 24px', width: 300, textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,.25)' },
    onClick: (e) => e.stopPropagation(),
  },
    h('div', { style: { fontWeight: 600, marginBottom: 10 } }, '扫码登录 B 站'),
    qr.png ? h('img', { src: 'data:image/png;base64,' + qr.png, width: 200, height: 200, alt: '二维码', style: { display: 'block', margin: '0 auto', borderRadius: 6 } }) : null,
    h('div', { className: 'ab-muted ab-small', style: { marginTop: 10 } },
      qr.state === 'loading' ? '正在出码…' : qr.state === 'waiting' ? '等你扫码…' : qr.state === 'expired' ? '二维码过期了' : (qr.message || '出错了')),
    qr.state === 'waiting' ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '用手机 B 站 App 扫这个码，扫完在手机上点确认。票只存在这台服务器上，跟你自己浏览器登录的那个号互不影响。') : null,
    h('div', { className: 'ab-flex', style: { justifyContent: 'center', marginTop: 12 } },
      qr.state === 'expired' || qr.state === 'error' ? h(Btn, { small: true, kind: 'primary', onClick: openQr }, '重新生成') : null,
      h(Btn, { small: true, kind: 'ghost', onClick: closeQr }, '取消'))))
  const field = (key, prefix, setKey, hintKey, ph) => h('div', { className: 'ab-flex', style: { flexWrap: 'nowrap', marginBottom: 6 } },
    h('code', { className: 'ab-small', style: { minWidth: 82, textAlign: 'right' } }, prefix),
    h('input', {
      className: 'ab-input wide', type: show ? 'text' : 'password', autoComplete: 'off', spellCheck: false, value: b[key] || '',
      placeholder: b[setKey] ? '已保存（结尾 ' + (b[hintKey] || '…') + '），不改就留空' : ph,
      onChange: (e) => setDraft(setPath(draft, 'bili.' + key, e.target.value.trim())),
    }))
  return h(Row, { label: 'B 站 Cookie', hint: '电脑浏览器登录 bilibili.com → F12 → 「应用」（Application）→ Cookie → bilibili.com，分别复制 SESSDATA 和 bili_jct 这两行的「值」。也可以直接粘整串 Cookie，会自动拆开。只存在本机；不填也能看视频，但看不到 AI 字幕、不能评论和回复。建议用小号' },
    h('div', { style: { flex: 1 } },
      field('sessdata', 'SESSDATA=', 'sessdataSet', 'sessdataHint', '粘贴 SESSDATA 的值'),
      field('biliJct', 'bili_jct=', 'biliJctSet', 'biliJctHint', '粘贴 bili_jct 的值'),
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, onClick: () => setShow(!show) }, show ? '隐藏' : '显示'),
        h(Btn, { small: true, kind: 'primary', onClick: openQr }, '扫码登录'),
        b.sessdataSet || b.biliJctSet ? h(Btn, { small: true, kind: 'ghost', onClick: () => { if (confirm('清空保存的 B 站 Cookie？')) setDraft(setPath(setPath(setPath(draft, 'bili.sessdata', null), 'bili.biliJct', null), 'bili.cookie', null)) } }, '清空') : null,
        h('span', { className: 'ab-muted ab-small' }, '「显示」看的是正在填的内容；保存过的出于安全不回传，只显示结尾几位')),
      modal))
}

/** 本地接口：数据目录 local/ 里的脚本接管语音合成、生图、翻唱换声、语音识别。 */

function LocalApi({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState('')
  const [img, setImg] = useState('')
  const load = () => get('/local/status').then(setSt)
  useEffect(() => { load() }, [])
  const act = async (path, slot, label) => { setBusy(slot + label); const r = await post(path, { slot }); setBusy(''); toast(r.message, r.ok ? 'ok' : 'err'); if (r.image) setImg(r.image); load() }
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '本地接口', desc: '想用自己电脑上的模型或服务（GPT-SoVITS 语音、SD WebUI / ComfyUI 画图、自己训练的 so-vits-svc 音色、本地语音识别……）？在这里生成一个脚本模板，照注释改，或者点「复制给 DSH 的话」粘给 DSH，让它帮你改。脚本放在插件数据目录的 local 文件夹里，插件升级不会覆盖；改完保存就生效，不用重启。每一项要打开开关才会用，出错时语音和识别会自动退回内置方式。' },
      h('div', { className: 'ab-flex' },
        h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, st ? st.dir : '…'),
        h(Btn, { small: true, onClick: () => post('/local/open').then((r) => toast(r.message)) }, '打开文件夹'))),
    !st ? h(Empty, { icon: '⏳', text: '加载中…' }) : st.list.map((x) => h(Card, { key: x.slot, title: x.title + '（' + x.file + '）', right: f.sw('local.' + x.slot) },
      h('div', { className: 'ab-flex', style: { marginBottom: 8 } },
        h('span', { className: 'ab-small', style: { color: x.active ? 'var(--ab-ok)' : 'var(--ab-muted)' } },
          x.active ? '● 正在由本地脚本接管' : !x.exists ? '还没有这个脚本' : !x.enabled ? '脚本已经有了，开关没开（用内置方式）' : '用内置方式'),
        x.last ? h('span', { className: 'ab-small', style: { color: x.last.ok ? 'var(--ab-ok)' : 'var(--ab-err)' } }, ' · 上次' + (x.last.ok ? '成功，' + x.last.message : '出错：' + x.last.message)) : null),
      h('div', { className: 'ab-flex' },
        x.exists ? null : h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => act('/local/template', x.slot, 't') }, '生成模板'),
        h(Btn, { small: true, onClick: () => { navigator.clipboard.writeText(x.prompt); toast('复制好了，粘给 DSH，再把【】里那句换成你的情况', 'ok') } }, '复制给 DSH 的话'),
        x.exists && (x.slot === 'tts' || x.slot === 'image') ? h(Btn, { small: true, disabled: !!busy, onClick: () => act('/local/test', x.slot, 'x') }, busy === x.slot + 'x' ? '正在试…' : '试一下') : null),
      x.slot === 'video' ? h(Row, { label: '最多等多久', hint: '生视频很慢，超过这个时间算失败' }, f.num('local.videoTimeoutMin', { min: 1 }), h('span', { className: 'ab-muted' }, '分钟')) : null,
      x.slot === 'image' && img ? h('img', { src: 'data:image/png;base64,' + img, style: { marginTop: 10, maxWidth: 240, borderRadius: 8 } }) : null)),
  )
}

function RemoteBackup({ toast, st, onRestored }) {
  const [s, setS] = useState(null)
  const [form, setForm] = useState(null)
  const [remoteFiles, setRemoteFiles] = useState(null)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'keep' ? Math.max(1, Math.round(Number(e.target.value) || 1)) : (k === 'enabled' || k === 'autoCreate' || k === 'forceOverwrite' || k === 'webdavConfigOnly' ? e.target.checked : e.target.value) })
  const load = () => get('/backup/remote/state').then((state) => {
    setS(state)
    const v = state.remote || {}
    const saved = (st && st.config && st.config.backup && st.config.backup.remote) || {}
    setForm({
      provider: v.provider === 'webdav' || (!v.provider && saved.provider === 'webdav') ? 'webdav' : 'gitee',
      enabled: !!v.enabled, owner: v.owner || '', repo: v.repo || '', token: '', branch: v.branch || 'master',
      time: v.time || '03:30', keep: v.keep || 7, autoCreate: v.autoCreate !== false, forceOverwrite: !!v.forceOverwrite,
      webdavUrl: v.webdav?.url || '', webdavUsername: v.webdav?.username || '', webdavPassword: '',
      webdavConfigOnly: (v.webdav?.configOnly ?? v.configOnly ?? saved.webdav?.configOnly) !== false,
    })
  })
  useEffect(() => { load() }, [])
  const running = Boolean(s && s.job && s.job.running)
  useEffect(() => { if (!running) return; const t = setInterval(load, 1000); return () => clearInterval(t) }, [running])
  const call = (p, body = {}) => fetch(API + p, { method: 'POST', headers: { 'x-aurabot-backup': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json())
  const after = (r2) => { toast(r2.ok ? (r2.message || '好了') : r2.message, r2.ok ? 'ok' : 'err'); load() }
  if (!form) return null
  const job = s && s.job
  const webdav = form.provider === 'webdav'
  const Input = (k, placeholder, type) => h('input', { className: 'ab-input', type: type || 'text', placeholder, value: form[k], onChange: set(k), style: { minWidth: 0 } })
  const Field = (label, k, placeholder, type?) => h('div', { style: { flex: 1, minWidth: 0 } },
    h('div', { className: 'ab-small ab-muted', style: { marginBottom: 2 } }, label),
    Input(k, placeholder, type))
  const saveBody = () => {
    const b: any = { provider: form.provider, enabled: form.enabled, time: form.time, keep: form.keep }
    if (webdav) {
      b.webdav = { url: form.webdavUrl.trim(), username: form.webdavUsername.trim(), configOnly: form.webdavConfigOnly, ...(form.webdavPassword ? { password: form.webdavPassword } : {}) }
    } else {
      Object.assign(b, { owner: form.owner.trim(), repo: form.repo.trim(), branch: form.branch.trim() || 'master', autoCreate: form.autoCreate, forceOverwrite: form.forceOverwrite })
      if (form.token) b.token = form.token
    }
    return b
  }
  const loadRemote = async () => {
    setRemoteBusy(true)
    try {
      const r = await call('/backup/remote/list')
      if (!r.ok) toast(r.message, 'err')
      else setRemoteFiles(r.files || [])
    } finally { setRemoteBusy(false) }
  }
  const restoreRemote = async (name) => {
    if (!confirm('从 WebDAV 拉回并导入「' + name + '」？\n\n重启 DSH 后，这台电脑上的配置、记忆、人设等会被备份里的内容替换。')) return
    setRestoring(true)
    try {
      const r = await call('/backup/remote/restore', { name })
      toast(r.ok ? (r.message || '已拉回，重启 DSH 后换上') : r.message, r.ok ? 'ok' : 'err')
      if (r.ok) {
        setRemoteFiles(null)
        if (onRestored) onRestored()
      }
    } finally { setRestoring(false) }
  }
  return h(Card, { title: '云备份（Gitee / WebDAV）', desc: '每天到点自动打包一份备份，推到你的私有仓库或 WebDAV，换电脑或坏盘时也能找回来。' },
    h(Seg, {
      value: form.provider,
      onChange: (v) => setForm({ ...form, provider: v }),
      options: [{ value: 'webdav', label: 'WebDAV' }, { value: 'gitee', label: 'Gitee 私有仓库' }],
    }),
    webdav
      ? h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 备份里有全部聊天记录、记忆和账号凭证。WebDAV 请用自己可控的私有网盘，并尽量走 HTTPS；插件会自动创建 aurabot-backups 文件夹，只把 zip 上传到你的服务器，不会传给第三方。')
      : h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 仓库必须是「私有」的！备份里有你全部的聊天记录、记忆和账号凭证，推到公开仓库等于把它们挂到网上。推送前会先向 Gitee 核实仓库确实是私有的，公开仓库一律拒绝推。'),
    h('div', { className: 'ab-flex', style: { alignItems: 'center' } },
      h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.enabled, onChange: set('enabled') }), '每天自动备份并推送'),
      form.enabled ? h('span', { className: 'ab-small ab-muted' }, '下次：' + (s && s.nextAt ? String(s.nextAt).slice(0, 16).replace('T', ' ') : '到点就跑')) : null),
    webdav
      ? h('div', null,
        h('div', { className: 'ab-flex', style: { marginTop: 10 } },
          Field('服务器地址', 'webdavUrl', 'https://dav.jianguoyun.com/dav/')),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          Field('用户名', 'webdavUsername', '坚果云账号邮箱 / WebDAV 用户名'),
          Field('密码/应用授权码', 'webdavPassword', s && s.remote && s.remote.webdav && s.remote.webdav.hasPassword ? '已保存，留空就不改' : '坚果云：账户信息 → 安全选项 → 添加应用密码', 'password')),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '会自动在服务器根目录创建 aurabot-backups 文件夹；填到已有文件夹也可以。'),
        h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginTop: 10 } },
          h('input', { type: 'checkbox', checked: form.webdavConfigOnly, onChange: set('webdavConfigOnly') }), '仅备份配置与数据文件（不含画作、表情、截图等媒体）'),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 4, lineHeight: 1.7 } },
          '勾选后打包 config.json、人格、记忆库、日记/心情、模块配置、聊天流水和当前工作区 DSH 会话；不包含画作 imagegen、表情 stickers、B站截图 bili-shots、抖音资料、语音缓存、市场模块代码、日志和缓存。上传的 zip 会明显更小；远端保留份数对完整备份和仅配置备份分别计算。'))
      : h('div', null,
        h('div', { className: 'ab-flex', style: { marginTop: 10 } },
          Field('Gitee 用户名', 'owner', '如 gitee.com/小鱼 里的「小鱼」'),
          Field('仓库名（私有）', 'repo', '如 aurabot-backup，没有会自动建'),
          Field('分支（一般不用改）', 'branch', 'master')),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          Field('Gitee 私人令牌', 'token', s && s.remote && s.remote.hasToken ? '已保存，留空就不改' : '下面第 2 步生成的那串', 'password')),
        h('div', { className: 'ab-flex', style: { marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.autoCreate, onChange: set('autoCreate') }), '仓库不存在时自动建（建的就是私有，推荐开）'),
          h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.forceOverwrite, onChange: set('forceOverwrite') }), '允许覆盖已有内容的仓库'))),
    h('div', { className: 'ab-flex', style: { marginTop: 8 } },
      Field('每天几点备份', 'time', '如 03:30'),
      Field('远端留几份', 'keep', '如 7')),
    h('div', { className: 'ab-flex', style: { marginTop: 10, alignItems: 'center' } },
      h('span', { className: 'ab-flex' },
        h(Btn, { small: true, kind: 'primary', disabled: running, onClick: async () => after(await call('/backup/remote/config', saveBody())) }, '保存设置'),
        h(Btn, { small: true, disabled: running, onClick: async () => { if (!confirm('现在就把最新备份推到 ' + (webdav ? 'WebDAV' : 'Gitee') + '？（不会重新打包，推 backups 里最新的一份）')) return; after(await call('/backup/push')) } }, running ? '推送中…' : '立即推送'))),
    job && job.error ? h('div', { className: 'ab-note err', style: { marginTop: 10 } }, '推送失败：' + job.error) : null,
    job && job.result ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, '上次推送：' + job.result.message) : null,
    webdav ? h('div', { style: { marginTop: 14 } },
      h('div', { className: 'ab-section-title' }, '从 WebDAV 恢复'),
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, disabled: remoteBusy || restoring, onClick: loadRemote }, remoteBusy ? '读取中…' : '拉取备份列表')),
      remoteFiles === null
        ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '点「拉取备份列表」读取远端 aurabot-backups 里的备份。')
        : remoteFiles.length === 0
          ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '远端 aurabot-backups 里还没有备份。')
          : h('div', { style: { marginTop: 8 } }, remoteFiles.map((name) => h('div', { key: name, className: 'ab-flex', style: { alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--ab-line)' } },
            h('span', { className: 'ab-small', style: { flex: 1, minWidth: 0, wordBreak: 'break-all' } }, (name.startsWith('aurabot-config-') ? '仅配置 · ' : '') + name),
            h(Btn, { small: true, disabled: restoring, onClick: () => restoreRemote(name) }, restoring ? '拉取中…' : '拉回并恢复'))))) : null,
    h('details', { open: webdav ? !(s && s.remote && s.remote.webdav && s.remote.webdav.hasPassword) : !(s && s.remote && s.remote.hasToken), style: { marginTop: 10 } },
      h('summary', { className: 'ab-small', style: { cursor: 'pointer' } }, webdav ? '📖 WebDAV 怎么填（点这里收起）' : '📖 第一次用？跟着下面 4 步做（点这里收起）'),
      webdav
        ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
          h('div', null, h('b', null, '第 1 步 · 服务器地址：'), '坚果云填 https://dav.jianguoyun.com/dav/（带 /dav/，只填域名根目录会 HTTP 410）；其他网盘填 WebDAV 根地址。'),
          h('div', null, h('b', null, '第 2 步 · 用户名和密码/应用授权码：'), '坚果云用户名就是账号邮箱；密码不是登录密码，去网页端「账户信息 → 安全选项 → 添加应用密码」生成一个，填到第二栏。'),
          h('div', null, h('b', null, '第 3 步 · 保存并试推：'), '点「保存设置」，再点「立即推送」。成功后每天按设置时间自动上传，远端按「留几份」清理旧 zip。'),
          h('div', { style: { marginTop: 6 } }, '插件会自动创建 aurabot-backups 文件夹；如果服务器不允许根目录建目录，可以先手动建好再把地址填到该文件夹。'))
        : h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
          h('div', null, h('b', null, '第 1 步 · 注册 Gitee：'), '打开 ', h('a', { href: 'https://gitee.com/signup', target: '_blank', rel: 'noreferrer' }, 'gitee.com'), ' 注册一个账号（手机号或邮箱都行，免费的）。'),
          h('div', null, h('b', null, '第 2 步 · 生成令牌：'), '登录后点右上角头像 →「设置」→ 左侧「安全设置」→「私人令牌」→「+ 生成新令牌」，勾选 ', h('b', null, 'projects'), ' 权限后提交，把显示出来的那串字符复制粘贴到上面的「Gitee 私人令牌」里（只显示一次，丢了就重新生成一个）。'),
          h('div', null, h('b', null, '第 3 步 · 安装 git：'), '打开 ', h('a', { href: 'https://git-scm.com/downloads', target: '_blank', rel: 'noreferrer' }, 'git-scm.com/downloads'), '，下载 Windows 版，一路点「下一步」装完，然后重启 DSH。装过的可以跳过。'),
          h('div', null, h('b', null, '第 4 步 · 填上面的表格：'), '「Gitee 用户名」填你个人主页地址 gitee.com/ 后面那串；「仓库名」自己起一个，比如 aurabot-backup；「私人令牌」粘第 2 步的；勾上「每天自动备份并推送」，点「保存设置」。仓库让插件自动建就行（建出来就是私有的）。如果自己在 Gitee 网页上建，右上角「+」→ 新建仓库时务必选 ', h('b', null, '「私有」'), '，不要勾「设置初始化 README」。'),
          h('div', { style: { marginTop: 6 } }, '弄完点一次「立即推送」试试，提示「已推送」就成功了，之后每天都会自动备份。备份超过 95MB 会自动分成若干卷推送（文件名带 .part01、.part02…）；恢复时把各卷按顺序合并回一个 zip 再导入——Windows 命令示例：copy /b aurabot-backup-xxx.zip.part01+aurabot-backup-xxx.zip.part02+… 完整的.zip')),
    h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, webdav ? 'WebDAV 密码只存在本机配置里，不会展示；推送由插件直接上传，不经过第三方。' : '令牌只存在本机配置里，不会上传；推送走电脑上装的 git。有报错看上面的红字，一般都是令牌权限没勾对或 git 没装。')))
}

/** 备份：打包数据目录，换电脑时导入，重启 DSH 后换上。 */

function Backup({ toast, st }) {
  const [s, setS] = useState(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const fileRef = useRef(null)
  const load = () => get('/backup/state').then(setS)
  useEffect(() => { load() }, [])
  const running = Boolean(s && s.job && s.job.running)
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 1000)
    return () => clearInterval(t)
  }, [running])
  const call = (p, body = {}) => fetch(API + p, { method: 'POST', headers: { 'x-aurabot-backup': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json())
  const after = (r) => { toast(r.ok ? (r.message || ('备份已导入（' + r.files + ' 个文件），重启 DSH 后换上')) : r.message, r.ok ? 'ok' : 'err'); load() }
  const upload = async (file) => {
    if (!file) return
    if (!confirm('导入「' + file.name + '」？\n\n重启 DSH 后，这台电脑上的配置、记忆、人设等会被备份里的内容替换，原来的文件留在 backups 文件夹。')) return
    setBusy(true)
    try { after(await fetch(API + '/backup/upload', { method: 'POST', headers: { 'x-aurabot-backup': '1' }, body: file }).then((r) => r.json())) } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB')
  const job = s && s.job
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '备份', desc: '把配置、记忆、人设、表情、模块和ta的数据打成一个文件，放到新电脑上恢复。' },
      h('div', { className: 'ab-note warn', style: { marginBottom: 10 } }, '备份文件里有账号凭证和聊天记录，别发给别人，也别传到公开的地方。'),
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, kind: 'primary', disabled: running, onClick: async () => { after(await call('/backup/create')) } }, running ? '打包中 ' + (job.done || 0) + ' / ' + (job.total || '…') : '立即备份'),
        h(Btn, { small: true, onClick: async () => { const r = await call('/backup/open'); if (!r.ok) toast(r.message) } }, '打开备份文件夹')),
      job && job.error ? h('div', { className: 'ab-note err', style: { marginTop: 10 } }, '备份失败：' + job.error) : null,
      job && job.result ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, '刚生成：' + job.result.name + '，' + job.result.files + ' 个文件' + (job.result.skipped.length ? '；有 ' + job.result.skipped.length + ' 个文件没能带上：' + job.result.skipped.slice(0, 5).join('、') : '')) : null,
      s && s.list.length ? h('div', { style: { marginTop: 10 } }, s.list.slice(0, 8).map((b) => h('div', { key: b.name, className: 'ab-small' }, b.name + ' · ' + size(b.bytes)))) : null),
    h(RemoteBackup, { toast, st, onRestored: load }),
    h(Card, { title: '恢复', desc: '在新电脑上先装好 DSH 和 Aurabot，再把备份拖进来。重启 DSH 后自动换上设置和数据、重新下载市场模块、放回 QQ 会话，原来的文件留在 backups 文件夹。' },
      s && s.modules && s.modules.length ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 8 } }, '还没装回来的模块：' + s.modules.join('、') + '（下次启动再试）') : null,
      s && s.pending ? h('div', { className: 'ab-note warn' }, '已导入 ' + s.pending.files + ' 个文件（备份于 ' + String(s.pending.createdAt || '').slice(0, 16).replace('T', ' ') + '），重启 DSH 后换上。',
        h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { after(await call('/backup/cancel')) } }, '取消恢复'))) : [
        h('input', { key: 'f', ref: fileRef, type: 'file', accept: '.zip', style: { display: 'none' }, onChange: (e) => { upload(e.target.files[0]); e.target.value = '' } }),
        h('div', { key: 'b', className: cx('ab-drop', over && 'over'), onClick: () => fileRef.current && fileRef.current.click(),
          onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false),
          onDrop: (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]) } }, busy ? '导入中…' : '把备份 zip 拖到这里，或点这里选择文件'),
        h('div', { key: 'p', className: 'ab-flex', style: { marginTop: 10 } },
          h('input', { className: 'ab-input', placeholder: '文件很大时填完整路径，如 D:\\aurabot-backup.zip', value: path, onChange: (e) => setPath(e.target.value) }),
          h(Btn, { small: true, disabled: busy || !path.trim(), onClick: async () => { if (!confirm('导入这个备份？重启 DSH 后会替换这台电脑上的数据。')) return; setBusy(true); try { after(await call('/backup/restore-path', { path })) } finally { setBusy(false) } } }, '导入')),
      ]),
    h(Card, { title: '不会带过去的', desc: '这些要在新电脑上重新弄一下。' },
      h('div', { className: 'ab-small ab-muted' }, 'DSH 自己的设置和模型密钥、QQ 网关 SnowLuma 的登录、QQ 工作区以外的 DSH 会话；抖音和小黑盒的浏览器登录要重新扫码；日志和缓存不备份；翻唱环境和桌宠的 Electron 要重新安装；数据目录以外的路径（比如 ffmpeg、本地图片文件夹）在新电脑上要重新填。')))
}

/** 浏览器：需要浏览器的功能（逛网页 / 刷抖音 / 小红书 / 小黑盒验证）走哪个浏览器。 */

function Browser({ st, draft, setDraft }) {
  const on = (draft.browser && draft.browser.useDshSidebar) === true
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '使用 DSH 侧边浏览器', desc: '打开后，ta 需要浏览器的功能都连 DSH 的共享浏览器（侧边浏览器）：画面在 DSH 右侧「Agent 浏览器」里实时可见、可直接接手点按；不再为逛网页 / 刷抖音 / 小红书 / 小黑盒验证各开一个独立窗口。关掉则回到原来的专用浏览器（每模块独立窗口、独立登录资料）。' },
      h(Row, { label: '使用 DSH 侧边浏览器', hint: '共享一个浏览器实例；切换过去后各平台要在共享浏览器里重新登录一次' },
        h(Switch, { on, onChange: (v) => setDraft(setPath(draft, 'browser.useDshSidebar', v)) })),
      on
        ? h('div', { className: 'ab-note' }, '已启用：共享浏览器没在跑时会自动拉起；这些功能「关闭浏览器」只断开连接，不会关掉 DSH 的共享窗口。')
        : h('div', { className: 'ab-note' }, '当前走各模块的专用浏览器：每个模块一个独立窗口、独立登录资料。'),
    ),
  )
}

/** 安全防护：SSRF 这类内置防护的强度。 */

function Security({ st, draft, setDraft }) {
  const f = useField(draft, setDraft)
  const mode = (draft.security && draft.security.ssrfMode) || 'strict'
  const picked = draft.update && draft.update.unstable
  const unstable = typeof picked === 'boolean' ? picked : String(st.version).includes('-')
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '更新推送', desc: '插件有新版本时，面板会提示并给出更新命令。' },
      h(Row, { label: '订阅不稳定版本', hint: '打开后也会收到 beta 和 rc 测试版，能早点用上新功能，但可能有问题；关掉只收正式版' }, h(Switch, { on: unstable, onChange: (v) => setDraft(setPath(draft, 'update.unstable', v)) }))),
    h(Card, { title: '危险命令确认', right: f.sw('security.dangerConfirm'), desc: '打开后，ta在私聊里要执行终端危险命令（删根目录、格式化、关机、下载后直接执行等）之前，会先发 QQ 私聊问你；你回复「确认」才执行，回复「取消」或 60 秒没回就拦下。默认开；只拦真正致命的命令，普通删除/构建/改文件不受影响。' }),
    h(Card, { title: 'SSRF 防护', desc: '限制 ta 下载图片、语音时能访问哪些地址 —— 防止有人用一条链接诱导 ta 去访问你电脑或内网里的服务（路由器管理页、云服务器的 169.254.169.254、本机端口之类）。' },
      h(Row, { label: '防护强度', hint: '部署在服务器上、或者群里有陌生人时，用「严格」' },
        h(Seg, {
          value: mode,
          onChange: (v) => setDraft(setPath(draft, 'security.ssrfMode', v)),
          options: [{ value: 'strict', label: '严格' }, { value: 'loose', label: '宽松' }],
        })),
      mode === 'strict'
        ? h('div', { className: 'ab-note' }, '严格：解析结果里只要有一个地址落在内网段（10./127./169.254./172.16-31/192.168./100.64-127/fd00::/8 等）就拒绝。最安全；但如果你的代理 DNS 会给公网域名塞一条 IPv6 假地址，正常图片也会被拦下来。')
        : h('div', { className: 'ab-note warn' }, '宽松：只有解析结果全部是内网才拒绝。适合本机开着 fake-ip 代理、DNS 会给公网域名同时返回公网地址和 IPv6 ULA（fd00::/8）的情况。代价是「公网 + 内网混合返回」的域名会被放行 —— 别在服务器上开。'),
      h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '严格模式下图片老是下不来时，先查一下这个域名是不是解析出了内网地址：nslookup -type=AAAA multimedia.nt.qq.com.cn'),
    ),
    h(Card, { title: '远端管理（反代部署）', desc: '默认只有本机能打开面板、调管理接口——能改配置、装模块、取联动密钥、下载桌宠客户端包（里面有令牌），所以默认不外放。要做远端管理必须在这里显式打开，并且务必在反向代理层再加一道认证（Basic Auth / OAuth）。' },
      h(Row, { label: '允许远端访问管理接口', hint: '⚠ 打开后任何能连到插件端口的人都能改你的配置。只在反代已加认证时才开' },
        h(Switch, {
          on: (draft.security && draft.security.panelRemoteAccess) === true,
          onChange: (v) => setDraft(setPath(draft, 'security.panelRemoteAccess', v)),
        })),
      (draft.security && draft.security.panelRemoteAccess) === true
        ? h('div', { className: 'ab-note warn' }, '已允许远端管理。请确认反向代理上已经加了认证，否则等于把管理权交给任何扫到你端口的人。')
        : h('div', { className: 'ab-note' }, '只允许本机访问。直接连公网或经反代进来都会被 403 挡下。'),
      h(Row, { label: '可信反向代理地址', hint: '放在反代后面才需要填。填反代自己的地址（127.0.0.1 = 本机 nginx，172.17.0.1 = 容器网关），多个用逗号分隔' },
        h('input', {
          className: 'ab-input',
          value: (draft.security && draft.security.trustedProxy) || '',
          placeholder: '127.0.0.1',
          onChange: (e) => setDraft(setPath(draft, 'security.trustedProxy', e.target.value)),
        })),
      h(Row, { label: '面板对外域名（反代部署）', hint: '面板经反代对外时填域名（如 panel.example.com）。跨站防护把这个域名发来的请求也算「同源」，不然从远端打开面板一保存就会被 403。有多个入口（对外域名 + 内网地址）时用逗号分隔' },
        h('input', {
          className: 'ab-input',
          value: (draft.security && draft.security.publicHostname) || '',
          placeholder: 'panel.example.com, 10.0.0.5',
          onChange: (e) => setDraft(setPath(draft, 'security.publicHostname', e.target.value)),
        })),
      h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } },
        '插件判断「请求从哪来」只看 TCP 连接的对端地址——X-Forwarded-For 是客户端自己就能写的头，不能信。'
        + '放在反代后面时连接对端永远是反代自己，所以要把反代地址填进上面，插件才会采信 X-Forwarded-For 的最后一跳。'
        + '留空 = 从不相信任何转发头（最安全，适合直连暴露或纯同机）。'),
    ),
    h(Card, { title: '其它内置防护', desc: '这些是固定行为，暂时没有开关。' },
      h('div', { className: 'ab-muted ab-small', style: { whiteSpace: 'pre-wrap' } },
        ['· 只下载 http / https，并限制单张图片大小', '· 只从白名单里的会话收表情', '· 群管操作只认主人，对象不能是主人自己', '· 联动（bridge）默认关闭，开放时必须带密钥', '· 表情的改名 / 删除只对主人开放'].join('\n')),
    ),
  )
}

/** 面板里的调试对话：不经过 QQ、不写记忆，直接把她说的话显示出来。 */

function DebugChat({ toast }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const say = async () => {
    const t = text.trim()
    if (!t || busy) return
    setMsgs((m) => [...m, { who: 'me', text: t }])
    setText('')
    setBusy(true)
    try {
      const r = await post('/debug/say', { text: t })
      setMsgs((m) => [...m, { who: 'her', text: r.ok ? (r.text || '（她这次没说话）') : '✗ ' + (r.message || '出错了') }])
    } catch (error) {
      setMsgs((m) => [...m, { who: 'her', text: '✗ ' + error.message }])
    } finally {
      setBusy(false)
    }
  }
  return h('div', null,
    msgs.length ? h('div', { className: 'ab-list', style: { maxHeight: 340, overflow: 'auto', marginBottom: 8 } },
      msgs.map((m, i) => h('div', { key: i, className: 'ab-li' },
        h('div', { className: 'meta' }, m.who === 'me' ? '你' : '她'),
        h('div', { className: 'body' }, m.text)))) : h(Empty, { icon: '🐳', text: '说点什么试试 —— 比如「在吗」「今天心情怎么样」' }),
    h('div', { className: 'ab-flex', style: { marginTop: 6 } },
      h('input', {
        className: 'ab-input',
        style: { flex: 1 },
        value: text,
        placeholder: '对她说…（回车发送）',
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') say() },
      }),
      h(Btn, { small: true, kind: 'primary', disabled: busy || !text.trim(), onClick: say }, busy ? '她在想…' : '发送')),
  )
}

function Logs() {
  const [items, setItems] = useState(null)
  const [level, setLevel] = useState('info')
  const [area, setArea] = useState('')
  const [auto, setAuto] = useState(true)
  const load = useCallback(() => get('/logs?limit=400&level=' + level + '&area=' + area).then((r) => setItems(r.entries || [])), [level, area])
  useEffect(() => { load(); if (!auto) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [load, auto])
  return h(Card, { title: '日志', desc: '所有后台动作都在这里，令牌和密码已自动打码。完整日志文件在 %USERPROFILE%\\.dsh\\plugins-data\\aurabot\\logs\\。',
    right: h('div', { className: 'ab-flex' },
      h(Select, { value: level, onChange: setLevel, width: 110, options: [['debug', '全部'], ['info', '一般'], ['warn', '警告'], ['error', '错误']].map(([value, label]) => ({ value, label })) }),
      h(Select, { value: area, onChange: setArea, width: 130, options: [['', '所有模块'], ['core', '核心'], ['chat', '聊天'], ['onebot', 'QQ 网关'], ['snowluma', 'SnowLuma'], ['sticker', '表情'], ['qzone', '空间'], ['voice', '语音'], ['imagegen', '生图'], ['speakup', '搭话']].map(([value, label]) => ({ value, label })) }),
      h('span', { className: 'ab-switch-row' }, h(Switch, { on: auto, onChange: setAuto }), h('span', { className: 'ab-muted ab-small' }, '自动刷新'))) },
    items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h(Empty, { text: '没有符合条件的日志' }) :
      h('div', { className: 'ab-logs' }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
}

export { RootPicker, InstallProgress, SONG_PARTS, Song, BiliCookie, LocalApi, RemoteBackup, Backup, Browser, Security, DebugChat, Logs }
