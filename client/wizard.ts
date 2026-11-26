import { useState } from './core/ui/react.ts'
import { get, post } from './core/api/api.ts'
import { Btn, Choices, Row, cx, h, useField } from './core/ui/ui.ts'
import { OneBotFields } from './tabs/chat/connect.ts'
import { Backup } from './tabs/system/system.ts'

// ---------------- 首次使用向导 ----------------
const WIZ_STEPS = ['你们的 QQ 号', '接上机器人', '完成']

function Wizard({ st, draft, setDraft, save, toast, reload, onClose }) {
  const [step, setStep] = useState(() => { try { return Number(localStorage.getItem('aurabot.wiz') || 0) } catch (e) { return 0 } })
  const go = (i) => { setStep(i); try { localStorage.setItem('aurabot.wiz', String(i)) } catch (e) {} }
  const f = useField(draft, setDraft)
  const conn = st.onebot.state === 'connected'
  const login = st.onebot.login
  const [live, setLive] = useState('dry')
  const [diag, setDiag] = useState(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const qqOk = /^\d{5,11}$/.test(draft.botQQ || '') && /^\d{5,11}$/.test(draft.ownerQQ || '') && draft.botQQ !== draft.ownerQQ
  const verified = conn && login && String(login.uin) === String(st.config.botQQ) && !st.onebot.problem
  const canNext = [qqOk, Boolean(draft.onebot.wsUrl || st.config.onebot.wsUrl), true][step]
  const next = async () => {
    if ((step === 0 || step === 1) && !(await save({ ...draft, enabled: true }))) return
    go(Math.min(step + 1, WIZ_STEPS.length - 1))
    reload()
  }
  const useExisting = async () => {
    const r = await post('/setup/done', { existingConnection: true })
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
  }
  const diagnose = async () => {
    setDiagBusy(true)
    const r = await get('/diagnose')
    setDiagBusy(false)
    setDiag(r)
  }
  const body = [
    // 0. QQ 号
    h('div', null,
      h('p', { className: 'ab-desc' }, '大肥鱼需要一个自己的 QQ 号（机器人号），还要知道谁是ta的主人。'),
      h(Row, { label: '机器人 QQ 号', hint: '强烈建议用小号：非官方 QQ 工具有被限制的风险' }, f.text('botQQ', { placeholder: '例如 123456789' })),
      h(Row, { label: '你的 QQ 号（主人）', hint: '群管、操作电脑这些只听主人的' }, f.text('ownerQQ', { placeholder: '你的大号' })),
      h(Row, { label: 'ta怎么称呼你' }, f.text('ownerName', { placeholder: '主人' })),
      h(Row, { label: '工作区文件夹', hint: 'ta在 QQ 会话里读写文件的地方，C 盘空间紧就放到别的盘，比如 D:\\Aurabot\\qq-chats。填完整路径，留空用默认位置。以后想换，在「连接」页能搬。聊天记录和记忆在用户目录的 .dsh 里，不在这个文件夹' }, f.text('workspaceDir', { size: 'wide', placeholder: st.workspaceDir || '' })),
      draft.botQQ && draft.ownerQQ && draft.botQQ === draft.ownerQQ ? h('div', { className: 'ab-note err' }, '机器人号和主人号不能是同一个。') : null),
    // 1. OneBot 地址
    h('div', null,
      h('p', { className: 'ab-desc' }, '让你的 OneBot v11 服务（NapCat、LLOneBot、Lagrange、Docker 里的实现等）登录机器人号，把它的正向 WebSocket 地址填在下面。插件只连接，不会启动或注入任何东西；连上后会先核对登录的是不是机器人号，不是就断开。'),
      h(OneBotFields, { draft, f }),
      h(Row, { label: '机器人 QQ 号' }, f.text('botQQ'))),
    // 2. 完成
    h('div', null,
      h('p', { className: 'ab-desc' }, '连接状态：' + (conn ? (login ? '已连上 ' + login.nickname + '（' + login.uin + '）' : '已连上') : '还没连上')),
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 8, marginBottom: 10 } },
        h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '连接 / 重新连接'),
        h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接'),
        h(Btn, { small: true, disabled: diagBusy, onClick: diagnose }, diagBusy ? '诊断中…' : '一键诊断')),
      !conn && st.onebot.problem ? h('div', { className: 'ab-note warn' }, h('b', null, '还连不上的原因：'), st.onebot.problem) : null,
      diag ? h('div', { className: 'ab-note', style: { marginTop: 10 } },
        h('div', { className: 'ab-small' }, '诊断结果：' + (diag.ok ? '全部正常' : '有问题，看下面带 ✗ 的项')),
        (diag.items || []).map((it) => h('div', { key: it.id, className: 'ab-small', style: { padding: '5px 0', borderTop: '1px solid var(--ab-line)' } },
          h('span', { style: { color: it.ok ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, it.ok ? '✓ ' : '✗ '),
          h('b', null, it.label + '：'), it.detail,
          !it.ok && it.hint ? h('div', { className: 'ab-muted' }, '→ ' + it.hint) : null))) : null,
      h('p', { className: 'ab-desc', style: { marginTop: 14 } }, '最后选一下ta怎么上线：'),
      h(Choices, { value: live, onChange: setLive, options: [
        { value: 'dry', label: '先试运行', desc: 'ta会照常思考，但只写进日志、不真的发出去。看几条没问题再在右上角关掉试运行' },
        { value: 'live', label: '直接上线', desc: '马上开始真的回 QQ 消息' },
      ] }),
      h('div', { className: 'ab-flex', style: { marginTop: 12 } },
        h(Btn, { small: true, onClick: async () => { await save({ ...draft, enabled: true, dryRun: false }); const r = await post('/test-send'); toast(r.message); await save({ ...draft, enabled: true, dryRun: live === 'dry' }) } }, '给我发一条自测消息'))),
  ][step]
  return h('div', { className: 'ab-card', style: { padding: '20px 22px' } },
    h('div', { className: 'ab-flex', style: { marginBottom: 6 } }, h('h3', { style: { margin: 0, fontSize: 16 } }, '设置向导'), h('span', { className: 'ab-muted ab-small' }, '第 ' + (step + 1) + ' / ' + WIZ_STEPS.length + ' 步 · ' + WIZ_STEPS[step]), h('div', { className: 'ab-spacer' }),
      st.config.setupDone && onClose ? h(Btn, { small: true, kind: 'ghost', onClick: onClose }, '关闭向导') : null),
    !st.config.setupDone ? h('details', { style: { marginTop: 10 } }, h('summary', { className: 'ab-small' }, '换电脑了？从备份恢复'), h('div', { style: { marginTop: 10 } }, h(Backup, { toast, st }))) : null,
    h('div', { className: 'ab-wiz-bar' }, WIZ_STEPS.map((s, i) => h('button', { key: s, type: 'button', className: cx('seg', i < step && 'done', i === step && 'on'), onClick: () => i <= step && go(i), title: s }, h('span', null, s)))),
    verified && !st.config.setupDone ? h('div', { className: 'ab-note', style: { marginTop: 12 } }, '机器人号已经连接并核对通过。', ' ', h(Btn, { small: true, onClick: useExisting }, '使用现有连接，进入面板')) : null,
    h('div', { style: { minHeight: 220, marginTop: 14 } }, body),
    h('div', { className: 'ab-flex', style: { marginTop: 16, borderTop: '1px solid var(--ab-line)', paddingTop: 12 } },
      step > 0 ? h(Btn, { kind: 'ghost', onClick: () => go(step - 1) }, '上一步') : null,
      h('div', { className: 'ab-spacer' }),
      step < WIZ_STEPS.length - 1
        ? h(Btn, { kind: 'primary', disabled: !canNext, onClick: next }, '下一步')
        : h(Btn, { kind: 'primary', onClick: async () => {
          if (!(await save({ ...draft, enabled: true, dryRun: live === 'dry' }))) return
          const r = await post('/setup/done'); toast(r.message, r.ok ? 'ok' : 'err')
          if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
        } }, '完成，让大肥鱼上线')))
}

export { WIZ_STEPS, Wizard }
