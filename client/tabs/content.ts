import { useState, useEffect, Fragment } from '../core/react.ts'
import { API, bustCache, get, getCached, post } from '../core/api.ts'
import { setPath, timeAgo } from '../core/format.ts'
import { Btn, Card, Empty, Row, cx, h, useField } from '../core/ui.ts'
import { BiliCookie } from './system.ts'

const CONTENT_PLATFORMS = [
  { id: 'bili', label: 'B站', mod: 'bili' },
  { id: 'douyin', label: '抖音', mod: 'douyin' },
  { id: 'heybox', label: '小黑盒', mod: 'heybox' },
]

/**
 * 内容平台页外壳：B站 / 抖音 / 小黑盒 三个子视图共用一个页签。
 * 只挂载选中的平台——不选不挂载，各平台数据互不拉取。
 * 默认取首个当前可用的平台（boot.modules 里对应模块 running）；
 * 尊重 aurabot.content-view 上次选择，存的平台若不可用则回落首个可用。
 */

function ContentTab({ contentView, setContentView, boot, st, draft, setDraft, toast }) {
  const mods = (boot && boot.modules) || (st && st.modules) || []
  // 全部平台都可点（模块没在跑的也能点进标签）；running 只用来决定默认选中哪个。
  const all = CONTENT_PLATFORMS.map((p) => p.id)
  const defaultId = (CONTENT_PLATFORMS.find((p) => mods.some((m) => m && m.id === p.mod && m.running)) || CONTENT_PLATFORMS[0]).id
  // 归一化：上次选择合法就沿用，否则回落默认。这里不能用「可用集合」判断——
  // 否则模块没跑的平台一点就被弹回，表现为「按钮点不动」。
  const picked = all.includes(contentView) ? contentView : defaultId
  const seg = h('div', { className: 'ab-seg', role: 'tablist', 'aria-label': '内容平台子视图' },
    CONTENT_PLATFORMS.map((p) => h('button', {
      key: p.id, type: 'button', role: 'tab',
      'aria-selected': picked === p.id,
      className: cx(picked === p.id && 'on'),
      onClick: () => setContentView(p.id),
    }, p.label)))
  const runningOf = (id) => {
    const p = CONTENT_PLATFORMS.find((x) => x.id === id)
    return Boolean(p && mods.some((m) => m && m.id === p.mod && m.running))
  }
  // 模块没在跑时不要挂载子组件：它的 load() 会打到不存在的路由，拿回 {ok:false}
  // 这种没有 history 的残对象，渲染层一取 .length 就整页崩（「这一页出错了」）。
  return h('div', null,
    h('div', { className: 'ab-flex', style: { margin: '0 0 12px' } }, seg),
    !runningOf(picked)
      ? h(Card, { title: '这个平台还没启用' },
          h('div', { className: 'ab-note' }, '对应的模块没在跑，所以看不到它的设置和登录状态。'),
          h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '到「模块」页把它启动（或装上），回来再点这个标签就行。'))
      : picked === 'bili' ? h(Bili, { draft, setDraft, toast })
        : picked === 'douyin' ? h(Douyin, { draft, setDraft, toast })
          : h(Heybox, { draft, setDraft, toast }))
}

const BILI_KIND = { watch: '看了', comment: '评论', reply: '回复', share: '分享给你', shot: '发你截图', error: '没成功' }

/** B 站：登录、定时刷、评论 / 回复、分享给主人，以及她刷过什么。 */

function Bili({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState('')
  const [shots, setShots] = useState(null)
  const [shotsTotal, setShotsTotal] = useState(0)
  const [shotsHasMore, setShotsHasMore] = useState(false)
  const [shotsBusy, setShotsBusy] = useState(false)
  const load = () => get('/bili/state').then((r) => { if (r && Array.isArray(r.history)) setS(r); else if (r && r.ok === false) toast(r.message || '读取 B 站状态失败', 'err') }).catch((e) => toast(e.message, 'err'))
  const loadShots = (append = false, force = false) => {
    const offset = append && shots ? shots.length : 0
    return getCached('/bili/shots?limit=25&offset=' + offset, force).then((r) => {
      const items = r.items || []
      setShots((prev) => append ? [...(prev || []), ...items] : items)
      setShotsTotal(Number(r.total) || 0)
      setShotsHasMore(Boolean(r.hasMore))
    }).catch((e) => { if (!append) setShots([]); toast(e.message, 'err') })
  }
  const loadMoreShots = async () => {
    if (shotsBusy || !shotsHasMore) return
    setShotsBusy(true)
    try { await loadShots(true) } finally { setShotsBusy(false) }
  }
  useEffect(() => { load(); loadShots() }, [])
  const act = (path, label) => async () => { setBusy(label); const r = await post(path); setBusy(''); toast(r.message, r.ok ? 'ok' : 'err'); load(); loadShots() }
  const acct = s && s.account
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '刷 B 站', right: f.sw('bili.enabled'), desc: 'ta会定时去 B 站刷几个视频：从ta的兴趣、记忆里你喜欢的东西和下面的关键词里挑方向去搜，读简介、字幕和热评，再按自己的性格决定评不评论、要不要私聊分享给你、记住什么。看过的、评过的都记成ta的经历，聊天时会自然提起。你在 QQ 里发 B 站链接或分享卡片，ta也能点进去看完再聊。' },
      h(BiliCookie, { draft, setDraft, load }),
      h('div', { className: 'ab-flex', style: { marginTop: 4 } },
        h(Btn, { small: true, onClick: async () => { await get('/bili/account'); load() } }, '检查登录'),
        acct ? h('span', { className: 'ab-small', style: { color: acct.isLogin ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, acct.isLogin ? '已登录：' + acct.uname : '没登录（只能看，不能评论）') : null),
    ),
    h(Card, { title: '怎么刷', desc: '只在「目的引擎」里设的醒着时间内刷。' },
      h(Row, { label: '定时自己去刷' }, f.sw('bili.autoBrowse')),
      h(Row, { label: '只在谷时刷', hint: '避开 DeepSeek 峰时（北京时间工作日 9-12、14-18）；峰时跳过定时刷和看回复，等谷时再跑，周末和法定节假日全天可刷' }, f.sw('bili.offpeak')),
      (draft.bili && draft.bili.offpeak && s && s.lastSkipReason) ? h(Row, { label: '上次跳过' }, h('span', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, s.lastSkipReason)) : null,
      h(Row, { label: '多久刷一轮' }, f.range('bili.intervalHours', 1, 24, 1, (v) => v + ' 小时')),
      h(Row, { label: '每天最多刷' }, f.range('bili.maxRunsPerDay', 0, 12, 1, (v) => v + ' 轮')),
      h(Row, { label: '一轮看几个视频' }, f.range('bili.perRun', 1, 6, 1, (v) => v + ' 个')),
      h(Row, { label: '额外想看的方向', hint: '一行一个；另外还会参考ta的兴趣和记忆' }, f.list('bili.keywords', { placeholder: '白米饭 做法\n猫咪\n游戏解说' })),
      h(Row, { label: '播放量门槛' }, f.num('bili.minViews', { min: 0 }), h('span', { className: 'ab-muted' }, '次以上')),
      h(Row, { label: '只看最近' }, f.num('bili.maxAgeDays', { min: 0 }), h('span', { className: 'ab-muted' }, '天内发的（0 = 不限）')),
    ),
    h(Card, { title: '评论、回复和分享', desc: '评论和回复要登录。试运行开着时只记日志不发。' },
      h(Row, { label: '主人的 B 站昵称', hint: '填完整昵称。ta评论里写 @主人 时会 @ 这个号' }, f.text('bili.ownerName', { placeholder: '不填就 @ 不到你' })),
      h(Row, { label: '自己发评论', hint: '只管ta自己刷视频时发不发；别人让ta发，看「权限」页的 B 站评论' }, f.sw('bili.comment'), h('span', { className: 'ab-muted' }, '每天最多'), f.num('bili.maxCommentsPerDay', { min: 0, max: 50 }), h('span', { className: 'ab-muted' }, '条')),
      h(Row, { label: '回别人回ta的评论' }, f.sw('bili.reply'), h('span', { className: 'ab-muted' }, '每天最多'), f.num('bili.maxRepliesPerDay', { min: 0, max: 100 }), h('span', { className: 'ab-muted' }, '条')),
      h(Row, { label: '看到好玩的分享给你', hint: '私聊发给主人，带视频链接' }, f.sw('bili.shareToOwner')),
      h(Row, { label: '也提议发到群里', hint: '刷到合适的先私聊问主人，批准了才发；关着就不提' }, f.sw('bili.groupShare.enabled')),
      h(Row, { label: '发到哪个群', hint: '群号。留空则不生效' }, f.text('bili.groupShare.groupId', { placeholder: '群号' })),
      h(Row, { label: '每天最多发', hint: '只算真发进群的条数' }, f.num('bili.groupShare.dailyLimit', { min: 0, max: 20 }), h('span', { className: 'ab-muted' }, '条')),
      h(Row, { label: '顺手点赞' }, f.sw('bili.like')),
    ),
    h(Card, { title: '看画面（抽帧 + 视觉）', desc: '默认只读标题、简介、字幕和热评。打开后用 ffmpeg 抽帧交给视觉模型，截图保存到本机，可以在 QQ 聊天里让ta挑一张发送。没有 ffmpeg、模型明确不支持图片或处理失败时，自动继续文字阅读。' },
      h(Row, { label: '让ta看画面', hint: '需要视觉模型 + ffmpeg；关掉就退回只看文字' }, f.sw('bili.vision')),
      h(Row, { label: '每个视频抽几帧' }, f.range('bili.visionFrames', 2, 12, 1, (v) => v + ' 帧')),
      h(Row, { label: '刷完顺手发张截图', hint: '概率；跟发一张表情包一样默认 35%，0 = 从不。截图都存在本机，你让ta发ta也能挑' }, f.range('bili.shotChance', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      h(Row, { label: '截图库最多存', hint: '超过就自动删最旧的；下面的截图库里也能一张张手动删' }, f.num('bili.shotLibrary', { min: 20, max: 2000 }), h('span', { className: 'ab-muted' }, '张')),
      h(Row, { label: 'ffmpeg 路径', hint: '留空就自己在 PATH 里找；找不到就填绝对路径' }, f.text('bili.ffmpegPath', { placeholder: 'C:\\ffmpeg\\bin\\ffmpeg.exe' })),
      s && s.vision ? h('div', { className: 'ab-small', style: { marginTop: 4, color: s.vision.ffmpeg ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, (s.vision.ffmpeg ? '✓ 已找到 ffmpeg：' + s.vision.ffmpeg : '✗ 没找到 ffmpeg：抽帧会被跳过，装一个或者在上面填路径') + (s.shots ? '　·　手上存了 ' + s.shots.count + ' 张截图' : '')) : null,
    ),
    h(Card, { title: '截图库' + (shots ? '（' + shots.length + (shotsTotal > shots.length ? '/' + shotsTotal : '') + '，上限 ' + ((draft.bili && draft.bili.shotLibrary) || 300) + '）' : ''), right: h('div', { className: 'ab-flex' },
      h(Btn, { small: true, kind: 'ghost', onClick: () => { bustCache(); loadShots(false, true) } }, '刷新')) },
      !shots ? h(Empty, { icon: '⏳', text: '加载中…' }) : shots.length === 0 ? h(Empty, { icon: '🎬', text: '还没有截图。打开上面的「让ta看画面」刷一轮 B 站，就会开始截。' }) :
        h('div', { className: 'ab-shots' }, shots.map((it) => h(ShotCell, {
          key: it.file, it, toast,
          // 删掉后只从本地列表移除这一张，不重拉第一页、不改变滚动位置
          onChanged: (file) => {
            if (file) {
              const nextLoaded = Math.max(0, (shots || []).length - 1)
              const nextTotal = Math.max(0, shotsTotal - 1)
              setShots((prev) => (prev || []).filter((x) => x.file !== file))
              setShotsTotal(nextTotal)
              setShotsHasMore(nextTotal > nextLoaded)
            }
            load()
          },
        }))),
      shotsHasMore ? h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        h(Btn, { small: true, kind: 'ghost', disabled: shotsBusy, onClick: loadMoreShots }, shotsBusy ? '加载中…' : `加载更多（已显示 ${shots ? shots.length : 0}/${shotsTotal}）`)) : null,
    ),
    h(Card, { title: 'ta刷过什么', right: h('div', { className: 'ab-flex' },
      h(Btn, { small: true, onClick: act('/bili/replies', 'replies'), disabled: !!busy }, busy === 'replies' ? '正在看…' : '看看有没有人回ta'),
      h(Btn, { small: true, kind: 'primary', onClick: act('/bili/run', 'run'), disabled: !!busy }, busy === 'run' ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在刷…') : '现在刷一轮')) },
      s && s.pauseReason ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } }, '今天先不发评论和回复了：' + s.pauseReason + '。登录失效请保存新 Cookie 后点「检查登录」；验证、风控或频率限制不会因登录成功而解除。') : null,
      s ? h('div', { className: 'ab-muted ab-small', style: { marginBottom: 8 } }, '今天自动刷了 ' + s.runs + ' 轮 · 评论 ' + s.comments + ' 条 · 回复 ' + s.replies + ' 条' + (s.lastRun ? ' · 上次 ' + timeAgo(s.lastRun) : '') + '（手动刷不占次数）') : null,
      !s ? h(Empty, { icon: '⏳', text: '加载中…' }) : !Array.isArray(s.history) || s.history.length === 0 ? h(Empty, { icon: '📺', text: '还没刷过。点「现在刷一轮」试试。' }) :
        h('div', { className: 'ab-list' }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, timeAgo(x.at), h('br'), BILI_KIND[x.kind] || x.kind),
          h('div', { className: 'body' }, x.bvid ? h('a', { href: 'https://www.bilibili.com/video/' + x.bvid, target: '_blank', rel: 'noreferrer' }, '《' + x.title + '》') : h('b', null, '《' + x.title + '》'), x.text ? h('div', { className: 'ab-muted' }, x.text) : null)))),
    ),
    h(BiliDanmaku, { draft, setDraft, toast }),
  )
}

/** 弹幕直接嵌在内置 B 站页，不依赖额外扩展面板。 */

function BiliDanmaku({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [video, setVideo] = useState('')
  const [part, setPart] = useState(1)
  const [seconds, setSeconds] = useState('')
  const [text, setText] = useState('')
  const [position, setPosition] = useState('scroll')
  const [info, setInfo] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => get('/bili/danmaku/state').then(setStatus)
  useEffect(() => { load() }, [])
  useEffect(() => { setInfo(null) }, [video, part])
  const action = async (kind) => {
    setBusy(true)
    try {
      const response = await fetch(API + '/bili/danmaku/' + kind, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-aurabot-bili-danmaku': '1' },
        body: JSON.stringify({ video, part, seconds, text, position }),
      })
      const result = await response.json()
      if (result.info) setInfo(result.info)
      toast(result.message || (result.ok ? '视频信息已读取' : '读取未完成'), result.ok ? 'ok' : 'err')
      await load()
    } catch { toast('弹幕接口暂时无法连接，请先到 B 站确认是否发送，避免重复提交', 'err') }
    finally { setBusy(false) }
  }
  return h(Card, { title: '视频弹幕', desc: '两个开关默认关闭，改完先保存设置。发送按钮会实际提交弹幕；试运行时不发送。沿用本页的 B 站登录。' },
    h(Row, { label: '允许发送弹幕', hint: '关闭后手动、聊天工具和自动弹幕均不发送；聊天工具只接受主人私聊请求' }, f.sw('bili.danmakuEnabled')),
    h(Row, { label: '刷完视频自己发弹幕', hint: '另行开启；每个视频每天最多一条自动弹幕' }, f.sw('bili.autoDanmaku')),
    h(Row, { label: '每天最多提交弹幕', hint: '手动和自动共用次数上限，提交失败也计数' }, f.num('bili.maxDanmakuPerDay', { min: 1, max: 20 })),
    h(Row, { label: '视频或番剧链接', hint: '支持 BV/av、ep单集、ss整季链接；短链接请先展开' }, h('input', { className: 'ab-input', value: video, placeholder: '视频链接、番剧链接或编号', onChange: (e) => setVideo(e.target.value) })),
    h(Row, { label: '分P / 选集序号', hint: '普通视频填1；多段投稿选分P，ss整季链接选第几集；ep链接直接定位那一集' }, h('input', { className: 'ab-input sm', type: 'number', min: 1, value: part, onChange: (e) => setPart(e.target.value) })),
    h(Row, { label: '出现时间（秒）', hint: '例如83表示01:23；按当前分P或单集计算' }, h('input', { className: 'ab-input sm', type: 'number', min: 0, step: 0.1, value: seconds, onChange: (e) => setSeconds(e.target.value) })),
    h(Row, { label: '弹幕文字', hint: '一行，最多100字' }, h('input', { className: 'ab-input', value: text, onChange: (e) => setText(e.target.value) })),
    h(Row, { label: '位置' }, h('select', { className: 'ab-input', value: position, onChange: (e) => setPosition(e.target.value) },
      h('option', { value: 'scroll' }, '滚动'), h('option', { value: 'top' }, '顶部'), h('option', { value: 'bottom' }, '底部'))),
    info ? h('p', { className: 'ab-note' }, `《${info.title}》 · ${info.kind === 'bangumi' ? '番剧单集' : '第' + info.part + 'P'} · ${info.duration}秒`) : null,
    h('div', { className: 'ab-flex', style: { marginTop: 12 } },
      h(Btn, { disabled: busy || !video, onClick: () => action('inspect') }, '检查视频（不发送）'),
      h(Btn, { kind: 'primary', disabled: busy || !video || !text.trim() || seconds === '' || draft.bili?.danmakuEnabled !== true, onClick: () => action('send') }, busy ? '处理中…' : '发送弹幕')),
    status?.ok ? h('p', { className: 'ab-small ab-muted' }, `今天已确认发送 ${status.sentToday} 条 · 已提交 ${status.attemptsToday}/${status.limit} 次 · 两次提交至少间隔30秒`) : null,
    h('div', { className: 'ab-list' }, (status?.history || []).map((row, index) => h('div', { className: 'ab-li', key: index },
      h('div', { className: 'meta' }, timeAgo(row.at), h('br'), row.auto ? '自己决定' : '主人要求'),
      h('div', { className: 'body' }, h('b', null, row.title || row.video), ` · ${/^(ep|ss)/.test(row.video) ? '番剧单集' : '第' + row.part + 'P'} ${row.seconds}秒`, h('div', null, row.text),
        h('div', { className: 'ab-small ab-muted' }, row.ok ? `已发送 · 弹幕ID ${row.id}` : row.message),
        row.platformResponse ? h('details', null, h('summary', null, '平台响应'), h('pre', { className: 'ab-code' }, JSON.stringify(row.platformResponse, null, 2))) : null)))),
  )
}

function ShotCell({ it, onChanged, toast }) {
  const src = API + '/bili/shot/image?file=' + encodeURIComponent(it.file)
  const cap = (it.title ? '《' + it.title + '》' : '截图') + (it.clock ? '　' + it.clock : '')
  return h('div', { className: 'ab-shot' },
    h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: cap, loading: 'lazy' })),
    h('div', { className: 'cap', title: it.note || '' }, cap),
    h('button', {
      type: 'button',
      className: 'ab-btn sm danger x',
      title: '删除',
      onClick: async () => {
        if (!confirm('删掉这张截图？\n' + cap)) return
        const r = await post('/bili/shot/delete', { file: it.file })
        toast(r.message || '删掉了', r.ok ? 'ok' : 'err')
        if (r.ok) onChanged(it.file)
      },
    }, '✕'),
  )
}

const DOUYIN_KIND = { watch: '看了', look: '点开看', like: '点赞', comment: '评论', share: '分享给你', dm: '回你私信', 'dry:dm': '试运行·私信', 'dry:like': '试运行·点赞', 'dry:comment': '试运行·评论', error: '没成功' }

/** 抖音：专用浏览器扫码登录、定时刷、点赞 / 评论、在 QQ 上分享给主人，以及她刷过什么。 */

function Douyin({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState('')
  const [login, setLogin] = useState(null) // 扫码进行中：{ shot, message }
  // 只读状态：打开这一页不会启动浏览器
  const load = () => get('/douyin/state').then(setS)
  useEffect(() => { load() }, [])
  const act = (path, label, body = {}) => async () => { setBusy(label); const r = await post(path, body); setBusy(''); toast(r.message || (r.ok ? '好了' : '没成功'), r.ok ? 'ok' : 'err'); load() }
  useEffect(() => {
    if (!login) return undefined
    const t = setInterval(async () => {
      const r = await get('/douyin/login/status')
      if (r.loggedIn) { setLogin(null); toast(r.message, 'ok'); load() } else if (r.ok) setLogin(r)
    }, 2500)
    return () => clearInterval(t)
  }, [Boolean(login)])
  const startLogin = async () => {
    setBusy('login')
    const r = await post('/douyin/login')
    setBusy('')
    if (r.loggedIn) { toast(r.message, 'ok'); load() } else if (r.ok) setLogin(r)
    else toast(r.message || '打不开浏览器', 'err')
  }
  const acct = s && s.account
  const acctText = !acct || acct.unknown ? h('span', { className: 'ab-small ab-muted' }, '还没检查过') :
    h('span', { className: 'ab-small', style: { color: acct.loggedIn ? 'var(--ab-ok)' : 'var(--ab-warn)' } },
      acct.loggedIn ? '已登录：' + (acct.nickname || '') : (acct.message || acct.error || '还没登录'),
      acct.at ? h('span', { className: 'ab-muted' }, ' · ' + timeAgo(acct.at) + '查的') : null)
  const caps = (s && s.caps) || {}
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '刷抖音', right: f.sw('douyin.enabled'), desc: 'ta用一个专用浏览器（独立的登录资料，不碰你平时用的浏览器）刷抖音：定时打开推荐，一个个点开看，读标题、分类、抖音给的内容摘要和热评，再按自己的性格决定点不点赞、评不评论（特别想让你看的会在评论里 @你）、要不要在 QQ 上分享给你、记住什么。你在 QQ 里发抖音链接，ta也能点开看完再聊。浏览器窗口放在屏幕外，不抢前台。总开关默认关：先扫码登录，再打开。' },
      h(Row, { label: '抖音账号', hint: '建议用小号。扫一次码就行，登录状态存在专用浏览器里' },
        h('div', null,
          h('div', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', onClick: startLogin, disabled: !!busy || !!login }, busy === 'login' ? '正在打开浏览器…' : login ? '等你扫码…' : '扫码登录'),
            h(Btn, { small: true, onClick: async () => { setBusy('check'); const r = await get('/douyin/account'); setBusy(''); setS({ ...(s || {}), account: r }) }, disabled: !!busy }, busy === 'check' ? '检查中…' : '检查登录'),
            acctText),
          login ? h('div', { style: { marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' } },
            login.shot ? h('img', { src: login.shot, alt: '抖音登录', style: { maxWidth: 360, width: '100%', borderRadius: 10, border: '1px solid var(--ab-line)', background: '#fff' } }) : h('div', { className: 'ab-muted ab-small' }, '二维码还没出来，稍等…'),
            h('div', { className: 'ab-small', style: { flex: 1, minWidth: 160 } },
              h('div', null, login.message || '用抖音 App 扫码'),
              h('div', { className: 'ab-flex', style: { marginTop: 8 } },
                h(Btn, { small: true, onClick: act('/douyin/window', 'win', { visible: true }) }, '显示浏览器窗口'),
                h(Btn, { small: true, onClick: () => setLogin(null) }, '先不登了')))) : null)),
      h(Row, { label: '浏览器窗口', hint: '遇到验证码、扫码后要短信验证时，挪到屏幕上处理' },
        h('div', { className: 'ab-flex' },
          h(Btn, { small: true, onClick: act('/douyin/window', 'win', { visible: true }), disabled: !!busy }, '显示浏览器窗口'),
          h(Btn, { small: true, onClick: act('/douyin/window', 'win', { visible: false }), disabled: !!busy }, '收起窗口'))),
      h(Row, { label: '浏览器路径', hint: '留空 = 自动找 Edge（找不到再找 Chrome / Chromium）' }, f.text('douyin.browserPath', { size: 'wide', placeholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' })),
    ),
    h(Card, { title: '主人抖音号', desc: '填你的抖音号或主页链接，点「核对」。核对过之后，ta刷到特别想让你看的视频，会在评论里真的 @你（用抖音自己的 @ 选人，按你的账号 id 认人，你会收到抖音通知；认不出你就不发，不会发假 @）。改了输入要重新核对。' },
      h(Row, { label: '你的抖音号 / 主页链接' }, f.text('douyin.owner.input', { size: 'wide', placeholder: '抖音号，或 https://www.douyin.com/user/…' })),
      h('div', { className: 'ab-flex', style: { marginTop: 4 } },
        h(Btn, { small: true, kind: 'primary', onClick: act('/douyin/confirm-owner', 'confirm', { input: ((draft.douyin || {}).owner || {}).input || '' }), disabled: !!busy }, busy === 'confirm' ? '核对中…' : '核对'),
        s && s.owner ? h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '已核对：' + s.owner.nickname) : h('span', { className: 'ab-small ab-muted' }, '还没核对（不核对就不会 @你）')),
    ),
    h(Card, { title: '抖音私信', desc: '你在抖音上私信ta，ta会用自己的口气回（只认上面核对过的你，别人的私信不理）。让ta找视频的话，ta会尝试刷一轮再私信分享给你；这条流程仍需实际环境验证。只在「目的引擎」里设的醒着时间内回。' },
      h(Row, { label: '回你的抖音私信' }, f.sw('douyin.ownerDm')),
      h(Row, { label: '多久看一次' }, f.num('douyin.dmPollMinutes', { min: 1, max: 60 }), h('span', { className: 'ab-muted' }, '分钟'), h(Btn, { small: true, onClick: act('/douyin/dms', 'dms'), disabled: !!busy }, busy === 'dms' ? '正在看…' : '现在看一次')),
    ),
    h(Card, { title: '怎么刷', desc: '只在「目的引擎」里设的醒着时间内自己刷。主人在 QQ 里让ta「去刷会儿抖音」也行。' },
      h(Row, { label: '定时自己去刷' }, f.sw('douyin.autoBrowse')),
      h(Row, { label: '多久刷一轮' }, f.range('douyin.intervalHours', 1, 24, 1, (v) => v + ' 小时')),
      h(Row, { label: '每天最多刷' }, f.range('douyin.maxRunsPerDay', 0, 12, 1, (v) => v + ' 轮')),
      h(Row, { label: '一轮看几个' }, f.range('douyin.perRun', 1, 10, 1, (v) => v + ' 个')),
      h(Row, { label: '每天最多看' }, f.num('douyin.maxWatchPerDay', { min: 0, max: 200 }), h('span', { className: 'ab-muted' }, '个（含手动）')),
      h(Row, { label: '每个视频停留', hint: '真的在播放；停得越短越不像真人' }, f.num('douyin.dwellMin', { min: 3 }), h('span', { className: 'ab-muted' }, '～'), f.num('douyin.dwellMax', { min: 3 }), h('span', { className: 'ab-muted' }, '秒')),
      h(Row, { label: '分享到哪', hint: '抖音私信要先在上面核对你的抖音号；没核对或者发不出去时会改发 QQ' }, f.choices('douyin.shareTo', [
        { value: 'douyin', label: '抖音私信', desc: '在抖音里把视频分享给你（只有视频卡片）' },
        { value: 'qq', label: 'QQ 私聊', desc: 'ta的话 + 视频链接' },
        { value: 'both', label: '两边都发', desc: '抖音里收视频卡片，QQ 上看ta说了什么' },
      ])),
      h(Row, { label: '分享给你', hint: '刷到好看的视频，分享给你的积极程度' }, f.choices('douyin.shareBias', [
        { value: 'proactive', label: '积极', desc: '好看有趣就分享' },
        { value: 'normal', label: '适中', desc: '觉得你会喜欢才分享' },
        { value: 'stingy', label: '少分享', desc: '拿不准就不发' },
      ])),
    ),
    h(Card, { title: '每天上限', desc: '刚登录的号前几天上限自动减半（新号猛点赞最容易被风控）。遇到验证码 / 操作频繁当天就停手，看还能看。试运行开着时只记日志不真点。权限在「权限」页单独设（默认仅主人）。' },
      h(Row, { label: '点赞' }, f.num('douyin.caps.like', { min: 0, max: 300 })),
      h(Row, { label: '评论' }, f.num('douyin.caps.comment', { min: 0, max: 30 })),
      h(Row, { label: '分享给你' }, f.num('douyin.caps.share', { min: 0, max: 30 })),
      h(Row, { label: '评论里 @你', hint: '也算在评论次数里' }, f.num('douyin.caps.atOwner', { min: 0, max: 30 })),
      h(Row, { label: '点赞 + 评论合计' }, f.num('douyin.gate.maxWritesPerDay', { min: 1, max: 500 })),
      h(Row, { label: '两次点赞 / 评论间隔' }, f.num('douyin.gate.minWriteGapSec', { min: 0, max: 600 }), h('span', { className: 'ab-muted' }, '秒')),
      h(Row, { label: '新号减半' }, f.num('douyin.gate.newAccountDays', { min: 0, max: 30 }), h('span', { className: 'ab-muted' }, '天')),
    ),
    h(Card, { title: 'ta刷过什么', right: h('div', { className: 'ab-flex' },
      h(Btn, { small: true, onClick: load }, '刷新'),
      h(Btn, { small: true, kind: 'primary', onClick: act('/douyin/run', 'run'), disabled: !!busy || Boolean(s && s.busy) }, s && s.busy ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在刷…') : '现在刷一轮')) },
      s && s.pauseReason ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } }, '今天先不点赞评论了：' + s.pauseReason + '。要验证的话点上面「显示浏览器窗口」处理，明天自动恢复。') : null,
      s ? h('div', { className: 'ab-muted ab-small', style: { marginBottom: 8 } },
        '今天自动刷了 ' + s.runs + ' 轮 · 看了 ' + s.watched + ' · 赞 ' + s.like + '/' + caps.like + ' · 评 ' + s.comment + '/' + caps.comment + ' · 分享 ' + s.share + '/' + caps.share + (s.atOwner ? ' · @你 ' + s.atOwner + '/' + caps.atOwner : '') +
        (s.newAccount ? '（新号，上限减半）' : '') +
        (s.lastRun ? ' · 上次 ' + timeAgo(s.lastRun) : '') +
        (s.lastSkipReason ? ' · 上次没刷成：' + s.lastSkipReason : '')) : null,
      !s ? h(Empty, { icon: '⏳', text: '加载中…' }) : !Array.isArray(s.history) || s.history.length === 0 ? h(Empty, { icon: '📱', text: '还没刷过。先扫码登录、打开开关，再点「现在刷一轮」。' }) :
        h('div', { className: 'ab-list' }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, timeAgo(x.at), h('br'), DOUYIN_KIND[x.kind] || x.kind),
          h('div', { className: 'body' },
            x.awemeId ? h('a', { href: 'https://www.douyin.com/video/' + x.awemeId, target: '_blank', rel: 'noreferrer' }, x.title || (x.author ? x.author + ' 的视频' : x.awemeId)) : null,
            x.author && x.title ? h('span', { className: 'ab-muted' }, ' · ' + x.author) : null,
            x.text ? h('div', { className: 'ab-muted' }, (x.atOwner ? '@你 ' : '') + (x.via ? '（' + x.via.map((w) => (w === 'douyin' ? '抖音私信' : 'QQ')).join(' + ') + '）' : '') + x.text) : null)))),
    ),
  )
}

const HEYBOX_KIND = { browse: '逛了一圈', like: '点了赞', comment: '发了评论', post: '发了帖', delete: '删了帖' }

// 发帖风格的中文名（面板和排期卡片共用，避免两处写岔）
const HEYBOX_STYLE_LABEL = { diary: '大肥鱼日记', news: '热搜文', mix: '肥鱼热搜', deal: '每日羊毛' }


/** 「小黑盒」页：账号、逛法、额度、热榜预览、发帖分区与自检提醒、逛过什么。 */

function Heybox({ draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState('')
  const [hot, setHot] = useState(null)
  const [cookieText, setCookieText] = useState('')
  const load = () => get('/heybox/state').then(setS)
  // ── 话题/分区下拉 + 每天每篇排期 ──
  const [topicKw, setTopicKw] = useState({})
  const splitHashtags = (v) => String(v ?? '').split(/[\s,，、]+/).filter(Boolean)
  const joinHashtags = (arr) => arr.filter(Boolean).join(',')
  const topicOpts = (s && Array.isArray(s.topicsList)) ? s.topicsList : []
  const actOpts = (s && Array.isArray(s.actsList)) ? s.actsList : []
  const selFor = (i) => {
    const dp = draft.heybox && draft.heybox.dailyPosts && draft.heybox.dailyPosts[i]
    return splitHashtags(dp && dp.hashtagsText)
  }
  const findAct = (n) => (actOpts || []).find(function (t) { return t.name === n && t.isAct })
  const countSel = function (i) {
    const parts = selFor(i)
    const actN = parts.filter(findAct).length
    return { act: actN, plain: parts.length - actN }
  }
  // 选话题：活动 / 普通不互斥，但一帖共享 3 个名额（活动最多 1 个）。
  // 口径与模块侧 resolveHashtagItems 的 HASHTAG_TOTAL_CAP=3 一致，别在这边放宽。
  const TOPIC_CAP = 3
  const toggleTopic = (i, name) => setDraft(function (d) {
    const hb = d.heybox || {}
    const list = (Array.isArray(hb.dailyPosts) ? hb.dailyPosts : []).slice()
    const item = { ...(list[i] || {}) }
    const parts = splitHashtags(item.hashtagsText)
    const wantAct = Boolean((actOpts || []).find(function (t) { return t.name === name && t.isAct }))
    const isActIn = function (n) { return Boolean((actOpts || []).find(function (t) { return t.name === n && t.isAct })) }
    let nextVals
    if (parts.includes(name)) {
      nextVals = parts.filter(function (x) { return x !== name })
    } else if (wantAct) {
      // 换活动：新的顶替旧的，普通话题保留但只留得下 2 个（活动占 1 席）
      const plains = parts.filter(function (x) { return !isActIn(x) })
      if (plains.length > TOPIC_CAP - 1) toast('活动占 1 个名额，普通话题只保留前 ' + (TOPIC_CAP - 1) + ' 个', 'err')
      nextVals = [name].concat(plains.slice(0, TOPIC_CAP - 1))
    } else {
      if (parts.length >= TOPIC_CAP) { toast('一帖最多挂 ' + TOPIC_CAP + ' 个话题（活动、普通共享名额）', 'err'); return d }
      nextVals = parts.concat([name])
    }
    item.hashtagsText = joinHashtags(nextVals)
    item.hashtags = nextVals.slice()
    list[i] = item
    return { ...d, heybox: { ...hb, dailyPosts: list } }
  })
  const fmtHeat = function (n) {
    n = Number(n) || 0
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1) + '万'
    return String(n)
  }
  const renderSelSummary = function (i) {
    const c = countSel(i)
    const total = c.act + c.plain
    if (total > 0) {
      const color = total >= TOPIC_CAP ? 'var(--ab-warn)' : 'var(--ab-ok)'
      const detail = c.act > 0 ? '活动 ' + c.act + '/1 + 普通 ' + c.plain : '普通 ' + c.plain
      return h('span', { className: 'ab-small', style: { whiteSpace: 'nowrap', color: color } }, '已选话题 ' + total + '/' + TOPIC_CAP + '（' + detail + '）')
    }
    return h('span', { className: 'ab-small ab-muted', style: { whiteSpace: 'nowrap' } }, '未选（活动、普通共享 ' + TOPIC_CAP + ' 个名额）')
  }
  // 搜索 + 分组渲染（创作活动在前）
  const renderTopicGroups = function (i) {
    const kw = String(topicKw[i] || '').trim().toLowerCase()
    const all = (actOpts || []).filter(function (t) {
      if (!kw) return true
      return String(t.name).toLowerCase().indexOf(kw) >= 0 || String(t.actTitle || '').toLowerCase().indexOf(kw) >= 0
    })
    if (!all.length) return h('span', { className: 'ab-small ab-muted' }, (actOpts || []).length ? '没匹配到话题' : '还没拉到话题，点上面「刷新话题」')
    const cur = selFor(i)
    const groups = [
      { key: 'act', title: '创作活动', items: all.filter(function (t) { return t.isAct }) },
      { key: 'plain', title: '普通话题', items: all.filter(function (t) { return !t.isAct }) },
    ]
    return h('div', null, groups.map(function (g) {
      if (!g.items.length) return null
      return h('div', { key: g.key, style: { marginTop: 6 } },
        h('div', { className: 'ab-small ab-muted', style: { marginBottom: 4 } }, g.title + '（' + g.items.length + '）'),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6 } },
          g.items.slice(0, 24).map(function (t) {
            const on = cur.indexOf(t.name) >= 0
            return h(Btn, { key: t.id, small: true, kind: on ? 'primary' : 'ghost', onClick: function () { toggleTopic(i, t.name) } },
              (on ? '✓ ' : '') + '#' + t.name + '#  ' + fmtHeat(t.contentNum))
          }),
          g.items.length > 24 ? h('span', { className: 'ab-small ab-muted' }, '还有 ' + (g.items.length - 24) + ' 个，用搜索缩小范围') : null)
      )
    }))
  }
  const addPostSlot = () => setDraft(function (d) {
    const hb = d.heybox || {}
    const list = Array.isArray(hb.dailyPosts) ? hb.dailyPosts : []
    if (list.length >= 5) { toast('最多 5 篇', 'err'); return d }
    return { ...d, heybox: { ...hb, dailyPosts: [...list, { style: 'mix', topic: '', hashtagsText: '', hashtags: [], wordsMin: 0, wordsMax: 0, hint: '' }] } }
  })
  const removePostSlot = (i) => setDraft(function (d) {
    const hb = d.heybox || {}
    const list = Array.isArray(hb.dailyPosts) ? hb.dailyPosts.slice() : []
    list.splice(i, 1)
    return { ...d, heybox: { ...hb, dailyPosts: list } }
  })
  useEffect(() => { load() }, [])
  const act = (path, label, body = {}) => async () => {
    setBusy(label)
    const r = await post(path, body)
    setBusy('')
    toast(r.message || (r.ok ? '好了' : '没成功'), r.ok === false ? 'err' : 'ok')
    load()
  }
  const checkAccount = async () => {
    setBusy('account')
    const r = await get('/heybox/account')
    setBusy('')
    toast(r.message || (r.loggedIn ? '已登录：' + (r.nickname || '') : '没登录'), r.loggedIn ? 'ok' : 'err')
    load()
  }
  const loadHot = async () => {
    setBusy('hot')
    const r = await post('/heybox/hot')
    setBusy('')
    if (r.ok === false) { toast(r.message || '拉不到热榜', 'err'); return }
    setHot(r)
    load()
  }
  const saveCookie = async () => {
    if (!cookieText.trim()) { toast('先把 Cookie 粘进来', 'err'); return }
    setBusy('cookie')
    const r = await post('/heybox/login-cookie', { cookie: cookieText })
    setBusy('')
    toast(r.message || (r.ok ? '存好了' : '没成功'), r.ok === false ? 'err' : 'ok')
    if (r.ok) setCookieText('')
    load()
  }
  const [qrc, setQrc] = useState(null)
  const [qrBusy, setQrBusy] = useState('')
  const qrBegin = async () => {
    setQrBusy('start')
    const r = await post('/heybox/qr/start')
    setQrBusy('')
    setQrc(r)
    toast(r.message || (r.ok ? '二维码出来了，用小黑盒 App 扫' : '拿不到二维码'), r.ok === false ? 'err' : 'ok')
  }
  const qrPoll = async () => {
    setQrBusy('poll')
    const r = await post('/heybox/qr/poll')
    setQrBusy('')
    toast(r.message || (r.state === 'ok' ? '登录成功' : '还没扫上'), r.state === 'ok' ? 'ok' : 'warn')
    if (r.state === 'ok' && r.verified) setQrc(null)
    load()
  }
  const riskOf = s && s.risk
  const riskLeftMs = Math.max(0, Number(riskOf && riskOf.leftMs) || 0)
  const clearRiskBtn = async () => {
    setBusy('risk')
    const r = await post('/heybox/risk/clear')
    setBusy('')
    toast(r.message || '好了', r.ok === false ? 'err' : 'ok')
    load()
  }
  const verifyStep = async (path, body, name) => {
    setBusy(name)
    const r = await post(path, body)
    setBusy('')
    toast(r.message || (r.ok ? '好了' : '没成功'), r.ok === false ? 'err' : 'ok')
    load()
  }
  const riskCard = () => h(Card, {
    title: '访问限流 / 安全验证',
    desc: '小黑盒对同一账号的读接口有频率限制：搜索最容易弹验证码，帖子详情次之。被挡下来之后ta不会硬试重试（重试只会让冷却更长），而是按阶梯等（5 分钟 → 20 分钟 → 1 小时 → 3 小时 → 8 小时）。想马上继续用就扫码：不用开浏览器，手机上扫一下就能换一个干净会话。',
    right: h(Btn, { small: true, kind: 'ghost', onClick: clearRiskBtn, disabled: !!busy }, busy === 'risk' ? '处理中…' : '解除冷却'),
  },
    h(Row, { label: '现在的状态' },
      riskLeftMs > 0
        ? h('span', { className: 'ab-small', style: { color: 'var(--ab-warn)' } },
          '冷却中，还要等 ' + Math.ceil(riskLeftMs / 60000) + ' 分钟' + (riskOf.reason === 'ratelimit' ? '（因操作太频繁）' : '（因安全验证）'))
        : h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '正常，没在冷却')),
    h(Row, { label: '接口限速', hint: '每档都带 ±20% 抖动，避免固定节拍' },
      h('span', { className: 'ab-small ab-muted' }, '搜索 8 秒 · 帖详情 2.5 秒 · 信息流 1.2 秒 · 写操作 3 秒')),
    h(Row, { label: '扫码登录（推荐）', hint: '不用开浏览器：用小黑盒 App 扫这个码就行。这也是被验证码挡住后最省事的恢复方式' },
      h('div', null,
        h('div', { className: 'ab-flex' },
          h(Btn, { small: true, kind: 'primary', onClick: qrBegin, disabled: !!qrBusy }, qrBusy === 'start' ? '生成中…' : '生成二维码'),
          qrc && qrc.ok ? h(Btn, { small: true, onClick: qrPoll, disabled: !!qrBusy }, qrBusy === 'poll' ? '查…' : '我扫完了，查结果') : null),
        qrc && qrc.png ? h('div', { style: { marginTop: 8 } }, h('img', { src: qrc.png, style: { width: 200, height: 200, imageRendering: 'pixelated', border: '1px solid var(--ab-line)', borderRadius: 6 } })) : null,
        qrc && qrc.ok ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 4 } }, qrc.message || '') : null)),
    h(Row, { label: '浏览器手动验证', hint: '扫码不行时用：浏览器在后台打开，显示窗口后你自己点完验证，再按「验证完成」' },
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, disabled: !!busy, onClick: () => verifyStep('/heybox/verify/start', {}, 'verify') }, busy === 'verify' ? '打开中…' : '打开浏览器'),
        h(Btn, { small: true, disabled: !!busy, onClick: () => verifyStep('/heybox/verify/show', { visible: true }, 'verify-show') }, '显示窗口'),
        h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => verifyStep('/heybox/verify/finish', {}, 'verify-end') }, busy === 'verify-end' ? '检查中…' : '验证完成'))),
  )
  const acct = s && s.account
  const acctText = !acct || !acct.checkedAt ? h('span', { className: 'ab-small ab-muted' }, '还没检查过') :
    h('span', { className: 'ab-small', style: { color: acct.loggedIn ? 'var(--ab-ok)' : 'var(--ab-warn)' } },
      acct.loggedIn ? '已登录：' + (acct.nickname || '') + (acct.heyboxId ? '（id ' + acct.heyboxId + '）' : '') : (acct.message || '还没登录'),
      acct.checkedAt ? h('span', { className: 'ab-muted' }, ' · ' + timeAgo(acct.checkedAt) + '查的') : null)
  const quota = (s && s.quota) || {}
  const left = (s && s.left) || {}
  const limits = (s && s.limits) || {}
  return h('div', { className: 'ab-grid' },
    h(Card, {
      title: '刷小黑盒', right: f.sw('heybox.enabled'),
      desc: '用你的小黑盒账号逛游戏社区：定时看信息流、读帖子正文和热评，按性格决定点不点赞、评不评论；ta自己会写帖子（先看热榜找角度，再看社区高赞帖在聊什么）。配图按正文字数自动配：500 字以内文末 1 张、500-1000 字首段后加 1 张、1000 字以上每多 1000 字文中再加 1 张，每张优先按内容和心情现画，画不出来才用表情包库兜底。写操作各有权限（「权限」页，默认仅主人），每天有额度上限。',
    },
      h(Row, { label: '小黑盒账号', hint: '从浏览器登录后把整串 Cookie 粘到下面。pkey 必须有；想让它能点赞评论发帖，还要有 x_xhh_tokenid（F12 → Application → Cookies 里能复制到）' },
        h('div', null,
          h('div', { className: 'ab-flex' },
            h(Btn, { small: true, onClick: checkAccount, disabled: !!busy }, busy === 'account' ? '检查中…' : '检查登录'),
            acctText),
          h('div', { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' } },
            h('textarea', {
              className: 'ab-input', rows: 3, spellCheck: false,
              style: { flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 },
              placeholder: 'pkey=…; heybox_id=…; x_xhh_tokenid=…',
              value: cookieText, onChange: (e) => setCookieText(e.target.value),
            }),
            h(Btn, { small: true, kind: 'primary', onClick: saveCookie, disabled: !!busy }, busy === 'cookie' ? '保存中…' : '保存 Cookie')),
          s && s.hasCookie
            ? h('div', { className: 'ab-small', style: { marginTop: 6, color: s.hasToken ? 'var(--ab-ok)' : 'var(--ab-warn)' } },
              s.hasToken ? '✓ 有 pkey 和 x_xhh_tokenid，读写都能用' : '⚠ 只有 pkey，没有 x_xhh_tokenid：点赞 / 评论 / 发帖大概率会被拒')
            : null)),
    ),
    riskCard(),
    h(Card, {
      title: 'ta的逛法', desc: '只在「目的引擎」里设的醒着时间内自己逛。主人在 QQ 里让ta「去逛逛小黑盒」也行。逛是只读的，不会乱点赞评论。',
    },
      h(Row, { label: '定时自己去逛' }, f.sw('heybox.autoBrowse')),
      h(Row, { label: '只在谷时逛', hint: '避开工作日 9-12、14-18 两个高峰（那会儿模型排队久、单价高，逛一轮很费 token）。峰时ta会等，不占额度' },
        f.sw('heybox.offPeakOnly')),
      (draft.heybox && draft.heybox.offPeakOnly) ? h(Row, { label: '现在的时段', hint: '峰时段可以自己改；周末默认不算峰时' },
        h('div', { className: 'ab-flex' },
          h('span', { className: 'ab-small', style: { color: (s && s.peak && s.peak.now) ? 'var(--ab-warn)' : 'var(--ab-ok)' } },
            (s && s.peak && s.peak.now) ? '峰时 · 等会儿再逛' : '谷时 · 可以逛'),
          h('span', { className: 'ab-small ab-muted' }, s && s.peak ? '（' + s.peak.text + '）' : ''))) : null,
      (draft.heybox && draft.heybox.offPeakOnly) ? h(Row, { label: '峰时段', hint: '默认 9-12 和 14-18（左闭右开）。改这两个数字就能挪到实际高峰' },
        h('div', { className: 'ab-flex' },
          h('span', { className: 'ab-small ab-muted' }, '上午'),
          f.num('heybox.peakStartAM', { min: 0, max: 23 }), h('span', { className: 'ab-muted' }, '–'),
          f.num('heybox.peakEndAM', { min: 0, max: 24 }),
          h('span', { className: 'ab-small ab-muted', style: { marginLeft: 8 } }, '下午'),
          f.num('heybox.peakStartPM', { min: 0, max: 23 }), h('span', { className: 'ab-muted' }, '–'),
          f.num('heybox.peakEndPM', { min: 0, max: 24 }))) : null,
      (draft.heybox && draft.heybox.offPeakOnly) ? h(Row, { label: '周末也算峰时', hint: '默认关：周末全天都能逛' },
        f.sw('heybox.peakWeekend')) : null,
      h(Row, { label: '多久逛一圈' }, f.range('heybox.intervalHours', 1, 24, 1, (v) => v + ' 小时')),
      h(Row, { label: '一圈看几条' }, f.range('heybox.perRun', 1, 10, 1, (v) => v + ' 条')),
      h(Row, { label: '每天最多逛' }, f.range('heybox.maxRunsPerDay', 0, 12, 1, (v) => v + ' 轮')),
    ),
    h(Card, {
      title: '分享给你',
      desc: '逛到有意思的帖子，ta自己判断值不值得分享，值得就私聊发给你（带帖子链接）。和 B 站那边的分享是同一套逻辑。',
    },
      h(Row, { label: '私聊分享给我' }, f.sw('heybox.shareToOwner')),
      h(Row, { label: '分享的积极程度', hint: 'ta自己的判断阈值：越保守越不舍得发' },
        f.choices('heybox.shareBias', [
          { value: 'stingy', label: '很保守', desc: '非特别好不发' },
          { value: 'normal', label: '正常', desc: '觉得你会喜欢才发' },
          { value: 'proactive', label: '积极', desc: '有趣就发，不太吝啬' },
        ], { width: 200 })),
      h(Row, { label: '每天最多分享' }, f.num('heybox.shareDaily', { min: 0, max: 10 }), h('span', { className: 'ab-muted' }, '条/天')),
    ),
    h(Card, {
      title: '每天上限',
      desc: '小黑盒的帖详情和搜索接口查太勤会弹验证码（还可能连坐浏览器登录态），所以额度别设太大。搜索被挡时ta会自动降级去翻信息流，不会反复硬试。',
    },
      h(Row, { label: '点赞' }, f.num('heybox.likeDaily', { min: 0, max: 60 }), h('span', { className: 'ab-muted' }, '次/天')),
      h(Row, { label: '评论' }, f.num('heybox.commentDaily', { min: 0, max: 30 }), h('span', { className: 'ab-muted' }, '条/天')),
      h(Row, { label: '发帖' }, f.num('heybox.maxPostsPerDay', { min: 0, max: 5 }), h('span', { className: 'ab-muted' }, '篇/天（建议别超过 3）')),
      h(Row, { label: '发帖风格', hint: 'ta写帖时按这个口吻来。也可以让ta单次换：跟ta说「用日记风格发一篇」' },
        f.select('heybox.postStyle', [
          { value: 'diary', label: '大肥鱼日记', desc: '第一人称随手记，跟空间日记一个味，120-300字' },
          { value: 'news', label: '热搜文', desc: '报道新闻体，摆具体数字，200-800字' },
          { value: 'mix', label: '肥鱼热搜', desc: '用日记口吻写热搜，150-500字' },
          { value: 'deal', label: '每日羊毛', desc: '游戏折扣 / 限免 / 黑盒活动，带直达链接，150-450字' },
        ], { width: 220 })),
      h(Row, { label: '发帖字数范围', hint: '留 0 = 用所选风格自带的字数。填了就覆盖所有风格' },
        h('div', { className: 'ab-flex' },
          f.num('heybox.postWordsMin', { min: 0, max: 2000 }), h('span', { className: 'ab-muted' }, '–'),
          f.num('heybox.postWordsMax', { min: 0, max: 3000 }), h('span', { className: 'ab-muted' }, '字')),
      ),
      h(Row, { label: '分区怎么选', hint: '自动 = 按正文里的游戏名/分区名挑，挑不到回落默认分区；手动 = 永远用默认分区' },
        f.choices('heybox.topicMode', [
          { value: 'manual', label: '手动', desc: '总是用默认分区' },
          { value: 'auto', label: '自动', desc: '按内容挑，挑不到回落默认' },
        ], { width: 180 })),
      h(Row, { label: '发帖默认分区', hint: s && (s.topicsList || []).length ? '文章帖必须挂分区，否则会报「请添加分区」。下面是接口拉到的全部分区（' + (s.topicsList || []).length + ' 个）' : '文章帖必须挂分区，否则会报「请添加分区」；点「刷新分区」能拉到全部' },
        f.select('heybox.defaultTopic',
          // 优先用接口拉到的真实分区全表；拉不到才退回内置那几个
          (s && (s.topicsList || []).length)
            ? (s.topicsList || []).map((t) => ({
              value: Number(t.id) || t.id,
              label: t.name,
              desc: [t.game ? '游戏分区' : '综合分区', t.hot ? '热度 ' + t.hot : ''].filter(Boolean).join(' · '),
            }))
            : [
              { value: 7214, label: '盒友杂谈', desc: '最常用，什么都能聊' },
              { value: 18745, label: '数码硬件', desc: '显卡、笔记本、外设' },
              { value: 806933, label: 'AI', desc: 'AI 相关，容易涨浏览' },
              { value: 549999, label: '校园生活', desc: '学生党话题' },
              { value: 73907, label: '沙雕日常', desc: '搞笑日常' },
              { value: 425422, label: 'Steam', desc: 'Steam 促销 / 游戏库' },
            ],
          { width: 220 })),
      s && s.topicsCache ? h(Row, { label: '分区表', hint: '每天自动拉一次，不用手动管' },
        h('div', { className: 'ab-flex' },
          h('span', { className: 'ab-small ab-muted' }, (s.topicsCache.count || 0) + ' 个分区 · ' + (s.topicsCache.cached ? '今天已更新' : '刚更新')),
          h(Btn, { small: true, onClick: () => post('/heybox/topics/refresh').then((r) => { toast(r.message || '已刷新', r.ok === false ? 'err' : 'ok'); load() }).catch(() => toast('刷新失败', 'err')) }, '刷新分区'))) : null,
      s && s.actsCache ? h(Row, { label: '话题表', hint: '创作活动（有奖励，排最前）和普通话题，都带热度。每天自动更新一次' },
        h('div', { className: 'ab-flex' },
          h('span', { className: 'ab-small ab-muted' }, '活动 ' + (s.actsCache.actCount || 0) + ' 个 · 普通 ' + (s.actsCache.plainCount || 0) + ' 个'),
          h(Btn, { small: true, onClick: () => post('/heybox/acts/refresh').then((r) => { toast(r.message || '已刷新', r.ok === false ? 'err' : 'ok'); load() }).catch(() => toast('刷新失败', 'err')) }, '刷新话题'))) : null,
      s ? h(Row, { label: '今天已经用掉', hint: '到 0 就等明天，或者手动清零（重启一次会话不会重置）' },
        h('div', { className: 'ab-flex' },
          h('span', { className: 'ab-small ab-muted' },
            '逛 ' + (quota.browse || 0) + '/' + (limits.maxRunsPerDay || 0) +
            ' · 赞 ' + (quota.like || 0) + '/' + (limits.likeDaily || 0) +
            ' · 评 ' + (quota.comment || 0) + '/' + (limits.commentDaily || 0) +
            ' · 帖 ' + (quota.post || 0) + '/' + (limits.maxPostsPerDay || 0) + ' · 分享 ' + (quota.share || 0) + '/' + (limits.shareDaily || 0)),
          h(Btn, { small: true, kind: 'ghost', onClick: act('/heybox/clear-quota', 'quota') }, busy === 'quota' ? '清零中…' : '清零')))
        : null,
    ),
    h(Card, {
      title: '每天发多篇：每篇各管各的',
      desc: '配了就按篇数来：今天第 1 篇用第 1 项、第 2 篇用第 2 项……排期用完或没配就回到上面的全局设置。每篇可以单独指定风格、分区、话题、字数。',
      right: h('div', { className: 'ab-flex' },
        h('span', { className: 'ab-small ab-muted' }, '已发 ' + ((s && s.postPlan && s.postPlan.done) || 0) + ' / ' + (((draft.heybox && draft.heybox.dailyPosts) || []).length)),
        h(Btn, { small: true, kind: 'primary', onClick: addPostSlot }, '新增一篇')),
    },
      ((draft.heybox && draft.heybox.dailyPosts) || []).length === 0
        ? h(Empty, { icon: '📅', text: '还没配排期。点右上角「新增一篇」，就能让今天第几篇发什么各不相同。' })
        : h('div', null, ((draft.heybox && draft.heybox.dailyPosts) || []).map(function (p, i) {
            const done = ((s && s.postPlan && s.postPlan.done) || 0) > i
            return h('div', { key: i, style: { marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--ab-line)' } },
              h(Row, { label: '第 ' + (i + 1) + ' 篇' + (done ? '（已发）' : '') },
                h('div', { className: 'ab-flex' },
                  f.select('heybox.dailyPosts.' + i + '.style', [
                    { value: '', label: '跟全局', desc: '用上面的默认风格' },
                    { value: 'diary', label: '大肥鱼日记' },
                    { value: 'news', label: '热搜文' },
                    { value: 'mix', label: '肥鱼热搜' },
                    { value: 'deal', label: '每日羊毛' },
                  ], { width: 150 }),
                  h(Btn, { small: true, kind: 'ghost', onClick: function () { removePostSlot(i) } }, '删')),
              ),
              h(Row, { label: '分区', hint: '留空 = 按上面的模式走（手动用默认 / 自动按内容挑）' },
                f.select('heybox.dailyPosts.' + i + '.topic', [
                  { value: '', label: '跟全局', desc: '' },
                ].concat((topicOpts || []).map(function (t) { return { value: t.id, label: t.name + (t.game ? '（游戏）' : ''), desc: t.id } })),
                { width: 200 })),
              h(Row, { label: '字数' },
                h('div', { className: 'ab-flex' },
                  f.num('heybox.dailyPosts.' + i + '.wordsMin', { min: 0, max: 2000 }), h('span', { className: 'ab-muted' }, '–'),
                  f.num('heybox.dailyPosts.' + i + '.wordsMax', { min: 0, max: 3000 }), h('span', { className: 'ab-muted' }, '字')),
              ),
              h(Row, { label: '话题', hint: '创作活动和普通话题可以一起挂，但一帖共享 3 个名额：活动最多 1 个，占 1 席后普通话题还能选 2 个' },
                h('div', { style: { width: '100%' } },
                  h('div', { className: 'ab-flex', style: { marginBottom: 6 } },
                    h('input', {
                      className: 'ab-input sm', style: { flex: 1, minWidth: 120 },
                      placeholder: '搜话题关键词，如 游戏 / 养鱼 / steam',
                      value: (topicKw[i] || ''),
                      onChange: function (e) { const v = e.target.value; setTopicKw(function (m) { const n = { ...m }; n[i] = v; return n }) },
                    }),
                    renderSelSummary(i)),
                  renderTopicGroups(i)),
              ),
              h(Row, { label: '本篇额外要求', hint: '一句话写进她的提示词，比如「写养鱼日常」「必须带 Steam 折扣链接」' },
                f.text('heybox.dailyPosts.' + i + '.hint', { placeholder: '可留空', width: 300 })),
            )
          })),
    ),
    // ── 今天发到第几篇（只读概览）──────────────────────────
    // 排期是可编辑的，但「今天实际会按哪一项发、下一篇是什么」只有 state 的
    // postPlan 知道（done / current / items 的 empty 标记）。这里补一个只读视图，
    // 免得要自己数「已发了几篇」再去对照上面第几项。
    h(Card, {
      title: '今天发到第几篇',
      right: h('div', { className: 'ab-flex' },
        h(Btn, { small: true, onClick: load }, '刷新')),
      desc: '按今天已发了几篇，依次取上面排期里的对应项。字数低于该项下限会被直接拒发，所以这里的数字要和实际想发的长度对得上。',
    },
      !s ? h(Empty, { icon: '⏳', text: '加载中…' })
        : !(s.postPlan && s.postPlan.configured)
          ? h(Empty, { icon: '📅', text: '还没配排期：她发帖会走上面的默认风格和默认字数。' })
          : h('div', null,
            h('div', { className: 'ab-list' }, ((s.postPlan && s.postPlan.items) || []).map((it) => h('div', { key: it.index, className: 'ab-li' },
              h('div', { className: 'meta' },
                '第 ' + it.index + ' 篇',
                it.done ? h('span', { style: { color: 'var(--ab-ok)', marginLeft: 4 } }, '✓ 已发') : null),
              h('div', { className: 'body' },
                h('div', null,
                  h('span', { className: 'ab-badge' }, it.empty ? '跟全局' : (HEYBOX_STYLE_LABEL[it.style] || it.style || '默认')),
                  h('span', { className: 'ab-muted' }, '  ·  分区 ' + (it.topic || '默认') + '  ·  ' + (it.wordsMin || '?') + '-' + (it.wordsMax || '?') + ' 字')),
                (it.hashtagsText || (it.hashtags || []).join(', '))
                  ? h('div', { className: 'ab-muted' }, '话题：' + (it.hashtagsText || (it.hashtags || []).join(', ')))
                  : null,
                it.hint ? h('div', { className: 'ab-muted' }, '提示：' + it.hint) : null)))),
            (s.postPlan && s.postPlan.current)
              ? h('div', { className: 'ab-note', style: { marginTop: 8 } },
                '下一篇（第 ' + (s.postPlan.current.index || '?') + ' 篇）会按：' +
                (HEYBOX_STYLE_LABEL[s.postPlan.current.style] || s.postPlan.current.style || '默认风格') +
                ' / ' + (s.postPlan.current.wordsMin || '?') + '-' + (s.postPlan.current.wordsMax || '?') + ' 字' +
                (s.postPlan.current.hashtagsText ? ' / 话题「' + s.postPlan.current.hashtagsText + '」' : ''))
              : h('div', { className: 'ab-note', style: { marginTop: 8 } }, '排期已经走完了，后面几篇都会回到全局设置。'),
          ),
    ),
    // ── 话题库（只读）────────────────────────────────────
    // state 早就返回 actsList（活动在前、带热度）。上面只有「刷新话题」按钮和数量，
    // 看不到具体有哪些活动可挂，这里补一个可读列表。
    h(Card, {
      title: '话题库',
      right: h('div', { className: 'ab-flex' },
        h(Btn, { small: true, kind: 'primary', onClick: () => post('/heybox/acts/refresh').then((r) => { toast(r.message || '已刷新', r.ok === false ? 'err' : 'ok'); load() }).catch(() => toast('刷新失败', 'err')), disabled: !!busy }, busy === 'acts' ? '刷新中…' : '刷新话题'),
        h(Btn, { small: true, onClick: load }, '重新读')),
      desc: '写帖要挂话题就从这里挑（带「活动」角标的优先，有奖励）。活动和普通话题**可以一起挂**，但一帖**共享 3 个名额**：活动最多 1 个，剩下的给普通话题（和排期里的话题勾选、模块侧截断同一口径）。她发帖时话题是以**纯文本名字**提交的，服务端自己匹配成话题；传对象（name+hashtag_id）会让发帖直接失败。',
    },
      (() => {
        const acts = s && (s.actsList || [])
        if (!acts || !acts.length) return h(Empty, { icon: '🏷️', text: '还没拉到话题。点右上角「刷新话题」（要扫十几页信息流，慢一点）。' })
        const actOnly = acts.filter((x) => x.isAct)
        const plainOnly = acts.filter((x) => !x.isAct)
        const line = (x) => h('div', { key: 'a' + x.id, className: 'ab-li' },
          h('div', { className: 'body' },
            h('div', null,
              h('span', { style: { fontWeight: 600 } }, x.name),
              x.isAct ? h('span', { className: 'ab-badge', style: { marginLeft: 6 } }, '活动') : null,
              x.contentNum ? h('span', { className: 'ab-muted', style: { marginLeft: 6 } }, '热度 ' + x.contentNum) : null),
            x.actTitle ? h('div', { className: 'ab-muted' }, x.actTitle) : null))
        return h('div', null,
          s && s.actsCache
            ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 6 } },
              '共 ' + (s.actsCache.count || 0) + ' 个（活动 ' + (s.actsCache.actCount || 0) + '，普通 ' + (s.actsCache.plainCount || 0) + '）' +
              (s.actsCache.cached ? ' · 今天已缓存' : ' · 缓存是 ' + (s.actsCache.date || '旧的')))
            : null,
          actOnly.length ? h('div', { style: { marginBottom: 10 } }, h('div', { className: 'ab-small', style: { fontWeight: 600, marginBottom: 4 } }, '创作活动（优先挂，有奖励）'), h('div', { className: 'ab-list' }, actOnly.slice(0, 8).map(line))) : null,
          plainOnly.length ? h('div', null, h('div', { className: 'ab-small', style: { fontWeight: 600, marginBottom: 4 } }, '普通话题（按热度）'), h('div', { className: 'ab-list' }, plainOnly.slice(0, 12).map(line))) : null)
      })(),
    ),
    h(Card, {
      title: '热榜预览', right: h('div', { className: 'ab-flex' },
        h(Btn, { small: true, onClick: load }, '刷新'),
        h(Btn, { small: true, kind: 'primary', onClick: loadHot, disabled: !!busy }, busy === 'hot' ? '拉取中…' : '看热榜')),
      desc: 'ta写帖前会先看这个（热榜 → 搜社区 → 找具体素材）。这里只是让你看看现在有什么题，热榜里电竞和商业新闻不适合这个号。',
    },
      !hot ? h(Empty, { icon: '🔥', text: '点右上角「看热榜」，看看现在小黑盒在热议什么。' })
        : (hot.list || []).length === 0 ? h(Empty, { icon: '🔥', text: '热榜是空的，可能接口变了。' })
        : h('div', { className: 'ab-list' }, (hot.list || []).map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, String(i + 1)), h('div', { className: 'body' }, x.text, x.tag ? h('span', { className: 'ab-muted' }, '  [' + x.tag + ']') : null)))),
    ),
    h(Card, {
      title: '发帖自检（ta发之前自己过一遍）',
      desc: '这几条写在ta的规则里，不满足就不发。你也可以照着看，ta要发的帖哪条对不上就让改。',
    },
      h('div', { className: 'ab-note', style: { marginBottom: 8, whiteSpace: 'pre-line' } },
        [
          '① 先看热榜挑题（不许跳过），挑不出来就说今天没合适的，别硬凑。',
          '② 再看社区高赞帖在聊什么角度，可以借角度但用自己的话。',
          '③ 素材里必须有具体的东西：价格、销量、时长、机制名、star 增速——没具体信息就是水文。',
          '④ 标题别和正文第一行重复；不编造第一人称经历；正文要达到排期要求的字数（低于下限会被直接拒发）。',
          '⑤ 配图不用ta操心：不传图时按字数自动配（≤500 字文末 1 张、500-1000 字首段后+文末、1000 字以上每多 1000 字文中再加），画不出来才用表情包库兜底；一张都拿不到就按纯文字发并标 textOnly。',
          '⑥ 不碰政治、医疗法律建议、评价真人、判断价格是否合理；读一遍像不像人话（转折词堆砌就是 AI 腔）。',
        ].join('\n')),
      h('div', { className: 'ab-note warn' },
        [
          '格式上的坑（已修在内核里）：',
          '· 帖子类型必须是「文章」(link_tag=11) 才能解析 HTML 并把图插在文字中间；分区 id 必须是真实存在的，乱填会报「错误的帖子类型」。',
          '· 话题（hashtag）必须传**话题名字**的纯文本数组，不能传 {name,hashtag_id} 对象——对象会让发帖直接 HTTP 500。话题写进帖子的 content_tags（style_type=2），不在 hashtags 字段，别拿那个字段当验收标准。',
          '· 图片必须按真实宽高上传；以前写死 1000x600，方图会被压扁。',
          '· 「每日羊毛」必须带真实直达链接，没链接会被 no_link 拒发。',
        ].join('\n')),
    ),
    h(Card, {
      title: 'ta逛过什么', right: h('div', { className: 'ab-flex' },
        h(Btn, { small: true, onClick: load }, '刷新'),
        h(Btn, { small: true, kind: 'primary', onClick: act('/heybox/run', 'run'), disabled: !!busy }, busy === 'run' ? '正在逛…' : '现在逛一圈')),
    },
      s && s.lastSkipReason ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } }, '上次没逛成：' + s.lastSkipReason) : null,
      s ? h('div', { className: 'ab-muted ab-small', style: { marginBottom: 8 } },
        s.lastRun ? '上次逛：' + timeAgo(s.lastRun) : '还没逛过') : null,
      !s ? h(Empty, { icon: '⏳', text: '加载中…' })
        : (s.history || []).length === 0 ? h(Empty, { icon: '📭', text: '还没逛过。先填 Cookie、打开开关，再点「现在逛一圈」。' })
        : h('div', { className: 'ab-list' }, (s.history || []).map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, timeAgo(x.at), h('br'), HEYBOX_KIND[x.kind] || x.kind),
          h('div', { className: 'body' },
            x.linkId ? h('a', { href: 'https://www.xiaoheihe.cn/app/bbs/link/' + x.linkId, target: '_blank', rel: 'noreferrer' }, x.title || x.linkId) : null,
            x.text ? h('div', { className: 'ab-muted' }, x.text) : null,
            x.count ? h('div', { className: 'ab-muted' }, '看了 ' + x.count + ' 条') : null)))),
    ),
  )
}

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

export { CONTENT_PLATFORMS, ContentTab, BILI_KIND, Bili, BiliDanmaku, ShotCell, DOUYIN_KIND, Douyin, HEYBOX_KIND, HEYBOX_STYLE_LABEL, Heybox, PaintGallery, PaintCell, CodexSub }
