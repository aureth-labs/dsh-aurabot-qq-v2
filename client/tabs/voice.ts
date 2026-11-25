import { useState, useEffect, Fragment } from './../core/react.ts'
import { get, post } from './../core/api.ts'
import { getPath, setPath } from './../core/format.ts'
import { PinIcon } from './../core/icons.ts'
import { Btn, Card, Range, Row, Select, cx, h, useField, usePersisted } from './../core/ui.ts'
import { VoiceSongModel, pitchLabel, pitchNum, pitchText } from './model.ts'
import { ExtPage } from './modules.ts'

function BreezeVoices({ b, draft, setDraft }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true); setErr('')
    try {
      const r = await get('/voice/breeze-voices')
      if (r && r.ok) setList(r.voices || [])
      else setErr(r?.message || '拉不到音色列表')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const cur = String(b?.voiceId || '')
  const opts = (list || []).map((v) => ({ value: v.id, label: v.name || v.id, desc: [v.origin === 'cloned' ? '克隆' : v.origin, v.desc].filter(Boolean).join(' · ') || undefined }))
  if (list && cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur, desc: '当前配置里的音色（不在列表里）' })
  return h('div', null,
    h(Row, { label: 'Breeze 音色', hint: list ? '共 ' + list.length + ' 个，选一个就填进上面的音色 id' : '点「列出音色」从 Breeze 拉列表，选中自动填 id，不用去官网抄' },
      h('div', { className: 'ab-flex' },
        list ? h(Select, { width: 340, value: cur, options: opts, onChange: (v) => setDraft(setPath(draft, 'voice.breeze.voiceId', v)) }) : null,
        h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: load }, busy ? '拉取中…' : (list ? '刷新' : '列出音色')))),
    err ? h('div', { className: 'ab-note warn', style: { marginTop: 6 } }, err) : null,
  )
}
/** Breeze 云端额度：查余额、显示上次领取、手动领一次。 */

function BreezeQuota({ b, toast }: { b: any; toast: (m: string, kind?: string) => void }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState('')
  const load = () => get('/voice/breeze-status').then((r) => setSt(r && r.ok !== false ? r : null)).catch(() => setSt(null))
  useEffect(() => { load() }, [b?.mode, b?.keySet, b?.emailSet, b?.autoClaim])
  const claim = async () => {
    setBusy('claim')
    try {
      const r = await post('/voice/breeze-claim', {})
      toast(r.message || (r.ok ? '领完了' : '没领到'), r.ok ? 'ok' : 'err')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy('') }
  }
  if (b?.mode === 'local') return h('div', { className: 'ab-muted ab-small' }, '本地自建模式：不查额度，也不用登录。')
  const when = st?.lastClaimAt ? new Date(st.lastClaimAt).toLocaleString() : ''
  return h('div', { className: 'ab-note', style: { marginTop: 8 } },
    st
      ? [
        h('div', { key: 'a' }, st.online
          ? '云端在线' + (st.balance == null ? '' : '（额度 ' + st.balance + '）')
          : '云端离线' + (st.note ? '：' + st.note : '')),
        when ? h('div', { key: 'b', className: 'ab-muted ab-small' }, '上次领取：' + when + (st.lastTier ? '（' + st.lastTier + '）' : '')) : null,
        !st.emailSet ? h('div', { key: 'c', className: 'ab-muted ab-small' }, '填了邮箱密码才能自动领每日额度。') : null,
      ]
      : h('div', { className: 'ab-muted ab-small' }, '正在查额度…'),
    h('div', { key: 'btn', style: { marginTop: 8 } },
      h(Btn, { small: true, disabled: busy === 'claim' || !st?.emailSet, onClick: claim }, busy === 'claim' ? '领取中…' : '领取今日额度')),
  )
}

function VolcanoVoice({ draft, setDraft }) {
  const f = useField(draft, setDraft)
  const [list, setList] = useState(null)
  const [pv, setPv] = useState({ src: '', busy: false, err: '' })
  useEffect(() => {
    get('/voice/volcano-voices').then((r) => setList(r && r.voices ? r.voices : [])).catch(() => setList([]))
  }, [])
  const cv = draft.voice.volcano || {}
  const voices = list || []
  // 1.0 和 2.0 是两个产品：只开通了 2.0 的账号选 1.0 音色会报「模型没开通」，所以在选项里先标出来
  const opts = voices.map((v) => ({ value: v.id, label: v.name, desc: [v.ver, v.scene || '通用场景', v.ver === '1.0' ? '要另开通 1.0' : ''].filter(Boolean).join(' · '), group: v.group }))
  // 面板里存着清单外的 id（自己从控制台复制的）时，也得能正常显示，别变成一个空格子
  if (list && cv.voiceType && !voices.some((v) => v.id === cv.voiceType)) {
    opts.unshift({ value: cv.voiceType, label: cv.voiceType, desc: '自定义音色 id（不在预置清单里）', group: '自定义' })
  }
  const cur = voices.find((v) => v.id === cv.voiceType)
  // 选音色时把模型版本一起写掉：1.0 的音色配 2.0 的模型会直接报 speaker permission denied
  const pick = (id) => {
    const hit = voices.find((v) => v.id === id)
    setDraft(setPath(setPath(draft, 'voice.volcano.voiceType', id), 'voice.volcano.resourceId', hit ? hit.resourceId : ''))
    setPv({ src: '', busy: false, err: '' })
  }
  // 试听用面板上现在这一份（Key 没保存也能听），不用先存配置
  const preview = async () => {
    setPv({ src: '', busy: true, err: '' })
    const r = await post('/voice/volcano-preview', { keyPool: draft.voice.keyPools?.volcano, apiKey: cv.apiKey || '', voiceType: cv.voiceType || '', resourceId: cv.resourceId || '', speedRatio: cv.speedRatio })
    if (r && r.ok) setPv({ src: 'data:' + r.mime + ';base64,' + r.data, busy: false, err: '' })
    // 后端还是老进程时，这个接口根本不存在，插件框架会统一回「模块没开」——别让人去翻「已安装」
    else if (r && r.moduleOff) setPv({ src: '', busy: false, err: '试听接口还没生效：把 DeepSeek Harness 关掉重开一次，再回来点这个' })
    else setPv({ src: '', busy: false, err: (r && r.message) || '试听失败' })
  }
  return [
    h(Row, { key: 'k', label: 'API Key', hint: '火山控制台左侧「API Key」里那一串；只存在这台电脑上，存过就不再显示' },
      f.text('voice.volcano.apiKey', { type: 'password', size: 'wide', placeholder: cv.apiKeySet ? '已保存（不改就留空）' : '粘进来就行，别的都不用填' }),
      h('a', { key: 'open', className: 'ab-btn sm', href: 'https://console.volcengine.com/speech/new/setting/apikeys?projectName=default', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8 } }, '打开控制台拿 Key')),
    h(Row, { key: 'v', label: '音色', hint: cur ? cur.ver + ' 音色，自动配 ' + cur.resourceId : '清单里没有的 id，直接填在配置里也能用' },
      list === null
        ? h('span', { className: 'ab-muted' }, '正在读音色清单…')
        : voices.length
          ? [
            h(Select, { key: 's', value: cv.voiceType || '', options: opts, width: 320, onChange: pick }),
            h(Btn, { key: 'b', small: true, disabled: pv.busy, onClick: preview }, pv.busy ? '念着呢…' : '试听这个'),
          ]
          : h('span', { className: 'ab-muted' }, '没读到音色清单：把 DeepSeek Harness 关掉重开一次，再打开面板')),
    h(Row, { key: 's', label: '语速', hint: '1.0 是原速；拖动调整，范围 0.5～2.0' },
      h(Range, {
        min: 0.5,
        max: 2,
        step: 0.05,
        value: Number(cv.speedRatio) || 1,
        fmt: (v) => Number(v).toFixed(2) + ' 倍',
        onChange: (v) => setDraft(setPath(draft, 'voice.volcano.speedRatio', Number(v))),
      })),
    pv.err ? h('div', { key: 'e', className: 'ab-small', style: { color: 'var(--ab-err, #d9534f)' } }, pv.err) : null,
    pv.src ? h('div', { key: 'a' }, h('audio', { src: pv.src, controls: true, autoPlay: true, style: { height: 32 } })) : null,
    h('div', { key: 'n', className: 'ab-muted ab-small' },
      voices.length ? '共 ' + voices.length + ' 个官方预置音色（2.0 ' + voices.filter((v) => v.ver === '2.0').length + ' 个，1.0 ' + voices.filter((v) => v.ver === '1.0').length + ' 个），版本跟着音色自动配。' : '',
      '还出不了声就看这两处：',
      h('a', { key: 'k2', href: 'https://console.volcengine.com/speech/new/setting/apikeys?projectName=default', target: '_blank', rel: 'noreferrer' }, 'API Key'),
      '（别的服务的 Key 不通用）、',
      h('a', { key: 'o2', href: 'https://console.volcengine.com/speech/app', target: '_blank', rel: 'noreferrer' }, '开通管理'),
      '（新账号要在「语音合成大模型」那一项点开通，开通后等几分钟生效）。音色也要账号里开通过才能念，报「speaker permission denied」就换一个。'),
  ]
}

function VoiceEngineChoices({ options, value, active, onChange, toast }) {
  const [pinned, setPinned] = usePersisted('voice.pinnedEngines', [])
  const [more, setMore] = useState(false)
  const raw = Array.isArray(pinned) ? pinned : []
  // 自动置顶看「已保存」的接口，不跟当前草稿选择走。
  const current = String(active || '')
  const validRaw = raw.filter((id) => options.some((o) => o.value === id))
  // 保存后，正在使用的接口永远排第一；它也算一个置顶。超过 4 个时从末尾淘汰。
  const activePins = (current && options.some((o) => o.value === current)
    ? [current, ...validRaw.filter((id) => id !== current)]
    : validRaw).slice(0, 4)
  const activeKey = activePins.join('|')
  const rawKey = validRaw.join('|')
  useEffect(() => {
    if (activeKey !== rawKey) setPinned(activePins)
  }, [activeKey, rawKey])
  const ordered = [...activePins.map((id) => options.find((o) => o.value === id)).filter(Boolean), ...options.filter((o) => !activePins.includes(o.value))]
  // 当前接口已经由 activePins 保证在第一张；折叠时固定显示前 4 张 + 更多卡片。
  const visible = more ? ordered : ordered.slice(0, 4)
  const togglePin = (id) => {
    if (id === current) {
      if (toast) toast('正在使用的接口默认置顶')
      return
    }
    if (activePins.includes(id)) {
      setPinned(activePins.filter((x) => x !== id))
      return
    }
    // 新置顶插到当前接口之后；超过 4 个就淘汰原来的末尾。
    const next = (current ? [current, id, ...activePins.filter((x) => x !== current)] : [id, ...activePins]).slice(0, 4)
    setPinned(next)
  }
  return h('div', null,
    h('div', { className: 'ab-choices', role: 'radiogroup' }, [
      ...visible.map((o) => {
        const on = o.value === value
        const pinnedNow = activePins.includes(o.value)
        return h('div', {
          key: o.value,
          role: 'radio',
          'aria-checked': on,
          tabIndex: 0,
          className: cx('ab-choice', on && 'on'),
          style: { position: 'relative', paddingRight: 36 },
          onClick: () => onChange(o.value),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(o.value) } },
        },
          h('b', null, o.icon || null, o.label), o.desc ? h('small', null, o.desc) : null,
          h('span', {
            className: cx('ab-choice-pin', pinnedNow && 'on'),
            role: 'button',
            tabIndex: 0,
            title: pinnedNow ? '取消置顶' : '置顶这个接口',
            'aria-label': (pinnedNow ? '取消置顶 ' : '置顶 ') + o.label,
            'aria-pressed': pinnedNow,
            style: { position: 'absolute', right: 8, top: 8, zIndex: 2 },
            onClick: (e) => { e.stopPropagation(); togglePin(o.value) },
            onKeyDown: (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault(); e.stopPropagation(); togglePin(o.value)
            },
          }, h(PinIcon, { filled: pinnedNow })))
      }),
      h('div', {
        key: '__more',
        className: 'ab-choice ab-choice-more',
        role: 'button',
        tabIndex: 0,
        onClick: () => setMore((v) => !v),
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMore((v) => !v) } },
      },
        h('b', null, more ? '收起' : '更多'),
        h('small', null, more ? '只看常用接口' : '还有 ' + Math.max(0, options.length - visible.length) + ' 个接口')),
    ]),
    h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '常用的声音来源可以置顶，最多四个。'))
}

const VOICE_SERVICES = { 'fish-free': 'Fish Audio', breeze: 'Breeze', edge: '微软在线语音', volcano: '豆包语音', minimax: 'MiniMax', cosyvoice: 'CosyVoice', gptsovits: 'GPT-SoVITS', http: '自定义 HTTP' }

function FishBalance() {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null)
  const check = async () => {
    setBusy(true)
    try { setResult(await get('/voice/fish-balances')) }
    finally { setBusy(false) }
  }
  return h(Row, { label: '账号余额' }, h('div', null,
    h(Btn, { small: true, disabled: busy, onClick: check }, busy ? '查询中…' : '查询已保存账号'),
    result && h('div', { role: 'status', style: { marginTop: 8 } }, result.ok && Array.isArray(result.rows) && result.rows.length ? [
      ...result.rows.map(({ name, wallet, pack }, i) => h('div', { key: i }, h('b', null, name), ' · API 余额：', wallet.error || ('$' + wallet.usd), ' · 套餐点数：', pack.error || (pack.remaining.toLocaleString() + ' / ' + pack.total.toLocaleString() + (pack.extra ? '，额外 ' + pack.extra.toLocaleString() : '')))),
      h('small', { className: 'ab-muted', key: 'note' }, '免费语音不扣 API 余额。Fish 未提供免费语音的剩余字数。'),
    ] : result.ok ? '还没有已保存的 Fish 密钥。' : '查询失败，请稍后重试。')))
}

function VoiceKeyPool({ id, draft, setDraft }) {
  const path = 'voice.keyPools.' + id
  const pool = getPath(draft, path) || {}, rows = pool.accounts || []
  let origin = ''
  if (id === 'http') { try { const u = new URL(draft.voice.http.urlTemplate); if (u.protocol === 'https:') origin = u.origin } catch {} }
  const update = (field, value) => setDraft(setPath(draft, path + '.' + field, value))
  const edit = (row, patch) => update('accounts', rows.map(a => a.id === row.id ? { ...a, ...patch } : a))
  return h('details', { className: 'ab-card ab-pool' }, h('summary', null, '多账号设置' + (rows.length ? ' · ' + rows.length + ' 个附加账号' : '')),
    h(Row, { label: '分配方式' }, h(Select, { ariaLabel: '分配方式', width: 230, value: pool.strategy || 'balanced', onChange: v => update('strategy', v), options: [
      { value: 'balanced', label: '均衡使用（推荐）', desc: '优先空闲账号，同样空闲就轮流用' },
      { value: 'ordered', label: id === 'http' ? '按添加顺序' : '优先主账号', desc: id === 'http' ? '先用排在前面的账号' : '主账号不可用时，按添加顺序使用' },
    ] })),
    ...rows.map((row, i) => h(Row, { key: row.id, label: '附加账号 ' + (i + 1), hint: id === 'http' && row.origin !== origin ? '服务地址已更换，请重新填写密钥。' : '' },
      h('input', { className: 'ab-input', 'aria-label': '账号备注 ' + (i + 1), placeholder: '账号备注（可选）', value: row.name || '', maxLength: 80, onChange: e => edit(row, { name: e.target.value }) }),
      h('input', { className: 'ab-input', type: 'password', autoComplete: 'new-password', 'aria-label': '附加密钥 ' + (i + 1), placeholder: row.apiKeySet ? '密钥已保存，留空不改' : '粘贴 API Key', value: row.apiKey || '', onChange: e => edit(row, { apiKey: e.target.value, ...(id === 'http' && { origin }) }) }),
      h(Btn, { small: true, onClick: () => update('accounts', rows.filter(a => a.id !== row.id)) }, '移除'))),
    id === 'http' && !origin ? h('span', { className: 'ab-muted' }, '先填写 HTTPS 服务地址。') : h(Btn, { small: true, onClick: () => update('accounts', [...rows, { id: globalThis.crypto?.randomUUID?.() || 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), name: '', apiKey: '', ...(id === 'http' && { origin }) }]) }, '添加账号'))
}

function VoiceServices({ selected, onSelect, extensions = [], st, draft, setDraft, toast, reload }) {
  const options = [...Object.entries(VOICE_SERVICES).map(([value, label]) => ({ value, label })), ...extensions.map(m => ({ value: 'ext:' + m.id, label: m.name || m.id }))]
  const active = options.find(o => o.value === selected) || options[0]
  const httpPool = active.value === 'http' && String(draft.voice.http?.headers || '').includes('{apiKey}')
  const poolId = httpPool ? 'http' : ['fish-free', 'minimax', 'volcano'].includes(active.value) || (active.value === 'breeze' && draft.voice.breeze?.mode !== 'local') ? active.value : null
  return h('div', { className: 'ab-grid ab-voice-services' },
    h('div', { className: 'ab-flex' }, h('b', null, '配置服务'), h(Select, { ariaLabel: '配置服务', options, value: active.value, onChange: onSelect, width: 220 })),
    active.value.startsWith('ext:')
      ? h(ExtPage, { key: active.value, mod: active.value.slice(4), st, draft, setDraft, toast, reload, embedded: true })
      : h(Card, { key: active.value, title: active.label }, h(VoiceServiceFields, { id: active.value, st, draft, setDraft, toast, reload })),
    poolId ? h(VoiceKeyPool, { key: 'pool:' + poolId, id: poolId, draft, setDraft }) : null)
}

function VoiceServiceFields({ id, st, draft, setDraft, toast, reload }) {
  const f = useField(draft, setDraft)
  if (id === 'edge') return [
    !st.voice.edgeInstalled ? h(Row, { key: 'i', label: 'edge-tts', hint: '装在插件自己的 Python 环境里，不影响系统' }, h(Btn, { small: true, onClick: async () => { toast('正在安装，可能要一两分钟…'); const r = await post('/voice/install'); toast(r.message); reload() } }, '安装 edge-tts')) : null,
    h(Row, { key: 'v', label: '音色' }, f.select('voice.voice', [
      { value: 'zh-CN-XiaoyiNeural', label: '晓伊', desc: '活泼女声', group: '普通话' }, { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓', desc: '温柔女声', group: '普通话' },
      { value: 'zh-CN-YunxiNeural', label: '云希', desc: '少年男声', group: '普通话' },
      { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北', desc: '东北女声', group: '方言' }, { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮', desc: '陕西女声', group: '方言' },
      { value: 'zh-TW-HsiaoChenNeural', label: '曉臻', desc: '台湾女声', group: '方言' }], { width: 220 })),
    h(Row, { key: 'r', label: '语速' }, f.select('voice.rate', [{ value: '-20%', label: '慢一点' }, { value: '-10%', label: '稍慢' }, { value: '+0%', label: '正常' }, { value: '+10%', label: '稍快' }, { value: '+20%', label: '快一点' }], { width: 140 })),
    h(Row, { key: 'p', label: '音调', hint: '只调整微软在线声音的高低。' },
      h(Range, {
        min: -80,
        max: 80,
        step: 10,
        value: pitchNum(draft.voice.pitch),
        fmt: pitchLabel,
        onChange: (v) => setDraft(setPath(draft, 'voice.pitch', pitchText(v))),
      })),
  ]
  if (id === 'cosyvoice') return [
    h(Row, { key: 'u', label: '服务地址', hint: '填写已启动的 CosyVoice 服务地址。' }, f.text('voice.cosyvoice.url', { size: 'wide', placeholder: 'http://127.0.0.1:50000' })),
    h(Row, { key: 'm', label: '模式' }, f.select('voice.cosyvoice.mode', [{ value: 'sft', label: '预置音色（sft）' }, { value: 'instruct', label: '带语气指令（instruct）' }], { width: 220 })),
    h(Row, { key: 's', label: '音色 ID', hint: '例如 中文女、中文男' }, f.text('voice.cosyvoice.spkId')),
    draft.voice.cosyvoice.mode === 'instruct' ? h(Row, { key: 'i', label: '语气指令', hint: '例如：用甜美撒娇的语气说' }, f.text('voice.cosyvoice.instruct', { size: 'wide' })) : null,
    h(Row, { key: 'r', label: '采样率', hint: 'CosyVoice 1 是 22050，CosyVoice 2 是 24000' }, f.select('voice.cosyvoice.sampleRate', [{ value: 22050, label: '22050 Hz' }, { value: 24000, label: '24000 Hz' }], { width: 160 })),
  ]
  if (id === 'gptsovits') return [
    h(Row, { key: 'u', label: '服务地址', hint: '填写已启动的 GPT-SoVITS v2 服务地址。' }, f.text('voice.gptsovits.url', { size: 'wide', placeholder: 'http://127.0.0.1:9880' })),
    h(Row, { key: 'a', label: '参考音频路径', hint: '服务那台电脑上的路径' }, f.text('voice.gptsovits.refAudio', { size: 'wide' })),
    h(Row, { key: 'p', label: '参考音频的文字' }, f.text('voice.gptsovits.promptText', { size: 'wide' })),
  ]
  if (id === 'fish-free') return h(Fragment, null,
    h(Row, { label: 'API 密钥', hint: draft.voice.fishApiKeySet ? '' : '已在 DSH 配过密钥可留空。' },
      h('input', { className: 'ab-input wide', type: 'password', autoComplete: 'new-password', 'aria-label': 'Fish API Key', value: draft.voice.fishApiKey || '', placeholder: draft.voice.fishApiKey === null ? '保存后移除' : draft.voice.fishApiKeySet ? '已保存，留空不改' : '粘贴 Fish API Key', onChange: e => setDraft(setPath(draft, 'voice.fishApiKey', e.target.value)) }),
      h('a', { href: 'https://fish.audio/app/developers/get-started/', target: '_blank', rel: 'noreferrer', className: 'ab-btn sm' }, '获取密钥 ↗'),
      draft.voice.fishApiKeySet ? h(Btn, { small: true, onClick: () => setDraft(setPath(draft, 'voice.fishApiKey', draft.voice.fishApiKey === null ? '' : null)) }, draft.voice.fishApiKey === null ? '撤销移除' : '移除已存密钥') : null),
    h(Row, { label: '音色 ID', hint: '留空使用默认声音。' }, f.text('voice.fishReferenceId', { size: 'wide', placeholder: '音色 ID（32 位）' })), h(FishBalance))
  if (id === 'volcano') return h(VolcanoVoice, { key: 'volcano', draft, setDraft })
  if (id === 'breeze') return [
    (() => {
      // 缺东西时先提示（不拦保存）：不然只有点「试听」才报错，还看不懂缺哪个
      const b = draft.voice.breeze || {}
      const miss = b.mode === 'local'
        ? (!String(b.url || '').trim() ? ['服务地址'] : [])
        : [
          !String(b.key || '').trim() && !b.keySet && !draft.voice.keyPools?.breeze?.accounts?.some(a => a.apiKeySet || a.apiKey) ? 'API Key' : '',
          !String(b.voiceId || '').trim() ? '音色 id' : '',
        ].filter(Boolean)
      const localDown = b.mode === 'local' && !String(b.url || '').trim()
      return miss.length
        ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } },
          '还差：' + miss.join('、') + '。不填的话说话会退回 系统语音（照常发声，只是不是 Breeze 的音色）。',
          localDown ? '本地模式要先把 breeze_infer 跑起来，地址填它的 /v1 前缀（例如 http://127.0.0.1:7860）。' : '')
        : null
    })(),
    h(Row, { key: 'mode', label: '模式', hint: '云端走 BreezeBlue 官方接口；本地走自己跑的 breeze_infer' }, h(Select, {
      width: 240,
      value: draft.voice.breeze?.mode || 'cloud',
      options: [{ value: 'cloud', label: '云端（BreezeBlue）' }, { value: 'local', label: '本地自建（breeze_infer）' }],
      // 切模式时顺手把服务地址换成对应的默认值（自己填过的自定义地址不动）
      onChange: (v) => {
        const cur = String(draft.voice.breeze?.url || '').trim()
        const defaults = ['', 'https://api.breeze.blue', 'http://127.0.0.1:7860']
        const url = defaults.includes(cur) ? (v === 'local' ? 'http://127.0.0.1:7860' : 'https://api.breeze.blue') : cur
        setDraft(setPath(setPath(draft, 'voice.breeze.mode', v), 'voice.breeze.url', url))
      },
    })),
    h(Row, { key: 'u', label: '服务地址', hint: '云端填 https://api.breeze.blue；自建就填自己的地址' }, f.text('voice.breeze.url', { size: 'wide', placeholder: 'https://api.breeze.blue' })),
    draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'k', label: 'API Key', hint: 'Breeze 控制台 → API Keys 生成，brz_ 开头；已保存就不回显' }, f.text('voice.breeze.key', { type: 'password', placeholder: draft.voice.breeze?.keySet ? '已保存' : 'brz_…', size: 'wide' })),
    draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'v', label: '音色 id', hint: '从音色库复制，或点下方「列出音色」选择。' }, f.text('voice.breeze.voiceId', { size: 'wide', placeholder: 'voc_…' })),
    draft.voice.breeze?.mode === 'local' ? null : h(BreezeVoices, { key: 'voices', b: draft.voice.breeze, draft, setDraft }),
    h('details', { key: 'tuning', className: 'ab-voice-options' }, h('summary', null, 'Breeze 声音微调'),
      h(Row, { key: 'm', label: '模型', hint: '默认 breeze-tts-2' }, f.text('voice.breeze.model', { placeholder: 'breeze-tts-2' })),
      h(Row, { key: 'l', label: '语种' }, f.text('voice.breeze.languageCode', { placeholder: 'zh' })),
      draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'i', label: '语气说明', hint: '本地模式用：这段描述就是音色设计（voice design），不填就用模型默认声音' }, f.text('voice.breeze.instructions', { size: 'wide', placeholder: '清亮柔软、略带奶气的普通话少女音' })) : null,
      draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'g', label: '指令遵循强度', hint: '数值越高，声音越接近你的描述。' }, f.range('voice.breeze.guidanceScale', 0, 10, 0.5, (v) => (String(v || '4')))) : null,
    ),
    draft.voice.breeze?.mode === 'local' ? null : h('details', { key: 'quota-settings', className: 'ab-voice-options' }, h('summary', null, '每日额度与签到'),
      h(Row, { key: 'em', label: '账号邮箱', hint: '填了才能自动领每日额度（免费额度约 250 句短话）' }, f.text('voice.breeze.email', { size: 'wide', placeholder: 'you@example.com' })),
      h(Row, { key: 'pw', label: '账号密码', hint: '存在本机 config.json（和别的密钥一样，面板里不回显）；留空 = 用已保存的' }, f.text('voice.breeze.password', { type: 'password', placeholder: draft.voice.breeze?.passwordSet ? '已保存' : '不填就不自动领额度' })),
      h(Row, { key: 'ac', label: '自动领每日额度', hint: '每小时醒一次，一天最多领一次；失败只记日志' }, f.sw('voice.breeze.autoClaim')),
      h(BreezeQuota, { key: 'quota', b: draft.voice.breeze, toast }),
    ),
  ]
  if (id === 'minimax') return [
    (() => {
      // 缺东西时先提示（不拦保存）：不然只有点「试听」才报错，还看不懂缺哪个
      const m = draft.voice.minimax || {}
      const miss = [
        !String(m.apiKey || '').trim() && !m.apiKeySet && !draft.voice.keyPools?.minimax?.accounts?.some(a => a.apiKeySet || a.apiKey) ? 'API Key' : '',
        !String(m.voiceId || '').trim() ? 'Voice ID' : '',
      ].filter(Boolean)
      return miss.length
        ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } },
          '还差：' + miss.join('、') + '。不填的话说话会退回 系统语音（照常发声，只是不是 MiniMax 的音色）。')
        : null
    })(),
    h(Row, { key: 'k', label: 'API Key', hint: 'MiniMax 开放平台「接口密钥」里创建；只存在本机' }, f.text('voice.minimax.apiKey', { size: 'wide', type: 'password', placeholder: draft.voice.minimax?.apiKeySet ? '已保存（不改就留空）' : 'sk-api-…' })),
    h(Row, { key: 'l', label: '开放平台', hint: '还没注册就先注册；拿 Key 在「接口密钥」页' },
      h('div', { className: 'ab-flex' },
        h('a', { href: 'https://platform.minimax.cn/console/home', target: '_blank', rel: 'noreferrer' }, '注册 / 登录开放平台 ↗'),
        h('span', { className: 'ab-muted' }, '·'),
        h('a', { href: 'https://platform.minimax.cn/audio/voices', target: '_blank', rel: 'noreferrer' }, '音色库（试听后复制 Voice ID）↗'))),
    h(Row, { key: 'v', label: 'Voice ID', hint: '音色库右侧「复制 Voice ID」；声音设计 / 复刻拿到的自定义 id 也填这里' }, f.text('voice.minimax.voiceId', { size: 'wide', placeholder: 'Chinese (Mandarin)_Soft_Girl' })),
    h('details', { key: 'tuning', className: 'ab-voice-options' }, h('summary', null, 'MiniMax 声音与服务设置'),
      h(Row, { key: 'm', label: '模型' }, f.select('voice.minimax.model', [{ value: 'speech-2.8-turbo', label: '2.8 Turbo（快、便宜）' }, { value: 'speech-2.8-hd', label: '2.8 HD（更细腻）' }, { value: 'speech-2.6-turbo', label: '2.6 Turbo（没有语气词）' }, { value: 'speech-2.6-hd', label: '2.6 HD（没有语气词）' }], { width: 220 })),
      h(Row, { key: 'e', label: '情绪', hint: '选「自动」会按文字判断。' }, f.select('voice.minimax.emotion', [{ value: 'auto', label: '自动' }, { value: 'happy', label: '高兴' }, { value: 'sad', label: '难过' }, { value: 'angry', label: '生气' }, { value: 'fearful', label: '害怕' }, { value: 'disgusted', label: '嫌弃' }, { value: 'surprised', label: '惊讶' }, { value: 'calm', label: '平静' }], { width: 160 })),
      h(Row, { key: 's', label: '语速' }, f.range('voice.minimax.speed', 0.5, 2, 0.05, (v) => (Number(v) || 1).toFixed(2) + '×')),
      h(Row, { key: 'p', label: '语调' }, f.range('voice.minimax.pitch', -12, 12, 1, (v) => (Number(v) > 0 ? '+' : '') + (Number(v) || 0))),
      h(Row, { key: 'b', label: '服务地址', hint: '国内用 api.minimax.cn；海外账号改 api.minimax.io' }, f.text('voice.minimax.baseUrl', { size: 'wide', placeholder: 'https://api.minimax.cn' })),
    ),
  ]
  if (id === 'http') return [
    h(Row, { key: 'u', label: '接口地址', hint: 'GET：地址里带 {text}；POST：填接口地址就行' }, f.text('voice.http.urlTemplate', { size: 'wide', placeholder: 'https://openspeech.bytedance.com/api/v1/tts' })),
    h(Row, { key: 'm', label: '请求方式' }, f.select('voice.http.method', [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }], { width: 140 })),
    h(Row, { key: 'h', label: '请求头', hint: '每行一项。多账号可填 Authorization: Bearer {apiKey}。' }, f.area('voice.http.headers', { size: 'wide', rows: 2, placeholder: 'Authorization: Bearer;你的token' })),
    String((draft.voice.http || {}).method || 'GET').toUpperCase() !== 'GET'
      ? h(Row, { key: 'b', label: '请求体', hint: '{text} 换成要念的话（自动转义），{reqid} 换成每次不同的随机串' }, f.area('voice.http.body', { size: 'wide', rows: 6, placeholder: '{"app":{"appid":"你的appid","token":"随便填","cluster":"volcano_tts"},"user":{"uid":"aurabot"},"audio":{"voice_type":"zh_female_wanwanxiaohe_moon_bigtts","encoding":"mp3"},"request":{"reqid":"{reqid}","text":"{text}"}}' }))
      : null,
  ]
  return null
}

function Voice({ st, draft, setDraft, toast, reload, configure }) {
  const f = useField(draft, setDraft)
  const voiceDirty = Boolean(st && st.config) && JSON.stringify(draft.voice) !== JSON.stringify(st.config.voice)
  const [txt, setTxt] = useState('晚安啦，今天也辛苦了，明天见～')
  const [src, setSrc] = useState('')
  const source = draft.voice.engine === 'auto' ? 'edge' : draft.voice.engine
  const engineOptions = [
    { value: 'auto', label: '自动', desc: '先用微软在线语音，不可用时用 Windows 声音' },
    { value: 'edge', label: '微软 edge-tts', desc: st.voice.edgeInstalled ? '在线，音色自然（已装好）' : '在线，音色自然（还没装）' },
    { value: 'cosyvoice', label: '本地 CosyVoice', desc: '自己部署的 CosyVoice 服务，可克隆音色' },
    { value: 'gptsovits', label: '本地 GPT-SoVITS', desc: '用自己准备的录音定音色' },
    { value: 'volcano', label: '豆包语音（火山）', desc: '只填 API Key，选个音色就行' },
    { value: 'fish-free', label: 'Fish Audio', desc: 'S2.1 Pro Free，可选音色' },
    { value: 'breeze', label: 'Breeze 语音', desc: 'BreezeBlue 云端或自建，填 Key + 音色 id' },
    { value: 'minimax', label: 'MiniMax 语音', desc: '在线，音色多，支持自定义音色和情绪' },
    { value: 'http', label: '其他 HTTP 接口', desc: '任意返回音频的地址' },
    { value: 'windows', label: 'Windows 自带', desc: '离线可用，机械感重一些' },
  ]
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '说话（文字转语音）', right: f.sw('voice.enabled', { title: '允许发送语音' }), desc: '选好声音可以先试听，保存后用于聊天。' },
      voiceDirty ? h('div', { className: 'ab-note' }, '有未保存的改动，聊天仍使用之前的声音。') : null,
      h('div', { style: { margin: '4px 0 12px' } }, h(VoiceEngineChoices, {
        options: engineOptions,
        value: draft.voice.engine,
        active: st && st.config && st.config.voice ? st.config.voice.engine : '',
        onChange: (v) => setDraft(setPath(draft, 'voice.engine', v)),
        toast,
      })),
      VOICE_SERVICES[source] ? h(Btn, { small: true, onClick: () => configure(source) }, '配置 ' + VOICE_SERVICES[source]) : null,
      h(Row, { label: '试听', hint: '试听当前选择，不用先保存。' },
        h('input', { className: 'ab-input', 'aria-label': '试听文字', value: txt, onChange: (e) => setTxt(e.target.value) }),
        h(Btn, { small: true, onClick: async () => {
          setSrc('')
          const r = await post('/voice/test', { text: txt, voice: draft.voice })
          if (r.ok) setSrc('data:' + r.mime + ';base64,' + r.data)
          else toast(r.message)
        } }, '播放试听'),
        src ? h('audio', { key: src, src, controls: true, autoPlay: true, style: { height: 32 } }) : null),
    ),
    // 低频参数收进折叠卡：默认不展开，展开区才挂载（不展开就不渲染、不注册控件）
    h(Card, { title: '什么时候发语音', collapsible: true, defaultOpen: false },
      h(Row, { label: '短回复变语音的概率' }, f.percent('voice.autoChance')),
      h(Row, { label: '多短算短回复' }, f.range('voice.autoMaxChars', 10, 200, 5, (v) => v + ' 字')),
      h(Row, { label: '表情和语音分开发', hint: '开启后，表情会作为文字另发；关闭后跳过表情。' }, f.sw('voice.emojiSeparate'))),
    // 语音条变声（翻唱音色）属于低频功能：收进默认收起的折叠卡，
    // 展开才挂载 VoiceSongModel，从而延迟 GET /voice/song-voices —— 不进语音页首屏。
    h(Card, { title: '语音条变声（用翻唱音色）', desc: '选用已导入的翻唱音色。不选就保留原声。', collapsible: true, defaultOpen: false },
      h(VoiceSongModel, { draft, setDraft, flat: true })),
  )
}

/**
 * 语音页外壳：发语音 / 听语音 / 扩展服务三个子视图共用一个页签。
 * 关键约束：听语音（Asr）只在 view==='listen' 时挂载——不挂载即不发请求、不跑轮询。
 */

function VoiceTab({ voiceView, setVoiceView, st, draft, setDraft, toast, reload, extensions = [] }) {
  const [service, setService] = useState('fish-free')
  const configure = id => { setService(id); setVoiceView('services') }
  const seg = h('div', { className: 'ab-seg', role: 'tablist', 'aria-label': '语音子视图' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': voiceView === 'send', className: cx(voiceView === 'send' && 'on'), onClick: () => setVoiceView('send') }, '发语音'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': voiceView === 'listen', className: cx(voiceView === 'listen' && 'on'), onClick: () => setVoiceView('listen') }, '听语音'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': voiceView === 'services', className: cx(voiceView === 'services' && 'on'), onClick: () => setVoiceView('services') }, '扩展服务'))
  return h('div', null,
    h('div', { className: 'ab-flex', style: { margin: '0 0 12px' } }, seg),
    voiceView === 'listen'
      ? h(Asr, { draft, setDraft, toast })
      : voiceView === 'services' ? h(VoiceServices, { selected: service, onSelect: setService, extensions, st, draft, setDraft, toast, reload })
      : h(Voice, { st, draft, setDraft, toast, reload, configure }))
}

/** 语音识别：作为「语音」页的「听语音」子视图渲染（不再单独占页签）。 */

function Asr({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '听语音（语音转文字）', right: f.sw('voice.asr'), desc: '别人发来的语音会先转成文字再交给ta：本地接口 → QQ 自带转文字 → 云端识别（可选）→ DSH 自带识别。任何一层失败都会继续试下一层。' },
      h(Row, { label: '云端识别', hint: '可选；不选就维持原来的顺序（本地 → QQ → DSH）' },
        f.select('voice.asrApi.provider', [
          { value: '', label: '不用云端识别' },
          { value: 'siliconflow', label: '硅基流动' },
          { value: 'openai', label: 'OpenAI' },
          { value: 'custom', label: '自定义 OpenAI 兼容' },
        ], { width: 220 })),
      draft.voice.asrApi?.provider ? [
        h(Row, { key: 'u', label: '服务地址', hint: '只填到 /v1，不要带 /audio/transcriptions；留空用预置：硅基 https://api.siliconflow.cn/v1；OpenAI https://api.openai.com/v1' },
          f.text('voice.asrApi.baseUrl', { size: 'wide', placeholder: draft.voice.asrApi.provider === 'siliconflow' ? 'https://api.siliconflow.cn/v1' : draft.voice.asrApi.provider === 'openai' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:8000/v1' })),
        h(Row, { key: 'm', label: '模型', hint: '留空用预置：硅基 FunAudioLLM/SenseVoiceSmall；OpenAI whisper-1。换 XingChenASR 要带完整 ID：XingChenAGI/XingChenASR-V3.2-Ultra' },
          f.text('voice.asrApi.model', { size: 'wide', placeholder: draft.voice.asrApi.provider === 'siliconflow' ? 'FunAudioLLM/SenseVoiceSmall' : draft.voice.asrApi.provider === 'openai' ? 'whisper-1' : 'whisper-1' })),
        h(Row, { key: 'k', label: 'API Key', hint: '只存在本机，面板不回显；本地服务可留空' },
          f.text('voice.asrApi.apiKey', { type: 'password', placeholder: draft.voice.asrApi?.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
        h(Row, { key: 'l', label: '语言', hint: '可留空；只对支持 language 的模型有效' },
          f.text('voice.asrApi.language', { placeholder: 'zh' })),
        h(Row, { key: 'p', label: '先用谁', hint: 'QQ 通常 1~2 秒；硅基 SenseVoice 实测约 14 秒，建议先 QQ' },
          f.select('voice.asrApi.prefer', [{ value: 'qq', label: '先 QQ 自带（推荐）' }, { value: 'cloud', label: '先云端识别' }], { width: 220 })),
        h(Row, { key: 't', label: '测试', hint: '先用内置语音念一句，再交给云端识别；用当前页面设置，没保存也生效' },
          h(Btn, { small: true, onClick: async () => {
            toast('正在合成并识别，可能要十几秒…')
            const r = await post('/voice/asr-provider-test', { text: '今天想吃白米饭', voice: draft.voice })
            toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」' : r.message)
          } }, '测试云端识别')),
      ] : null,
      h(AsrStatus, { toast })),
  )
}

function AsrStatus({ toast }) {
  const [s, setS] = useState(null)
  const load = () => get('/voice/asr-status').then(setS)
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  const phase = s && s.enabled ? ({ ready: '已就绪', standby: '已就绪（休眠中）', idle: '还没下载模型', preparing: '正在下载模型…', downloading: '正在下载模型…', failed: '下载失败' }[s.phase] || s.phase) : null
  return h('div', { className: 'ab-flex' },
    h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', s && s.enabled && ['ready', 'standby'].includes(s.phase) ? 'ok' : s && s.enabled ? 'warn' : '') }), s === null ? '查询中…' : s.enabled ? 'DSH 识别：' + phase : 'DSH 识别：没开启（DSH「插件」→「语音输入」）'),
    s && s.enabled && !['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, onClick: async () => { const r = await post('/voice/asr-prepare'); toast(r.message); load() } }, '下载识别模型') : null,
    s && s.enabled && ['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, onClick: async () => { toast('正在测试…'); const r = await post('/voice/asr-test', { text: '今天想吃白米饭' }); toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」' : r.message) } }, '测试一下') : null)
}

export { BreezeVoices, BreezeQuota, VolcanoVoice, VoiceEngineChoices, VOICE_SERVICES, FishBalance, VoiceKeyPool, VoiceServices, VoiceServiceFields, Voice, VoiceTab, Asr, AsrStatus }
