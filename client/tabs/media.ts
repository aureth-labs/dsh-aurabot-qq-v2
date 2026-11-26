import { useState, useEffect, useRef, Fragment } from '../core/react.ts'
import { post } from '../core/api.ts'
import { setPath } from '../core/format.ts'
import { Btn, Card, Row, Seg, Select, h, useField } from '../core/ui.ts'
import { CodexSub, PaintGallery } from './content.ts'
import { ExtPanel } from './modules.ts'

// 官方推荐（赞助商）地址：固定第一项，面板里不可删；官网从这里跳
const SPONSOR_BASE = 'https://ntmd.cn/v1'

const SPONSOR_SITE = 'https://ntmd.cn'

// 生视频：本地脚本 / MiniMax / 自定义异步任务；确认、扩写、抽帧是三种接口通用的
function Video({ st, draft, setDraft, toast, reload }) {
  const f = useField(draft, setDraft)
  const v = draft.video || {}
  const provider = v.provider || 'local'
  const localOn = !!(draft.local && draft.local.video)
  return h('div', { className: 'ab-grid' },
    h(Card, {
      title: '生视频',
      desc: '她可以按描述生成一段视频。选好接口、填好参数，然后在聊天里让她「生成一段视频：…」。生成本身很慢，做好会自动发到聊天。',
    },
      h('div', { style: { margin: '4px 0 12px' } }, f.choices('video.provider', [
        { value: 'local', label: '本地脚本', desc: localOn ? '走本地接口 video.mjs（ComfyUI 等，已开启）' : '走本地接口 video.mjs（ComfyUI 等，还没开启）' },
        { value: 'minimax', label: 'MiniMax H3', desc: '云端异步任务，按秒计费' },
        { value: 'custom', label: '自定义接口', desc: '任何「创建任务 → 轮询 → 结果地址」的接口' },
      ])),
      provider === 'local' ? h(Row, { label: '本地接口', hint: '去「系统 → 本地接口」把「生视频」打开，并写好 video.mjs 脚本' },
        h(Btn, { small: true, onClick: () => toast(localOn ? '「生视频」本地接口已开启' : '请先到「系统 → 本地接口」打开「生视频」', localOn ? 'ok' : 'err') }, localOn ? '已开启' : '还没开启')) : null,
      provider === 'minimax' ? [
        h(Row, { key: 'k', label: 'API Key', hint: 'MiniMax 开放平台「接口密钥」；只存在本机配置里' }, f.text('video.minimax.apiKey', { size: 'wide', type: 'password', placeholder: v.minimax && v.minimax.apiKeySet ? '已保存（不改就留空）' : 'sk-api-…' })),
        h(Row, { key: 'm', label: '模型' }, f.select('video.minimax.model', [
          { value: 'MiniMax-H3', label: 'H3（质量优先，支持 2K）' },
          { value: 'MiniMax-H3-Highspeed', label: 'H3 Highspeed（快）' },
          { value: 'MiniMax-H3-Lite', label: 'H3 Lite（便宜）' },
          { value: 'MiniMax-H3-Max', label: 'H3 Max（极速，5 秒起）' },
        ], { width: 260 })),
        h(Row, { key: 'r', label: '分辨率' }, f.select('video.minimax.resolution', [
          { value: '480P', label: '480P' }, { value: '768P', label: '768P' }, { value: '2K', label: '2K（仅 H3）' },
        ], { width: 160 })),
        h(Row, { key: 'd', label: '默认时长', hint: '4~15 秒；H3 Max 5 秒起' }, f.num('video.minimax.duration', { min: 4, max: 15 })),
        h(Row, { key: 'a', label: '画面比例' }, f.select('video.minimax.ratio', [
          { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '4:3', label: '4:3' },
          { value: '3:4', label: '3:4' }, { value: '1:1', label: '1:1' }, { value: '21:9', label: '21:9' },
        ], { width: 140 })),
        h(Row, { key: 'b', label: '服务地址', hint: '国内用 api.minimax.cn；海外账号改 api.minimax.io' }, f.text('video.minimax.baseUrl', { size: 'wide', placeholder: 'https://api.minimax.cn' })),
      ] : null,
      provider === 'custom' ? [
        h(Row, { key: 'cu', label: '创建地址', hint: '创建任务的地址；可用 {prompt} {seconds} {image} {reqid}' }, f.text('video.custom.createUrl', { size: 'wide', placeholder: 'https://api.example.com/v1/videos' })),
        h(Row, { key: 'cm', label: '创建方式' }, f.select('video.custom.createMethod', [{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }], { width: 120 })),
        h(Row, { key: 'ch', label: '请求头', hint: '一行一个「Key: Value」，例如 Authorization: Bearer xxx' }, f.area('video.custom.headers', { size: 'wide', rows: 2, placeholder: v.custom && v.custom.headersSet ? '已保存（不改就留空）' : 'Authorization: Bearer xxx' })),
        h(Row, { key: 'cb', label: '请求体', hint: 'POST 时发这个 JSON；可用 {prompt} {seconds} {image} {reqid}' }, f.area('video.custom.body', { size: 'wide', rows: 5, placeholder: '{"prompt":"{prompt}","duration":{seconds}}' })),
        h(Row, { key: 'ct', label: '任务 ID 路径', hint: '从创建结果里取任务 ID，例如 task_id 或 task.id' }, f.text('video.custom.taskIdPath', { placeholder: 'task_id' })),
        h(Row, { key: 'cq', label: '轮询地址', hint: '可用 {taskId}' }, f.text('video.custom.queryUrl', { size: 'wide', placeholder: 'https://api.example.com/v1/videos/{taskId}' })),
        h(Row, { key: 'cs', label: '状态路径' }, f.text('video.custom.statusPath', { placeholder: 'status' })),
        h(Row, { key: 'cv', label: '成功 / 失败状态值', hint: '成功一个值，失败可逗号分隔多个' },
          h('div', { className: 'ab-flex' }, f.text('video.custom.successValue', { placeholder: 'succeeded' }), f.text('video.custom.failValue', { placeholder: 'failed,cancelled' }))),
        h(Row, { key: 'cr', label: '结果地址路径', hint: '视频 URL 在返回 JSON 里的路径' }, f.text('video.custom.urlPath', { size: 'wide', placeholder: 'content.url' })),
        h(Row, { key: 'cp', label: '轮询间隔（毫秒）' }, f.num('video.custom.pollMs', { min: 1000, max: 60000, step: 1000 })),
      ] : null,
      h(Row, { label: '生成前先确认', hint: '先把描述发给对方，回复「确认」才真的生成；按秒计费的接口建议开' }, f.sw('video.confirm')),
      h(Row, { label: '提示词扩写', hint: '先让模型把一句话场景扩成分镜提示词（镜头/主体/光线/风格）' }, f.sw('video.enhance')),
      h(Row, { label: '生成后抽帧自检', hint: '抽 4 帧看懂画面，之后聊天里她记得自己做了什么视频' }, f.sw('video.selfView')),
      h(Row, { label: '最长等多久（分钟）', hint: '三种接口共用这一项' }, f.num('local.videoTimeoutMin', { min: 1, max: 120 })),
    ),
  )
}

function ImageGen({ st, draft, setDraft, toast, reload }) {
  const f = useField(draft, setDraft)
  const c = draft.imageGen
  // 扩展模块「生图 · DSH 已接入模型」（id: dsh-image）自带面板和设置。以前它在同一个
  // 「生图」页下面再单独占一张卡，等于同一个开关 / 模型下拉出现两遍；现在把它收进
  // 「接口格式」当第五种接法，只在这一处出现（面板本身仍然由模块自己的 panel.js 画）。
  const dshMod = ((st && st.modules) || []).find((m) => m.id === 'dsh-image' && m.running)
  const dshDraft = { ...((dshMod && dshMod.defaults) || {}), ...(((draft.ext || {})['dsh-image']) || {}) }
  const dshReady = Boolean(dshMod) && dshDraft.enabled === true && String(dshDraft.target || '') !== ''
  // 模块设置写在 ext.dsh-image 里：跟着这个页面的草稿一起改，随「保存设置」落盘。
  const setDshSettings = (patch) => setDraft((previous) => ({ ...previous, ext: { ...previous.ext, 'dsh-image': { ...((previous.ext || {})['dsh-image']), ...patch } } }))
  // 模块面板里的保存也走草稿：面板自己不做 toast 提示，这里补一句，省得以为没生效。
  const saveDsh = (patch) => { setDshSettings(patch); toast('已改，记得点「保存设置」'); return Promise.resolve({ ok: true }) }
  const [testing, setTesting] = useState('')
  const [results, setResults] = useState({})
  // 「获取模型」按当前服务地址拉 /models；列表只是候选，手填模型名始终可用。
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const modelSource = `${c.provider}|${c.baseUrl}|${c.apiKeySet ? 1 : 0}`
  useEffect(() => { setModels([]); setModelsError('') }, [modelSource])
  const fetchModels = async () => {
    setModelsLoading(true); setModelsError('')
    try {
      const r = await post('/image/models', { imageGen: c })
      const list = Array.isArray(r.models) ? r.models : []
      if (r.ok !== true) { setModels([]); setModelsError(r.message || '获取失败'); toast(r.message || '获取模型失败', 'err'); return }
      setModels(list)
      setModelsError(list.length ? '' : '接口没有返回任何模型')
      toast(list.length ? `找到 ${list.length} 个模型，点下面的列表选择` : '接口没有返回任何模型', list.length ? 'ok' : 'err')
    } finally { setModelsLoading(false) }
  }
  const modelField = () => h(Fragment, null,
    h(Row, { label: '模型' }, h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap' } },
      f.text('imageGen.model', { size: 'wide', placeholder: '例如 Kwai-Kolors/Kolors' }),
      h(Btn, { small: true, disabled: modelsLoading, onClick: fetchModels, title: '按上面的服务地址和 API Key 拉一次 /models' }, modelsLoading ? '获取中…' : '获取模型'))),
    models.length ? h(Row, { label: '可用模型', hint: '点选后填入上面的模型名；也可以继续手动输入' },
      h(Select, { value: models.includes(c.model) ? c.model : '', options: models.map((id) => ({ value: id, label: id })), width: 360, placeholder: '从获取到的模型里选择', onChange: (v) => setDraft(setPath(draft, 'imageGen.model', v)) })) : null,
    modelsError ? h('div', { className: 'ab-note err', role: 'alert', style: { marginTop: -4, marginBottom: 8 } }, '获取模型失败：' + modelsError) : null)
  const snapshot = JSON.stringify(c); const current = useRef(snapshot); current.current = snapshot
  useEffect(() => { setResults({}) }, [snapshot])
  const test = async (id) => {
    const key = id || 'primary'; const version = snapshot
    setTesting(key); setResults(old => ({ ...old, [key]: { pending: true, message: '正在测试，生图可能需要几分钟…' } }))
    try { const r = await post('/image/test', { id, imageGen: c }); const result = current.current !== version ? { ok: false, message: '测试期间配置已更改，请重新测试。' } : { ok: r.ok === true, message: r.message || (r.ok ? '生图成功' : '测试失败') }; setResults(old => ({ ...old, [key]: result })); toast(result.message, result.ok ? 'ok' : 'err') }
    finally { setTesting('') }
  }
  const testButton = (id) => { const key = id || 'primary'; const r = results[key]; return h('div', { className: 'ab-flex', style: { gap: 8, marginTop: 6, flexWrap: 'wrap' } }, h(Btn, { small: true, disabled: Boolean(testing), onClick: () => test(id) }, testing === key ? '测试中…' : '测试生图'), r ? h('span', { className: 'ab-small', role: 'status', style: { color: r.pending ? 'var(--ab-warn)' : r.ok ? 'var(--ab-ok)' : 'var(--ab-err)', fontWeight: 600 } }, r.pending ? r.message : (r.ok ? '✓ 测试成功：' : '✗ ') + r.message) : null) }
  const fallbacks = Array.isArray(c.fallbacks) ? c.fallbacks : []
  const setFallbacks = next => setDraft(setPath(draft, 'imageGen.fallbacks', next))
  const setFallback = (i, k, value) => setFallbacks(fallbacks.map((e, j) => j === i ? { ...e, [k]: value } : e))
  const moveFallback = (i, step) => { const next = fallbacks.slice(); const j = i + step; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; setFallbacks(next) }
  const custom = c.custom || {}
  // 模块已经就绪（开着 + 选了模型）时优先停在它那页：实际生图就是它先接管，界面要和行为一致。
  const [tab, setTab] = useState(() => dshReady ? 'dsh' : c.provider === 'codex' ? 'codex' : c.provider === 'custom' ? 'custom' : c.provider === 'minimax' ? 'minimax' : c.baseUrl === SPONSOR_BASE ? 'sponsor' : 'openai')
  const isCustom = tab === 'custom'
  const isCodex = tab === 'codex'
  const isMinimax = tab === 'minimax'
  const mm = c.minimax || {}
  const isPost = custom.method === 'POST'
  const params = Array.isArray(custom.params) ? custom.params : []
  const setParams = (next) => setDraft(setPath(draft, 'imageGen.custom.params', next))
  const setP = (i, k, v) => setParams(params.map((p, j) => (j === i ? { ...p, [k]: v } : p)))
  const [sponsorHintClosed, setSponsorHintClosed] = useState(false)
  const sponsorSelected = c.baseUrl === SPONSOR_BASE
  const sponsorOptions = [{ value: SPONSOR_BASE, label: '国粹 · ntmd.cn · 0.04/张（官方推荐赞助商）' }]
  const changeTab = (v) => {
    setTab(v)
    // DSH 模型这条路不写内置生图的 provider：它的开关和模型在模块自己的设置里，
    // 切过去再切回来，原来填的服务地址 / Key 不该被顺手改掉。
    if (v === 'dsh') return
    if (v === 'sponsor') {
      setDraft(setPath(draft, 'imageGen.provider', 'openai'))
      setSponsorHintClosed(false)
    } else {
      setDraft(setPath(draft, 'imageGen.provider', v))
    }
  }
  const pickSponsor = (v) => {
    setDraft({ ...draft, imageGen: { ...draft.imageGen, provider: 'openai', baseUrl: v } })
    setSponsorHintClosed(false)
    toast('已选官方推荐地址，记得保存')
  }
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '让ta画图', right: f.sw('imageGen.enabled'), desc: '接上生图服务后，让ta「画一张……」就会画好发出来。可选 OpenAI 兼容接口、自定义接口、登录 ChatGPT 使用实验性 Codex 订阅接法、MiniMax H3（多图参考 / 一次多张），或直接用 DSH 里已接入的生图模型（豆包 Seedream 等）。本机 SD WebUI / ComfyUI 可在「本地接口」页接「生图」。也可以让ta照着最近发的图、引用消息里的图或自己的画作来改；服务不支持参考图时会明确告诉你。' },
      h(Row, { label: '接口格式', hint: '第二个适合 pollinations 这类「GET 一个地址就出图」的服务' },
        h(Seg, {
          value: tab,
          onChange: changeTab,
          // 「DSH 已接入模型」只在模块真的装了并在跑时才出现：没装就别摆一个点进去是空的按钮。
          options: [{ value: 'openai', label: 'OpenAI 格式' }, { value: 'custom', label: '自定义接口' }, { value: 'codex', label: 'Codex 订阅（实验性）' }, { value: 'minimax', label: 'MiniMax H3' }, { value: 'sponsor', label: '官方推荐地址' }, ...((dshMod || tab === 'dsh') ? [{ value: 'dsh', label: 'DSH 已接入模型' }] : [])],
        })),
      tab === 'sponsor' ? h('div', null,
        sponsorSelected && !sponsorHintClosed ? h('div', { className: 'ab-note', style: { marginBottom: 10 } },
          h('div', null, '国粹（官方推荐赞助商）：官网地址 ',
            h('a', { href: SPONSOR_SITE, target: '_blank', rel: 'noreferrer' }, 'ntmd.cn'),
            '，接口地址 ' + SPONSOR_BASE + ' —— 0.04/张 超快出图'),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } },
            h(Btn, { small: true, kind: 'ghost', onClick: () => setSponsorHintClosed(true) }, '收起'))) : null,
        h(Row, { label: '服务地址', hint: '选择官方推荐赞助商地址；选中即设为当前服务地址' },
          h(Select, { value: sponsorSelected ? SPONSOR_BASE : '', options: sponsorOptions, width: 320, ariaLabel: '赞助商服务地址', placeholder: '选择赞助商服务地址', onChange: pickSponsor })),
        h(Row, { label: 'API Key', hint: '只存在本机，不会显示出来' }, f.text('imageGen.apiKey', { type: 'password', placeholder: c.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
        modelField(),
      ) : tab === 'dsh' ? h('div', null,
        dshMod
          ? h(ExtPanel, { m: dshMod, settings: dshDraft, draftSettings: dshDraft, setSettings: setDshSettings, toast, reload, saveOverride: saveDsh })
          : h('div', { className: 'ab-note err' }, '扩展模块 dsh-image 没在跑：去「已安装」里打开它，再回到这一页。'),
      ) : isCodex ? h(CodexSub, { draft, setDraft, toast }) : isMinimax ? h('div', null,
        h(Row, { label: 'API Key', hint: '留空 = 复用「语音」页的 MiniMax Key（同一个开放平台 Key）；也可单独填一份' },
          f.text('imageGen.minimax.apiKey', { type: 'password', placeholder: mm.apiKeySet ? '已保存（不改就留空）' : '可留空，复用语音里的 MiniMax Key' })),
        h(Row, { label: '服务地址', hint: '国内平台 https://api.minimax.cn；海外平台 https://api.minimax.io' },
          f.text('imageGen.minimax.baseUrl', { size: 'wide', placeholder: 'https://api.minimax.cn' })),
        h(Row, { label: '模型' },
          f.select('imageGen.minimax.model', [
            { value: 'MiniMax-H3-Image', label: 'MiniMax-H3-Image' },
            { value: 'MiniMax-H3-Image-Highspeed', label: 'MiniMax-H3-Image-Highspeed（更快）' },
          ], { width: 300 })),
        h(Row, { label: '一次生成几张', hint: '接口每次最多 10 张，按成功张数计费；说「画几张」时她也会按需填' },
          f.select('imageGen.minimax.n', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: n + ' 张' })), { width: 160 })),
        h(Row, { label: '输出面积', hint: '1K≈1024²、2K≈2048²、4K≈4096²；H3 原图约 16MP，2K 一般够用也更快' },
          f.select('imageGen.minimax.area', ['1K', '2K', '4K'].map((v) => ({ value: v, label: v })), { width: 140 })),
        h(Row, { label: '提示词增强', hint: '默认开启：短描述会先扩写成完整画面（官方 H3-Image-Context-IR）；关闭后按原提示词直接生成' },
          f.sw('imageGen.minimax.enhance')),
        h('div', { className: 'ab-note', style: { marginTop: 8 } }, 'MiniMax H3 支持拿 1~16 张参考图改画，也支持一次生成多张；参考图可用聊天里最近收到的图、引用图或图库画作。老配置不用改：只有把「接口格式」切到 MiniMax H3 才会走这个接法。'),
      ) : isCustom ? h('div', null,
        h(Row, { label: '请求方式', hint: 'GET 把参数都拼在地址上；POST 放进请求体' },
          h(Seg, {
            value: isPost ? 'POST' : 'GET',
            onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.method', v)),
            options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }],
          })),
        h(Row, { label: '接口地址', hint: '可以用 {prompt} {model} {size} {width} {height} {image}（参考图 base64）' },
          f.text('imageGen.custom.url', { size: 'wide', placeholder: 'https://image.pollinations.ai/prompt/{prompt}' })),
        h(Row, { label: 'API Key', hint: '会以 Authorization: Bearer 发出；不需要就留空' },
          f.text('imageGen.apiKey', { type: 'password', placeholder: c.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
        h('div', { className: 'ab-label', style: { marginTop: 12 } },
          h('b', null, isPost ? '请求体参数' : 'URL 参数'),
          h('small', null, '参数名和值都自己填；值里可以用 {prompt}、{image}（参考图 base64）；参考图需配置 {image} 才能使用')),
        params.length
          ? params.map((p, i) => h('div', { key: i, className: 'ab-flex', style: { gap: 6, marginBottom: 6 } },
            h('input', { className: 'ab-input', style: { width: 170 }, value: p.key || '', placeholder: '参数名，如 model', onChange: (e) => setP(i, 'key', e.target.value) }),
            h('input', { className: 'ab-input', style: { flex: 1 }, value: p.value || '', placeholder: '值，可以用 {prompt}', onChange: (e) => setP(i, 'value', e.target.value) }),
            h(Btn, { small: true, onClick: () => setParams(params.filter((_, j) => j !== i)) }, '删')))
          : h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } }, '还没有参数 —— 比如 model=flux-anime、width=1080、height=1920、nologo=true'),
        h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
          h(Btn, { small: true, onClick: () => setParams([...params, { key: '', value: '' }]) }, '＋ 加一个参数')),
        isPost ? h(Row, { label: '请求体格式' },
          h(Seg, {
            value: custom.bodyType === 'form' ? 'form' : 'json',
            onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.bodyType', v)),
            options: [{ value: 'json', label: 'JSON' }, { value: 'form', label: '表单' }],
          })) : null,
        h(Row, { label: '取值路径', hint: '接口直接回图片就留空；回 JSON 时填地址字段' },
          f.text('imageGen.custom.responsePath', { size: 'wide', placeholder: '如 data.0.url（留空自动找）' })),
      ) : h('div', null,
        h(Row, { label: '服务地址', hint: '一般以 /v1 结尾' }, f.text('imageGen.baseUrl', { size: 'wide', placeholder: 'https://api.siliconflow.cn/v1' })),
        h(Row, { label: 'API Key', hint: '只存在本机，不会显示出来' }, f.text('imageGen.apiKey', { type: 'password', placeholder: c.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
        modelField(),
      ),
      h('div', { className: 'ab-muted ab-small' }, '测试会实际生成图片，可能消耗额度；使用当前页面配置，不自动切换或发送到 QQ。'),
      testButton(''),
      h(Row, { label: '生图失败自动切换', hint: '连接失败或接口返回错误时按顺序尝试；备用服务会收到画图描述及参考图，图片下载失败不会重发' }, f.sw('imageGen.fallbackEnabled')),
      h('div', { className: 'ab-label', style: { marginTop: 12 } }, h('b', null, '备用接口与模型（从上到下为优先级）')),
      fallbacks.map((e, i) => h('div', { key: e.id, className: 'ab-note', style: { marginBottom: 8 } },
        h('div', { className: 'ab-flex', style: { gap: 6, marginBottom: 6 } }, h('b', null, '备用 ' + (i + 1)), h(Btn, { small: true, disabled: i === 0, onClick: () => moveFallback(i, -1) }, '上移'), h(Btn, { small: true, disabled: i === fallbacks.length - 1, onClick: () => moveFallback(i, 1) }, '下移'), h(Btn, { small: true, onClick: () => setFallbacks(fallbacks.filter((_, j) => j !== i)) }, '删除')),
        h(Row, { label: '接法' }, h(Seg, { value: e.provider || 'openai', onChange: value => setFallback(i, 'provider', value), options: [{ value: 'openai', label: 'OpenAI 格式' }, { value: 'codex', label: 'Codex 订阅' }] })),
        e.provider !== 'codex' ? h(Row, { label: '服务地址' }, h('input', { className: 'ab-input', value: e.baseUrl || '', placeholder: 'https://example.com/v1', onChange: event => setFallback(i, 'baseUrl', event.target.value) })) : h('div', { className: 'ab-muted ab-small' }, '使用已登录的 ChatGPT 账号及订阅质量、背景设置。'),
        e.provider !== 'codex' ? h(Row, { label: 'API Key' }, h('input', { className: 'ab-input', type: 'password', value: e.apiKey || '', placeholder: e.apiKeySet ? '已保存（不改就留空）' : '没有就留空', onChange: event => setFallback(i, 'apiKey', event.target.value) })) : null,
        h(Row, { label: '模型' }, h('input', { className: 'ab-input', value: e.model || '', placeholder: '模型名称', onChange: event => setFallback(i, 'model', event.target.value) })), testButton(e.id))),
      h(Btn, { small: true, onClick: () => setFallbacks([...fallbacks, { id: crypto.randomUUID(), provider: 'openai', baseUrl: '', apiKey: '', model: '' }]) }, '＋ 添加备用接口 / 模型'),
      h(Row, { label: '默认构图', hint: isCodex ? '通过构图提示引导，实际尺寸由服务端选择，不保证严格比例' : '聊天工具可指定本次构图。服务不支持所选尺寸时会报告失败，请换一种构图；自定义接口需使用尺寸占位符' },
        f.select('imageGen.shape', [
          { value: 'her', label: '让ta选择', desc: isCodex ? '未指定时由服务端选择' : '未指定时沿用图片尺寸' },
          { value: 'square', label: isCodex ? '方图 1:1' : '方图 1:1（1024 × 1024）' },
          { value: 'portrait', label: isCodex ? '竖图 2:3' : '竖图 2:3（1024 × 1536）' },
          { value: 'landscape', label: isCodex ? '横图 3:2' : '横图 3:2（1536 × 1024）' },
          { value: 'wide', label: isCodex ? '宽幅 16:9' : '宽幅 16:9（1536 × 864）' },
        ], { width: 260 })),
      !isCodex && (!c.shape || c.shape === 'her') ? h(Row, { label: '图片尺寸', hint: isCustom ? '接口地址 / 参数里可以用 {size} 或 {width}/{height}' : '未指定构图时沿用这个尺寸' },
        f.select('imageGen.size', [{ value: '1024x1024', label: '1024 × 1024', desc: '方图' }, { value: '768x1024', label: '768 × 1024', desc: '竖图' }, { value: '1024x768', label: '1024 × 768', desc: '横图' }, { value: '512x512', label: '512 × 512', desc: '小图，更快' }, { value: '2048x2048', label: '2K · 2048 × 2048', desc: '2K 方图' }, { value: '4096x4096', label: '4K · 4096 × 4096', desc: '4K 方图' }], { width: 230 })) : null,
      h(Row, { label: '固定风格', hint: '每次画都会加在描述前面' }, f.text('imageGen.stylePrompt', { size: 'wide', placeholder: '例如：日系二次元，柔和光线，蓝白配色' })),
      h(Row, { label: '限制生图权限', hint: '开启时主人和权限页授权的私聊对象可以生图；关闭后允许白名单中的聊天使用。' }, f.sw('imageGen.ownerOnly')),
      h(Row, { label: '允许参考图改画', hint: '默认开启，只接受当前聊天收到的图、引用图或图库文件名；Codex 订阅暂不支持' }, f.sw('imageGen.img2img')),
      !isCustom && !isCodex ? h(Row, { label: '允许按需生成 GIF', hint: '接口需支持 GIF。明确说“动图”或“动起来”时才用，普通画图保持静态；默认生成约 1.6 秒短循环，可能更慢、更费额度。' }, f.sw('imageGen.allowGif', { title: '允许按需生成 GIF' })) : null,
      h(Row, { label: '让ta画完自己看一眼', hint: '开着才把画好的图传给ta看（模型不支持看图时自动不传）；关掉就只回一句「画好了」，不传图' }, f.sw('imageGen.seeOwn')),
      isCustom ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, '例子：地址填 https://image.pollinations.ai/prompt/{prompt}，再加 model=flux-anime、width=1080、height=1920、nologo=true 四个参数，GET 就会请求 …/prompt/<提示词>?model=flux-anime&width=1080&…') : null,
      !c.enabled ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, '还没开启。填好接口信息、打开右上角开关并保存后，ta就会多一个「画图」能力。') : null,
    ),
    h(PaintGallery, { draft, setDraft, toast }),
  )
}

/** 云备份（Gitee 私有仓库 / WebDAV）：每天到点自动打包，把最新备份推上去，远端只留最近 N 份。 */

export { SPONSOR_BASE, SPONSOR_SITE, Video, ImageGen }
