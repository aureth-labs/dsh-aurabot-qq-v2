import { useState, useEffect, useRef, Fragment } from '../../core/ui/react.ts'
import { clone, get, post } from '../../core/api/api.ts'
import { getPath, pct, setPath } from '../../core/ui/format.ts'
import { modOn } from '../../core/nav/nav.ts'
import { Btn, Card, Choices, Empty, ListArea, Row, Seg, Select, Switch, cx, h, useField } from '../../core/ui/ui.ts'
import { PersonMemoryReset } from '../persona/persona-graph.ts'
import { NoticeWorkspaces } from '../persona/persona.ts'

function Access(props) {
  const [tab, setTab] = useState('global')
  return h('div', { className: 'ab-grid' },
    h('div', null, h(Seg, { value: tab, onChange: setTab, options: [
      { value: 'global', label: '全局设置' }, { value: 'people', label: '私聊用户' }, { value: 'groups', label: '群聊' },
    ] })),
    tab === 'people' ? h(PrivatePermissions, props)
      : tab === 'groups' ? h(GroupPermissions, props) : h(GlobalAccess, props),
  )
}

function usePermissionSave(toast, reload) {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const save = async (path, payload) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    try {
      const result = await post(path, payload)
      if (!result.ok) { toast(result.message || '保存权限失败', 'err'); return false }
      if (path === '/permissions/subject' || result.changed) await reload()
      toast(result.message || '权限已保存', 'ok')
      return true
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const apply = (id, kind, changes) => save('/permissions/subject', { id, kind, changes })
  const applyMany = (ids) => save('/permissions/private-batch', { ids })
  return { busy, apply, applyMany }
}

function PrivatePermissions({ st, toast, reload }) {
  const [catalog, setCatalog] = useState(null)
  const [friends, setFriends] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [quickQQ, setQuickQQ] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [permissionGroupsOpen, setPermissionGroupsOpen] = useState({ 功能: true })
  const { busy, apply, applyMany } = usePermissionSave(toast, reload)
  const modules = (st.modules || []).map(({ id, running, commands }) => [id, running, commands])
  const catalogVersion = JSON.stringify(modules)
  useEffect(() => {
    let active = true
    get('/permissions/catalog').then((r) => { if (active) setCatalog(r) })
    return () => { active = false }
  }, [catalogVersion])
  const loadFriends = async () => {
    try {
      const r = await get('/permissions/friends')
      if (r.ok) { setFriends(r.friends); return true }
      toast(r.message || '读取好友失败', 'err')
    } catch (error) { toast(error.message || '读取好友失败', 'err') }
    return false
  }
  const cfg = st.config
  const owner = String(cfg.ownerQQ)
  const privateAllow = (cfg.allow.private || []).map(String)
  const isOpen = (qq) => privateAllow.includes(String(qq))
  const saved = [cfg.allow.private, ...Object.values(cfg.capabilityAllow || {}), ...Object.values(cfg.commandAllow || {})]
  const ids = [...new Set(saved.flat().map(String))].filter((id) => id !== owner)
  const names = new Map<string, string>(friends.map(({ id, name }): [string, string] => [String(id), String(name)]))
  const q = query.trim().toLowerCase()
  const matching = [...new Set([...ids, ...names.keys()])].filter((id) => id !== owner && (!q ? ids.includes(id) || names.has(id) : id.includes(q) || names.get(id)?.toLowerCase().includes(q)))
  const entries = matching.slice(0, 50)
  const id = selected || (!q ? entries[0] : '')
  const open = Boolean(id && isOpen(id))
  const has = (key) => key === 'chat' ? open : (cfg.capabilityAllow?.[key] || cfg.commandAllow?.[key] || []).includes(id)
  const canOpen = /^\d{5,12}$/.test(q) && q !== owner && !entries.includes(q)
  const permissions = catalog?.list || []
  const known = new Set(permissions.map(({ key }) => key))
  const inactive = Object.keys(cfg.commandAllow || {}).filter((key) => has(key) && !known.has(key))
  const quickId = quickQQ.trim()
  const canQuickAdd = /^\d{5,12}$/.test(quickId) && quickId !== owner && !isOpen(quickId)
  const addPrivate = async (qq) => {
    if (!/^\d{5,12}$/.test(String(qq)) || String(qq) === owner) return
    if (await apply(String(qq), 'private', { chat: true })) { setSelected(String(qq)); setQuickQQ('') }
  }
  const batchTokens = batchText.split(/[\s,，;；、]+/).filter(Boolean)
  const batchValid = batchTokens.filter((value) => /^\d{5,12}$/.test(value))
  const batchUnique = [...new Set(batchValid)]
  const ownerCount = batchUnique.filter((value) => value === owner).length
  const batchIds = batchUnique.filter((value) => value !== owner)
  const batchAdd = batchIds.filter((value) => !isOpen(value))
  const tooManyBatchAdd = batchAdd.length > 500
  const batchDuplicates = batchValid.length - batchUnique.length
  const batchInvalid = batchTokens.length - batchValid.length
  const toggle = ({ key, label, description }) => {
    const publicFeature = (key === 'image' && cfg.imageGen.ownerOnly === false) || (key === 'song' && cfg.song.ownerOnly === false)
    const hint = publicFeature ? `${description}。当前功能对所有白名单会话开放。` : description
    return h(Row, { key, label, hint },
      h(Switch, { on: has(key), title: label, disabled: busy, onChange: (value) => apply(id, 'private', { [key]: value }) }))
  }
  return h('div', { className: 'ab-permission-grid' },
    h(Card, { title: '私聊用户', className: 'ab-permission-card', desc: '按昵称选好友，或输入 QQ 号添加。', right: h('div', { className: 'ab-flex', style: { gap: 6, flexWrap: 'wrap' } },
      h(Btn, { small: true, kind: 'ghost', onClick: loadFriends }, friends.length ? '刷新好友' : '读取 QQ 好友'),
      h(Btn, { small: true, kind: 'primary', onClick: () => setBatchOpen(!batchOpen) }, batchOpen ? '收起' : '批量添加')) },
      h('input', { className: 'ab-input wide', value: query, 'aria-label': '搜索已授权用户或好友昵称', placeholder: '搜索已授权用户或好友昵称', onChange: (e) => setQuery(e.target.value) }),
      h('div', { className: 'ab-flex', style: { marginTop: 6, flexWrap: 'wrap' } },
        h('input', { className: 'ab-input', style: { flex: 1, minWidth: 140 }, inputMode: 'numeric', value: quickQQ, 'aria-label': '直接输入 QQ 号添加私聊', placeholder: '输入 QQ 号（5～12 位）', onChange: (e) => setQuickQQ(e.target.value) }),
        h(Btn, { kind: 'primary', disabled: busy || !canQuickAdd, onClick: () => addPrivate(quickId) }, '添加私聊'),
      ),
      batchOpen ? h('div', { className: 'ab-permission-bulk' },
        h('div', { className: 'ab-flex', style: { marginBottom: 6 } },
          h('b', null, '批量添加私聊白名单'), h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, kind: 'ghost', onClick: () => setBatchOpen(false) }, '关闭')),
        h('textarea', { className: 'ab-textarea', style: { width: '100%', minHeight: 76, boxSizing: 'border-box' }, value: batchText, 'aria-label': '批量 QQ 号列表', placeholder: '粘贴 QQ 号，支持换行、空格、逗号或顿号', onChange: (e) => setBatchText(e.target.value) }),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', marginTop: 6 } },
          h('span', { className: 'ab-muted ab-small' }, `可新增 ${batchAdd.length} 人 · 重复 ${batchDuplicates} 个 · 跳过主人 ${ownerCount} 个 · 格式不对 ${batchInvalid} 条`),
          h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, kind: 'primary', disabled: busy || !batchAdd.length || tooManyBatchAdd, onClick: async () => { if (await applyMany(batchAdd)) setBatchText('') } }, `批量添加 ${batchAdd.length} 人`))) : null,
      h('div', { className: 'ab-permission-people' }, entries.map((qq) => h('div', { key: qq, className: 'ab-permission-person-row' },
        h('button', {
          type: 'button', className: cx('ab-permission-person', qq === id && 'on'), 'aria-pressed': qq === id,
          disabled: busy, onClick: () => setSelected(qq),
        }, h('span', null, names.get(qq) || qq, names.get(qq) ? h('small', null, qq) : null),
        h('small', null, isOpen(qq) ? '允许私聊' : ids.includes(qq) ? '已暂停' : '未授权')),
        !isOpen(qq) ? h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => addPrivate(qq) }, '添加') : null))),
      canOpen ? h(Btn, { small: true, disabled: busy, onClick: () => setSelected(q) }, `查看 ${q} 的权限`) : null,
      !entries.length && !canOpen ? h('p', { className: 'ab-muted ab-small' }, q ? '没有匹配的用户' : '读取好友后可以按昵称添加；也可以在上方直接输入 QQ 号。') : null,
      matching.length > entries.length ? h('p', { className: 'ab-muted ab-small' }, '请继续输入，缩小搜索范围。') : null,
    ),
    !id ? h(Card, null, h(Empty, { text: '选择一位私聊用户来管理授权' }))
      : h(Card, { title: names.get(id) || id, className: 'ab-permission-card', desc: names.get(id) ? `QQ ${id}` : undefined },
        h('div', { className: 'ab-permission-options' }, toggle({ key: 'chat', label: '允许私聊', description: '关闭会暂停这个人的其他授权，重新开启即可恢复。' })),
        !open ? h('p', { className: 'ab-muted ab-small' }, '这个人目前无法私聊。可以先选好功能，开启私聊后授权生效。') : null,
        catalog?.ok === false ? h('p', { className: 'ab-note err' }, catalog.message || '读取可授权项失败') : null,
        catalog?.ok ? h(Fragment, null,
          h('div', { className: 'ab-flex', style: { margin: '10px 0', flexWrap: 'wrap' } },
            h(Btn, { small: true, disabled: busy || (open && has('help') && has('reset')), onClick: () => apply(id, 'private', { chat: true, help: true, reset: true }) }, open ? '授予会话自助' : '开放私聊和会话自助'),
            h('span', { className: 'ab-muted ab-small' }, '包含 /help、/reset')),
          ['功能', '命令', '扩展命令'].map((group) => {
            const items = permissions.filter((item) => item.group === group)
            if (!items.length) return null
            const collapsible = group !== '功能'
            const open = !collapsible || permissionGroupsOpen[group] === true
            const optionsId = `private-permissions-${group}`
            return h('section', { key: group, className: 'ab-permission-section' },
              collapsible
                ? h('div', { className: 'ab-row ab-permission-group-row' },
                  h('div', { className: 'ab-label' }, h('b', null, group)),
                  h('div', { className: 'ab-ctl' }, h('button', { type: 'button', className: 'ab-btn sm primary', 'aria-expanded': open, 'aria-controls': optionsId, onClick: () => setPermissionGroupsOpen((old) => ({ ...old, [group]: !open })) }, open ? '收起' : '展开')))
                : h('h4', null, group),
              open ? h('div', { id: optionsId, className: 'ab-permission-options' }, items.map(toggle)) : null,
            )
          }),
          inactive.length ? h('section', { className: 'ab-permission-section' }, h('h4', null, '当前不可用的授权'),
            inactive.map((key) => toggle({ key, label: key, description: '此模块命令未启用或已停止开放，可以撤销原授权。' }))) : null,
        ) : null,
        modOn(st, 'memory') ? h(Row, { label: '用户记忆' }, h(PersonMemoryReset, { key: id, qq: id, toast })) : null,
      ),
  )
}

function GroupPermissions({ st, toast, reload, go }) {
  const [input, setInput] = useState('')
  const { busy, apply } = usePermissionSave(toast, reload)
  const id = input.trim()
  const groups = st.config.allow.groups
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '群消息设置', desc: '选一个群，设置是否聊天、仅用模块，以及旁听。无需另外添加白名单。' },
      h(Btn, { kind: 'primary', onClick: () => go('group') }, '打开群聊设置'),
      h('details', { style: { marginTop: 16 } },
        h('summary', { style: { cursor: 'pointer' } }, '直接编辑群白名单'),
        h('p', { className: 'ab-muted ab-small' }, '这里仅改名单，操作立即生效。新群默认允许 AI 聊天；已有的「仅模块」限制保留。'),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap' } },
          h('input', { className: 'ab-input', 'aria-label': '群号', placeholder: '输入群号', inputMode: 'numeric', value: input, onChange: (e) => setInput(e.target.value) }),
          h(Btn, { disabled: busy || !/^\d{5,}$/.test(id) || groups.includes(id), onClick: async () => { if (await apply(id, 'group', { chat: true })) setInput('') } }, '添加群聊')),
        groups.map((qq) => h(Row, { key: qq, label: qq, hint: (st.config.group.moduleOnlyGroups || []).includes(qq) ? '仅模块' : '允许 AI 聊天' }, h(Btn, { small: true, disabled: busy, onClick: () => apply(qq, 'group', { chat: false }) }, '移除')))),
    ),
    modOn(st, 'group-admin') ? h(GroupRoles, null) : null,
  )
}

function GlobalAccess({ st, draft, setDraft, toast }) {
  const f = useField(draft, setDraft)
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '主人', desc: '主人的 QQ 号。群管、点歌、电脑上的操作只听主人的。' },
      h(Row, { label: '主人 QQ 号' }, f.text('ownerQQ')),
      h(Row, { label: 'ta怎么称呼你' }, f.text('ownerName', { placeholder: '主人' })),
      h(Row, { label: '主人私聊的权限', hint: '群聊永远没有电脑操作权限，这里管不到群。' },
        h('div', { style: { width: '100%' } },
          h(Choices, { value: draft.ownerLevel, onChange: (v) => setDraft(setPath(draft, 'ownerLevel', v)), options: [
            { value: 'full', label: '完整', desc: '私聊里让ta用电脑做事（查文件、跑命令、上网查）也能做' },
            { value: 'social', label: '受限', desc: '只有发表情、发说说这类 QQ 工具，碰不到电脑' },
            { value: 'chat', label: '纯聊天', desc: '什么工具都没有，只聊天' },
          ] }),
          h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '切换后会给主人私聊换一个新的 DSH 会话（旧的还在侧栏里）。'))),
      h(Row, { label: '上报到 QQ', hint: '有会话在等授权、等你选东西时，ta 会用自己的话提醒你一句。' }, f.sw('notice.enabled')),
      h(Row, { label: '要授权时提醒', hint: '工具卡住、等你点批准的时候。' }, f.sw('notice.approval')),
      h(Row, { label: '要选选项时提醒', hint: '需要你选东西的时候。' }, f.sw('notice.question')),
      h(Row, { label: '合并等待（秒）', hint: '连着来几件事时先攒一会儿再提醒，免得刷屏。默认 8。' },
        // 非受控 + onChange：输入时不重渲染（不会弹回），但值实时写进 draft，不用失焦也不会丢
        h('input', {
          className: cx('ab-input', 'sm'),
          defaultValue: getPath(draft, 'notice.windowSec') ?? '',
          placeholder: '8',
          inputMode: 'numeric',
          onChange: (e) => setDraft(setPath(draft, 'notice.windowSec', e.target.value)),
        }),
        h('span', { className: 'ab-muted' }, ' 秒')),
      h(NoticeWorkspaces, { toast }),
      h(Row, { label: 'QQ 接口', hint: '让她用 QQ 的其他能力：别人只能查当前群的公告、精华这些；撤回、设精华、改群名片等只听你的。取 Cookie、发原始包、删好友、退群这些不开放。' }, f.sw('qqApi.enabled')),
      h(Row, { label: '在 QQ 里批准', hint: '回复「确认」批准这一次、回复「取消」拒绝；超时按不批。只认你的私聊回复，DSH 也能同时点。' }, f.sw('approvalViaQQ')),
      h(Row, { label: '等多久算超时（秒）', hint: '在 QQ 里等你回复的时长，默认 300（5 分钟）。' }, f.num('approvalTimeoutSec', { min: 30, max: 1800 }), h('span', { className: 'ab-muted' }, ' 秒')),
      h(Row, { label: '长任务模式', hint: '只在「完整」权限下生效。打开后ta能把命令放到后台跑、跑完自动回来告诉你，也能设定时任务；工具多一点，回话会稍慢。切换后同样换新会话。' },
        h(Choices, { value: draft.longTasks ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'longTasks', v === 'on')), options: [
          { value: 'off', label: '关', desc: '工具少一点，回话快一点' },
          { value: 'on', label: '开', desc: '干长活时能接着聊（默认）' },
        ] })),
      h(Row, { label: '后台子智能体', hint: '默认关。关着时只有你本人最近 5 分钟内说过话，模块才被允许派子智能体（拿本机命令/文件能力干活动）；打开后，定时任务这类没人应答的后台流程也能派——等于把这份能力也交给后台。' },
        h(Choices, { value: draft.subagentBackground ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'subagentBackground', v === 'on')), options: [
          { value: 'off', label: '关', desc: '后台任务不派子智能体（默认）' },
          { value: 'on', label: '开', desc: '后台任务也可以派子智能体' },
        ] })),
    ),
    h(ProfilePerms, { st, draft, setDraft }),
    h(CommandList, null),
  )
}

/** 改资料类操作的权限：关 / 仅主人私聊 / 所有人。 */

function ProfilePerms({ st, draft, setDraft }) {
  const perms = draft.profilePerms || {}
  const douyinOn = modOn(st, 'douyin')
  const heyboxOn = modOn(st, 'heybox')
  const opts = [
    { value: 'off', label: '关', desc: '谁说都不改' },
    { value: 'owner', label: '仅主人私聊', desc: '只有你私聊让ta改才改（默认）' },
    { value: 'all', label: '所有人', desc: '白名单里的人、群里的人都能让ta改' },
  ]
  const row = (key, label, hint?) => h(Row, { label, hint },
    h(Choices, { value: perms[key] || 'owner', onChange: (v) => setDraft(setPath(draft, 'profilePerms.' + key, v)), options: opts }))
  return h(Card, { title: '改资料与名单', desc: 'ta能不能听人的话改自己的 QQ 昵称、签名、头像和 B 站签名，处理好友申请和改白名单；装了抖音、小黑盒模块后，它们的操作权限也在这里。改 QQ 资料要 OneBot 实现支持对应接口。各项默认仅主人。' },
    row('qqNickname', 'QQ 昵称'),
    row('qqSignature', 'QQ 个性签名'),
    row('qqAvatar', 'QQ 头像', '只用网址图片，或「刚才发的那张图」。'),
    row('biliSign', 'B 站签名', '要先在 B 站页登录并打开 B 站。'),
    row('biliAvatar', 'B 站头像', '要先在 B 站页登录并打开 B 站。图片网址或刚才发的图，最大 2MB。'),
    row('biliComment', 'B 站评论', '有人让ta去某个视频下发评论（bili_comment）。「仅主人」也包括你在群里开口。ta自己刷视频时发不发评论，看 B 站页的开关。'),
    row('qqFriendRequest', '处理好友申请', '让ta通过 / 拒绝别人加ta为好友的申请。ta自己主动加别人暂不支持（OneBot v11 没有这个接口）。'),
    row('whitelist', '改白名单', '允许改聊天白名单，主人不能被移出。关闭后，也不能在私聊里管理群接话和旁听；这两项始终只听主人私聊。「所有人」会允许其他人改聊天白名单。'),
    douyinOn && row('douyinBrowse', '刷抖音 / 看视频', '让ta去刷推荐（douyin_browse）、点开别人发来的抖音链接（douyin_watch）。定时自己刷不受这项限制。'),
    douyinOn && row('douyinLike', '抖音点赞', '有人让ta给某个视频点赞；关掉后ta自己刷的时候也不点赞。'),
    douyinOn && row('douyinComment', '抖音评论', '有人让ta去某个视频下评论；关掉后ta自己刷的时候也不评论。'),
    douyinOn && row('douyinShareOwner', '分享抖音给主人', '刷到好玩的视频在 QQ 私聊里发给你（ta的话 + 链接）。'),
    douyinOn && row('douyinDm', '主动发抖音私信', '主人明确让ta给某个人发私信时（主页链接或抖音号）；列表里没有会话会从对方主页发起。默认仅主人私聊。'),
    heyboxOn && row('heyboxBrowse', '逛小黑盒 / 看帖子', '让ta翻信息流（heybox_feed）、读帖子正文和热评（heybox_watch）、看热榜和搜帖子（heybox_hot / heybox_search / heybox_topics）。定时自己逛不受这项限制。'),
    heyboxOn && row('heyboxLike', '小黑盒点赞', '有人让ta给某个帖子点赞；关掉后ta自己逛的时候也不点赞。'),
    heyboxOn && row('heyboxComment', '小黑盒评论', '有人让ta去某个帖子下评论；关掉后ta自己逛的时候也不评论。'),
    heyboxOn && row('heyboxPost', '小黑盒发帖 / 删帖', '让ta发帖（heybox_post，文章模式可带图）和删自己发的帖（heybox_delete）。发帖会用你的账号公开发布，默认仅主人私聊。'),
  )
}

/** QQ 里的主人命令一览。 */

function CommandList() {
  const [list, setList] = useState([])
  useEffect(() => { get('/commands').then((r) => setList(r.list || [])) }, [])
  return h(Card, { title: 'QQ 命令', desc: '主人可以在 QQ 私聊或白名单群使用命令。其他人获授权后可在自己的私聊使用对应命令。' },
    h('table', { className: 'ab-table' }, h('tbody', null, list.map((c) => h('tr', { key: c.name },
      h('td', { style: { whiteSpace: 'nowrap' } }, h('code', null, '/' + c.name), c.aliases.length ? h('div', { className: 'ab-muted ab-small' }, c.aliases.map((a) => '/' + a).join(' ')) : null),
      h('td', null, c.desc))))))
}

/** 她在每个白名单群里的身份：群主 / 管理员才能禁言踢人。 */

function GroupRoles() {
  const [list, setList] = useState(null)
  const load = () => { setList(null); get('/groups/roles').then((r) => setList(r.list || [])) }
  useEffect(load, [])
  return h(Card, { title: '群管权限', desc: 'ta在群里是群主或管理员时，主人才能让ta禁言、踢人、发公告；改专属头衔要群主。按已保存的群白名单查。',
    right: h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新') },
    !list ? h('div', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 查询中…')
      : list.length === 0 ? h('div', { className: 'ab-muted ab-small' }, '群白名单是空的。')
      : h('table', { className: 'ab-table' },
        h('thead', null, h('tr', null, ['群', 'ta的身份', '群管'].map((x) => h('th', { key: x }, x)))),
        h('tbody', null, list.map((g) => h('tr', { key: g.groupId },
          h('td', null, (g.name && g.name !== g.groupId ? g.name + ' ' : '') + '(' + g.groupId + ')'),
          h('td', null, g.label),
          h('td', null, g.canManage ? h('span', { className: 'ab-badge' }, '可以') : h('span', { className: 'ab-muted ab-small' }, '不行')))))))
}

/** 按群头衔不理：勾选的群里，专属头衔是某个词的成员（别的机器人）她不理。头衔可以从群里现有的里面点一个。 */

function TitleFilter({ draft, setDraft }) {
  const tf = draft.titleFilter || { enabled: true, groups: [], title: '大肥鱼' }
  const [info, setInfo] = useState(null) // { groups, titles, failed, message } 拉过才有 titles
  const [busy, setBusy] = useState(false)
  const set = (p) => setDraft(setPath(draft, 'titleFilter', { ...tf, ...p }))
  const pull = async () => {
    setBusy(true)
    const r = await get('/groups/titles')
    setBusy(false)
    if (r.ok) setInfo(r)
    else setInfo({ groups: [], titles: [], message: r.message || '没拉到' })
  }
  useEffect(() => { pull() }, [])
  const groups = (draft.allow.groups || []).map(String)
  const nameOf = (gid) => { const g = ((info && info.groups) || []).find((x) => x.groupId === gid); return g && g.name && g.name !== gid ? g.name : '' }
  const on = (gid) => tf.groups.includes(gid)
  const hit = info && info.titles ? info.titles.find((t) => t.title === tf.title.trim()) : null
  return h(Card, { title: '按头衔不理（防机器人互聊）', right: h(Switch, { on: tf.enabled, onChange: (v) => set({ enabled: v }) }),
    desc: '同一个群里有别的机器人时，给它们挂上同一个专属头衔（比如「大肥鱼」），ta在勾选的群里就不理它们：说话、@ ta、戳ta都不回，免得机器人之间互相接话停不下来。只认专属头衔，昵称和群名片不算；私聊不受影响。' },
    h(Row, { label: '要不理的头衔', hint: '一字不差才算。下面列出白名单群里现有的头衔，点一个就填进来。' },
      h('div', { style: { width: '100%' } },
        h('div', { className: 'ab-flex' },
          h('input', { className: 'ab-input', value: tf.title, maxLength: 30, placeholder: '大肥鱼', onChange: (e) => set({ title: e.target.value }) }),
          h(Btn, { small: true, onClick: pull, disabled: busy }, busy ? '拉取中…' : '从群里拉取头衔')),
        info && info.titles ? h('div', { className: 'ab-psec-add', style: { marginTop: 10 } },
          info.titles.length
            ? info.titles.slice(0, 30).map((t) => h('button', { key: t.title, type: 'button', className: cx('ab-chip', t.title === tf.title.trim() && 'on'), title: t.members.map((m) => m.name).join('、'), onClick: () => set({ title: t.title }) }, t.title, h('span', { className: 'n' }, t.count + ' 人')))
            : h('span', { className: 'ab-muted ab-small' }, groups.length ? '这些群里还没有人挂专属头衔。' : '先到「聊天 → 群聊」添加群，选择「仅模块」或「允许 AI 聊天」。')) : null,
        hit ? h('div', { className: 'ab-tf-who' }, '挂着「' + hit.title + '」的：' + hit.members.map((m) => m.name + '（' + m.id + '）').join('、') + (hit.count > hit.members.length ? ' 等 ' + hit.count + ' 人' : '')) : null,
        info && info.message ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, info.message) : null)),
    h(Row, { label: '在哪些群生效', hint: '没勾的群照常回。只列白名单里的群。' },
      groups.length
        ? h('div', { className: 'ab-flex' }, groups.map((gid) => h('button', { key: gid, type: 'button', className: cx('ab-chip', on(gid) && 'on'), onClick: () => set({ groups: on(gid) ? tf.groups.filter((x) => x !== gid) : [...tf.groups, gid] }) },
          (on(gid) ? '✓ ' : '') + (nameOf(gid) || '群'), h('span', { className: 'n' }, gid))))
        : h('span', { className: 'ab-muted ab-small' }, '群白名单是空的。')),
    h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '查不到某人的头衔时（网关抽风），那条先不回，过几秒再查；成员改了头衔一分钟内生效。'))
}

/** 主人私聊里问起群里的事：把最近群聊流水补进当轮上下文（默认关）。 */

function OwnerBrief({ draft, setDraft }) {
  const f = useField(draft, setDraft)
  const ob = draft.group.ownerBrief || { enabled: false, lines: 12, groups: [] }
  const groups = (draft.allow.groups || []).map(String)
  const [info, setInfo] = useState(null)
  useEffect(() => { get('/groups/titles').then((r) => { if (r.ok) setInfo(r) }).catch(() => {}) }, [])
  const nameOf = (gid) => {
    const g = ((info && info.groups) || []).find((x) => x.groupId === gid)
    return g && g.name && g.name !== gid ? g.name : ''
  }
  const on = (gid) => (ob.groups || []).includes(gid)
  const toggle = (gid) => setDraft(setPath(draft, 'group.ownerBrief.groups', on(gid) ? (ob.groups || []).filter((x) => x !== gid) : [...(ob.groups || []), gid]))
  return h(Card, { title: '主人私聊：群聊摘要', right: f.sw('group.ownerBrief.enabled'),
    desc: '主人在私聊里问起群里的事时，把最近 24 小时的群聊流水当成「ta自己的见闻」补进这一轮上下文。只在「主人私聊 + 这句话提到群相关」时触发，不常驻、不写进记忆；默认关。先在「聊天 → 群聊」选择「仅模块」或「允许 AI 聊天」。' },
    h(Row, { label: '每个群给几条', hint: '越少越省上下文；最多 30 条' }, f.range('group.ownerBrief.lines', 1, 30, 1, (v) => v + ' 条')),
    h(Row, { label: '只取哪些群', hint: '没勾 = 所有白名单群；只列白名单里的群' },
      groups.length
        ? h('div', { className: 'ab-flex' }, groups.map((gid) => h('button', { key: gid, type: 'button', className: cx('ab-chip', on(gid) && 'on'), onClick: () => toggle(gid) },
          (on(gid) ? '✓ ' : '') + (nameOf(gid) || '群'), h('span', { className: 'n' }, gid))))
        : h('span', { className: 'ab-muted ab-small' }, '先到「聊天 → 群聊」添加群，选择「仅模块」或「允许 AI 聊天」。')),
    h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, 'ta只会当成自己最近在群里看到的，不会把群聊原文说成是主人发的。'))
}

function MemberFilter({ draft, setDraft }) {
  const value = draft.memberFilter || { enabled: true, rules: [] }
  const rules = value.rules
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState('')
  const qq = input.trim()
  const current = rules.find(r => r.userId === selected) || rules[0]
  const saveRules = next => setDraft(setPath(draft, 'memberFilter', { ...value, rules: next }))
  const change = patch => saveRules(rules.map(r => r.userId === current.userId ? { ...r, ...patch } : r))
  const valid = /^[1-9]\d{4,11}$/.test(qq) && qq !== String(draft.ownerQQ)
  return h(Card, { title: '不回应的人', right: h(Switch, { title: '启用不回应名单', on: value.enabled, onChange: enabled => setDraft(setPath(draft, 'memberFilter', { ...value, enabled })) }),
    desc: '在所选群里不回应这些人，包括 @、引用、戳一戳和模块指令。私聊和主人不受影响。' },
    !value.enabled ? h('p', { className: 'ab-note warn' }, '名单已暂停，下面的规则暂不生效。') : null,
    h('div', { className: 'ab-flex', style: { marginBottom: 12 } },
      h('input', { className: 'ab-input', 'aria-label': '添加不回应的 QQ 号', inputMode: 'numeric', placeholder: '输入一个 QQ 号', value: input, onChange: e => setInput(e.target.value) }),
      h(Btn, { small: true, disabled: !valid || (rules.length >= 100 && !rules.some(r => r.userId === qq)), onClick: () => {
        if (!rules.some(r => r.userId === qq)) saveRules([...rules, { userId: qq, scope: 'groups', groups: [] }])
        setSelected(qq); setInput('')
      } }, rules.some(r => r.userId === qq) ? '查看' : '添加')),
    qq && !valid ? h('p', { className: 'ab-note warn' }, qq === String(draft.ownerQQ) ? '主人不会被屏蔽，无需添加。' : '请填一个 5～12 位数字 QQ 号。') : null,
    h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', maxHeight: 160, overflowY: 'auto' } }, rules.map(r =>
      h('button', { type: 'button', key: r.userId, className: cx('ab-chip', current?.userId === r.userId && 'on'), 'aria-pressed': current?.userId === r.userId, onClick: () => setSelected(r.userId) },
        r.userId, h('span', { className: 'n' }, r.scope === 'all' ? '所有群' : r.groups.length ? r.groups.length + ' 个群' : '待选群')))),
    !current ? h('p', { className: 'ab-muted' }, '名单为空，没有按 QQ 号屏蔽任何人。') : h('div', { key: current.userId, style: { marginTop: 16 } },
      h('div', { className: 'ab-flex' }, h('b', null, 'QQ ' + current.userId), h('div', { className: 'ab-spacer' }),
        h(Btn, { small: true, kind: 'ghost', onClick: () => saveRules(rules.filter(r => r.userId !== current.userId)) }, '移出不回应名单')),
      current.userId === String(draft.ownerQQ) ? h('p', { className: 'ab-note' }, '这是当前主人，规则不会拦截此人。') : null,
      h(Row, { label: '在哪些群不回应' }, h(Select, { ariaLabel: 'QQ ' + current.userId + ' 不回应范围', value: current.scope,
        options: [{ value: 'groups', label: '仅指定群' }, { value: 'all', label: '所有群（含以后加入的群）' }], onChange: scope => change({ scope }) })),
      current.scope === 'groups' ? h(Row, { label: '指定群号', hint: '一行一个，也可用逗号分隔。留空不生效，不会自动变成所有群。' },
        h(ListArea, { value: current.groups, numbers: true, placeholder: '填写要生效的群号', onChange: groups => change({ groups }) })) : null,
      current.scope === 'groups' && !current.groups.length ? h('p', { className: 'ab-note' }, '还没选群，这个人暂时不会被屏蔽。') : null,
      h('p', { className: 'ab-muted ab-small' }, '点底部「保存设置」后对新消息生效；已开始的回复和旧记忆保留。')))
}

function GroupOverrides({ draft, setDraft, setSection }) {
  const overrides = draft.group.overrides || {}
  const groupIds = [...new Set([...draft.allow.groups, ...(draft.group.moduleOnlyGroups || []), ...Object.keys(overrides), ...(draft.memory.passiveGroups || [])])]
  const [newGid, setNewGid] = useState('')
  const [selected, setSelected] = useState('')
  const selectedId = groupIds.includes(selected) ? selected : groupIds[0]
  const groupId = newGid.trim()
  const validGroupId = /^[1-9]\d{4,11}$/.test(groupId)
  const modeLabel = id => !draft.allow.groups.includes(id) ? '不响应' : (draft.group.moduleOnlyGroups || []).includes(id) ? '仅模块' : 'AI 聊天'
  return h('div', { className: 'ab-grid' },
    h(Card, { title: '选择群', desc: '选一个群，设置它能做什么；改好后点「保存设置」。' },
      h('div', { className: 'ab-flex', style: { marginBottom: 12 } },
        h('input', { className: 'ab-input', 'aria-label': '查找或添加群号', placeholder: '查找或添加群号', inputMode: 'numeric', value: newGid, onChange: e => setNewGid(e.target.value) }),
        h(Btn, { small: true, disabled: !validGroupId, onClick: () => {
          if (!groupIds.includes(groupId)) setDraft(setPath(draft, 'group.overrides', { ...overrides, [groupId]: {} }))
          setSelected(groupId); setNewGid('')
        } }, groupIds.includes(groupId) ? '查看此群' : '添加群')),
      newGid && !/^\d*$/.test(newGid.trim()) ? h('p', { className: 'ab-note warn' }, '请填数字群号，不要混入文字。') : null,
      h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', marginBottom: 12, maxHeight: 160, overflowY: 'auto' } },
        groupIds.filter(id => id.includes(groupId)).map(id => h('button', { key: id, type: 'button', className: cx('ab-chip', selectedId === id && 'on'), 'aria-pressed': selectedId === id,
          onClick: () => { setSelected(id); setNewGid('') } }, id, h('span', { className: 'n' }, modeLabel(id))))),
      groupId && !groupIds.some(id => id.includes(groupId)) ? h('p', { className: 'ab-muted ab-small' }, validGroupId ? '尚未设置这个群；添加后不会自动开放聊天。' : '没有匹配的群；添加时需填完整的 5～12 位群号。') : null,
      groupIds.length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '输入群号后选择模式；添加一行不会自动开放聊天。') :
        [selectedId].map((gid) => {
          const raw = overrides[gid]
          const mode = !draft.allow.groups.includes(gid) ? 'off' : (draft.group.moduleOnlyGroups || []).includes(gid) ? 'modules' : 'chat'
          const changeMode = value => {
            setSelected(gid)
            const n = clone(draft)
            n.allow.groups = value === 'off' ? n.allow.groups.filter(x => x !== gid) : [...new Set([...n.allow.groups, gid])]
            const restricted = n.group.moduleOnlyGroups || []
            n.group.moduleOnlyGroups = value === 'chat' ? restricted.filter(x => x !== gid) : value === 'modules' ? [...new Set([...restricted, gid])] : restricted
            n.group.overrides[gid] = { ...o }
            setDraft(n)
          }
          const o = raw && typeof raw === 'object' ? raw : {}
          const chance = o.interjectChance ?? draft.group.interjectChance
          const proactive = (o.proactiveEnabled ?? draft.group.proactiveEnabled) !== false && chance > 0
          const engagedFlag = o.engagedEnabled ?? draft.group.engagedEnabled
          const engaged = typeof engagedFlag === 'boolean' ? engagedFlag : chance > 0
          const change = (key, value) => {
            const next = { ...o }
            if (value === '') delete next[key]
            else next[key] = value === 'on'
            setDraft(setPath(draft, 'group.overrides', { ...overrides, [gid]: next }))
          }
          return h('div', { key: gid, style: { borderTop: '1px solid var(--ab-line)', paddingTop: 10, marginTop: 10 } },
            h('h3', null, '群 ' + gid),
            h(Row, { label: '群响应模式' }, h(Select, { ariaLabel: '群 ' + gid + ' 响应模式', value: mode,
              options: [{ value: 'off', label: '不响应群消息' }, { value: 'modules', label: '仅模块' }, { value: 'chat', label: '允许 AI 聊天' }], onChange: changeMode }),
              mode === 'off' ? h('label', { className: 'ab-flex' }, '不响应时仍旁听',
                h(Switch, { title: '群 ' + gid + ' 不响应时仍旁听', on: (draft.memory.passiveGroups || []).includes(gid), onChange: on => {
                  const ids = draft.memory.passiveGroups || []
                  setDraft(setPath(draft, 'memory.passiveGroups', on ? [...new Set([...ids, gid])] : ids.filter(x => x !== gid)))
                } })) : null),
            mode !== 'chat' ? h('div', { className: 'ab-note' }, mode === 'modules' ? '群消息只交给模块；是否回应仍看各模块的开关、权限和时段。AI 聊天设置暂不生效。' : '群消息不触发模块或 AI。' + (!draft.enabled ? '总开关已关闭，旁听暂不记录。' : draft.debug ? '调试模式不记录记忆。' : !draft.memory.enabled ? '记忆已关闭，旁听暂不记录。' : '开启旁听只记新文字，不回复；记忆整理可能产生费用。')) : h('p', { className: 'ab-muted ab-small' }, '被 @、引用或叫名字时按规则回复，仍受总开关、暂停和次数限制。'),
            h('details', { key: gid + ':' + mode, open: mode === 'chat' ? true : undefined },
              h('summary', { style: { cursor: 'pointer', margin: '12px 0' } }, mode === 'chat' ? 'AI 聊天设置' : 'AI 聊天设置（开启 AI 聊天后生效）'),
            ...[['proactiveEnabled', '没人叫时主动插话'], ['engagedEnabled', '聊起来后继续回应']].map(([key, label]) =>
              h(Row, { key, label, hint: key === 'proactiveEnabled' ? '没人叫它时，是否偶尔加入话题。' : '最近 3 分钟聊过，可以继续接话，不必每次 @。' }, h(Select, { ariaLabel: '群 ' + gid + ' ' + label, value: typeof o[key] === 'boolean' ? (o[key] ? 'on' : 'off') : '',
                options: [{ value: '', label: '使用群聊通用设置' }, { value: 'on', label: '开' }, { value: 'off', label: '关' }], onChange: (v) => change(key, v) }))),
            h('div', { className: 'ab-muted ab-small' }, `接话规则：主动插话${proactive ? '开' : '关'}（基础 ${pct(chance)}%），继续回应${engaged ? '开' : '关'}。`),
            chance === 0 ? h('div', { className: 'ab-note warn' }, '概率为 0，不会主动插话；想继续接话，可以单独打开「聊起来后继续回应」。') : null,
            h('details', null, h('summary', { style: { cursor: 'pointer', margin: '12px 0' } }, '插话频率与次数'),
            h(Row, { label: '主动插话概率', hint: '留空使用通用概率；0 表示不主动插话。' },
              h('input', { className: 'ab-input sm', 'aria-label': '群 ' + gid + ' 插话概率', type: 'number', min: 0, max: 100,
                placeholder: String(pct(draft.group.interjectChance)), value: o.interjectChance == null ? '' : pct(o.interjectChance),
                onChange: (e) => { const next = { ...o }; if (e.target.value === '') delete next.interjectChance; else next.interjectChance = Math.max(0, Math.min(100, Number(e.target.value))) / 100; setDraft(setPath(draft, 'group.overrides', { ...overrides, [gid]: next })) } }),
              h('span', { className: 'ab-muted' }, '%')),
            h('p', { className: 'ab-muted ab-small' }, '继续回应不使用主动插话概率，也不受主动插话间隔和每小时上限影响。'),
            h('p', { className: 'ab-muted ab-small' }, (() => {
              const q = o.quietHours || draft.group.quietHours
              return `不主动说话：${q[0] === q[1] ? '未设置' : q.map(v => String(v).padStart(2, '0') + ':00').join('–')}；主动插话每小时最多 ${o.maxPerHour ?? draft.group.maxPerHour} 次；最多连续接话 ${o.engagedMax ?? draft.group.engagedMax} 次。`
            })()),
            h(Btn, { small: true, kind: 'ghost', title: '清除本群单独设置的接话规则；不改响应模式和旁听。', disabled: !Object.keys(o).length, onClick: () => { const n = { ...overrides }; delete n[gid]; setDraft(setPath(draft, 'group.overrides', n)) } }, '本群接话改用通用设置'))),
            h('div', { style: { marginTop: 12 } }, h(Btn, { small: true, kind: 'ghost', onClick: () => setSection('manage') },
              '管理不回应名单（本群 ' + (draft.memberFilter?.enabled ? (draft.memberFilter.rules || []).filter(r => r.userId !== String(draft.ownerQQ) && (r.scope === 'all' || r.groups.includes(gid))).length : 0) + ' 人）')))
        }),
    ),
  )
}

function Group({ draft, setDraft, st, go }) {
  const f = useField(draft, setDraft)
  // 两段：single = 单个群（沿用 GroupOverrides），all = 所有群默认
  const [section, setSection] = useState('single')
  // 「更多设置（N 项）」子折叠卡：只直显少量高频项，其余收进来（复用 Card 的折叠不渲染 children）
  const more = (title, items) => (items.length ? h(Card, { title: (title || '更多设置') + '（' + items.length + ' 项）', collapsible: true, defaultOpen: false, className: 'ab-fold-sub' }, items) : null)
  return h('div', { className: 'ab-grid' },
    h('div', { className: 'ab-flex', style: { marginBottom: 2 } },
      h(Seg, { value: section, onChange: setSection, options: [{ value: 'single', label: '单个群' }, { value: 'all', label: '所有群默认' }] })),
    h(Card, { title: '群聊通用设置', desc: '允许 AI 聊天的群默认按这些规则接话；单个群另有设置的项目优先。' },
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '没人叫时主动插话', hint: '没人叫它、也没在聊天时，偶尔加入话题。' }, f.sw('group.proactiveEnabled', { on: draft.group.proactiveEnabled !== false, title: '没人叫时主动插话' })),
        h(Row, { label: '聊起来后继续回应', hint: '最近 3 分钟聊过，可以继续接相关话题，不必每次 @。' }, f.sw('group.engagedEnabled', { on: typeof draft.group.engagedEnabled === 'boolean' ? draft.group.engagedEnabled : draft.group.interjectChance > 0, title: '聊起来后继续回应' })),
        h(Row, { label: '主动插话概率', hint: '话题越相关，实际概率可能越高；0 表示不主动插话。' }, f.percent('group.interjectChance')),
        h(Row, { label: '最多连续接话几次', hint: '聊起来后，没有人再次叫它时，最多继续回应几次。0 表示不继续接话。' }, f.range('group.engagedMax', 0, 10, 1, (v) => v + ' 次')),
      ),
      draft.group.interjectChance === 0 ? h('div', { className: 'ab-note warn' }, '概率为 0，不会主动插话；想继续接话，可以单独打开「聊起来后继续回应」。') : null),

    section === 'single' ? h(Fragment, null,
      h(GroupOverrides, { draft, setDraft, setSection: () => setSection('all') }),
      h(Card, { title: '相关设置' },
        h('p', { className: 'ab-desc' }, '群模式控制收到消息后是否回应。定时推送、表情制作等模块仍按各自开关和时段运行。'),
        h('div', { className: 'ab-flex', style: { flexWrap: 'wrap' } },
          h(Btn, { small: true, onClick: () => go('memory') }, '记忆总开关与清理'),
          h(Btn, { small: true, onClick: () => go('modules') }, '管理模块'),
          (st.modules || []).some(m => m.id === 'meme' && m.running && m.panel) ? h(Btn, { small: true, onClick: () => go('ext:meme') }, '表情制作与休息时段') : null)),
    ) : null,
    section === 'all' ? h(Fragment, null,

    // 其余通用设置按用途分组。

    // 组行 ① 被叫到时怎么回：6 项流式排一行
    h(Card, { title: '被叫到时怎么回', desc: '群模式为「允许 AI 聊天」时，被 @、引用回复或叫名字会触发回复，仍受总开关、暂停和次数限制。' },
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '用哪些称呼叫它', hint: '一行一个；群里提到这些称呼时，按被叫到的规则回应。' }, f.list('group.wakeWords', { placeholder: '大肥鱼\n肥鱼' })),
        h(Row, { label: '@ 了别人不算叫ta', hint: '有人 @ 别人时顺口提到ta的名字，不算在叫ta；ta还是可以按平时的频率插话。默认关' }, f.sw('group.ignoreAtOthers')),
        h(Row, { label: '每小时必回上限', hint: '一个群里一小时内因被 @、引用、叫名字而必回的次数最多这么多，超过就不回（主人说话不受限，也不计入）；小时一过自动恢复。0 = 不限' }, f.range('group.mustMaxPerHour', 0, 100, 5, (v) => (v === 0 ? '不限' : v + ' 次'))),
        h(Row, { label: '免打扰', hint: '这段时间内只有主人的消息能进；群里其他人 @、引用、唤醒词、追问都不起轮次。清空 = 不启用' },
          h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 8 } },
            h('input', { className: 'ab-input', type: 'time', style: { width: '118px' }, 'aria-label': '免打扰开始时间', value: String(draft.group.guestQuietFrom || ''), onChange: (e) => setDraft(setPath(draft, 'group.guestQuietFrom', e.target.value)) }),
            h('span', { className: 'ab-muted ab-small' }, '到'),
            h('input', { className: 'ab-input', type: 'time', style: { width: '118px' }, 'aria-label': '免打扰结束时间', value: String(draft.group.guestQuietTo || ''), onChange: (e) => setDraft(setPath(draft, 'group.guestQuietTo', e.target.value)) }),
            h(Btn, { small: true, onClick: () => { setDraft(setPath(setPath(draft, 'group.guestQuietFrom', ''), 'group.guestQuietTo', '')) } }, '清空=关'),
            draft.group.guestQuietFrom && draft.group.guestQuietTo
              ? h('span', { className: 'ab-muted ab-small' }, '这段时间只有主人叫得醒她')
              : h('span', { className: 'ab-muted ab-small' }, '未启用')))
      )),

    // 组行 ② 一条消息怎么变成回复：3 个总开关排一行
    h(Card, { title: '一条消息怎么变成回复', desc: '连发合并、合并转发、发送节奏与超时。' },
      h('div', { className: 'ab-grp-row' },
        h(Row, { label: '连发合并', hint: '人常常一口气发好几句。打开后ta会等对方说完再一起回，而不是一句一回。' }, f.sw('merge.enabled')),
        h(Row, { label: '合并转发', hint: '群里有人发合并转发时，她手上只有一个占位符，内容看不见。打开后消息一进来就展开存进上下文，代价是每条转发多调一次接口。' }, f.sw('forward.expandEarly')),
        h(Row, { label: '每段都发', hint: '一轮里她分几段说，就发几条。自动 = 纯对话轮分条，这一轮调过工具（干活）就并成一条发' },
          f.select('chat.everyStep', [
            { value: false, label: '只发最后一段' },
            { value: 'auto', label: '自动（推荐）' },
            { value: true, label: '每段都发' },
          ])),
        h(Row, { label: '近似去重阈值', hint: '分条时，若这一段和上一段字面重合超过这个比例，就按「同一件事说两遍」处理：后一段顶掉前一段，只发一条。0.45 是实测的中间线（真重复 0.49 / 真补充 0.03）；设 1 等于关掉' },
          f.num('chat.dupSimilarity', { min: 0, max: 1, step: 0.05 })),
      )),

    // ===== 折叠区：其余所有组/设置项 =====

    // 折叠 A：接话节奏与时段（7 项）
    more('接话节奏与时段', [
      h(Row, { key: 'cd', label: '两次主动插话的间隔' }, f.range('group.cooldownSec', 0, 600, 10, (v) => v + ' 秒')),
      h(Row, { key: 'mph', label: '每小时最多主动插话' }, f.range('group.maxPerHour', 0, 30, 1, (v) => v + ' 次')),
      h(Row, { key: 'qh', label: '不主动说话的时段', hint: '暂停主动插话和继续接话；被 @ 等仍按规则回复，模块不受影响。起止相同表示不限制。' },
        h('input', { className: 'ab-input sm', 'aria-label': '不主动说话的开始小时', type: 'number', min: 0, max: 23, value: draft.group.quietHours[0], onChange: (e) => setDraft(setPath(draft, 'group.quietHours', [Number(e.target.value), draft.group.quietHours[1]])) }),
        h('span', { className: 'ab-muted' }, '点 到'),
        h('input', { className: 'ab-input sm', 'aria-label': '恢复主动说话的小时', type: 'number', min: 0, max: 23, value: draft.group.quietHours[1], onChange: (e) => setDraft(setPath(draft, 'group.quietHours', [draft.group.quietHours[0], Number(e.target.value)])) }),
        h('span', { className: 'ab-muted' }, '点')),
      h(Row, { key: 'bm', label: '短时间内最多回复' }, f.range('group.burstMax', 1, 20, 1, (v) => v + ' 次'), h('span', { className: 'ab-muted' }, '/'), f.range('group.burstWindowSec', 30, 600, 30, (v) => Math.round(v / 6) / 10 + ' 分钟')),
    ]),

    // 折叠 B：话题与群活跃度（3 项）
    more('话题与群活跃度', [
      h(Row, { key: 'i', label: 'ta感兴趣的话题', hint: '群里在聊这些（或ta记得相关的事）时更容易插话；一行一个' }, f.list('group.interests', { placeholder: '白米饭\n游戏\n追剧' })),
      h(Row, { key: 'r', label: '话题相关度门槛', hint: '和ta关系不大的话题就不插话；拉到 0 = 不看话题、纯随机' }, f.range('group.minRelevance', 0, 1, 0.05, (v) => (v === 0 ? '不看话题' : Math.round(v * 100) + '%'))),
      h(Row, { key: 'a', label: '群冷清时不插话', hint: '最近几分钟内消息少于这个数就不插' }, f.num('group.minRecentMessages', { min: 0 }), h('span', { className: 'ab-muted' }, '条 / '), f.num('group.activeWindowSec', { min: 30 }), h('span', { className: 'ab-muted' }, '秒')),
    ]),

    // 折叠 C：合并与发送明细（7 项）
    more('合并与发送明细', [
      h(Row, { key: 'w', label: '对方停顿多久算说完' }, f.range('merge.waitSec', 0.5, 10, 0.5, (v) => v + ' 秒')),
      h(Row, { key: 'mx', label: '最多等多久', hint: '对方一直在发也最多等这么久' }, f.range('merge.maxSec', 2, 30, 1, (v) => v + ' 秒')),
      h(Row, { key: 'gw', label: '群里停顿多久算一段', hint: '群里大家你一句我一句，多等一会儿把一段话攒齐再回；ta回上一段的时候，新消息也会先攒着' }, f.range('merge.groupWaitSec', 1, 20, 1, (v) => v + ' 秒')),
      h(Row, { key: 'gm', label: '群里最多等多久' }, f.range('merge.groupMaxSec', 3, 60, 1, (v) => v + ' 秒')),
      h(Row, { key: 'fh', label: '早先的也补展开', hint: '开着「合并转发」后，这条再打开：轮到她要回话时，把这一段里还没展开过的转发（最多 3 条）补上。每条只拉一次' }, f.sw('forward.expandHistory')),
      h(Row, { key: 'sh', label: '新会话先补看聊天记录', hint: '会话第一次开口时先读最近几条，接得上话。默认关' }, f.sw('chat.seedHistory')),
      h(Row, { key: 'rt', label: '话写在思考里也捞出来', hint: '她偶尔把要说的话全写在思考里，正文是空的，这一轮就什么都发不出去。打开后从思考里找她自己定稿的那段，找不到就不发。默认关' }, f.sw('chat.rescueFromThinking')),
      h(Row, { key: 'tt', label: '一轮最多等多久（分钟）', hint: '模型或工具卡住时，超过这么多分钟就强制放开，后面的消息正常开新一轮；不然会一直哑着。填 0 不兜底。默认 30' }, f.num('chat.turnTimeoutMinutes', { min: 0, max: 180 })),
    ]),

    // 折叠 D：主人跨群与特权（6 项，含条件显隐）
    more('主人跨群与特权', [
      h(Row, { key: 'pc', label: '私聊里的 /群设置 指令', hint: '私聊发 /群设置 查看用法。直接执行，不经过模型；批量修改先预览，再确认。只控制 /群设置，不影响自然语言管理、/权限 或群内的 /quiet。' }, f.sw('group.privateCommandsEnabled', { title: '群设置指令总开关' })),
      h(Row, { key: 'ob', label: '群聊摘要（主人私聊）', hint: '主人在私聊里问起群里的事时，把最近 24 小时的群聊流水当成「ta自己的见闻」补进这一轮上下文。只在主人私聊且提到群相关时触发，不常驻、不写进记忆；默认关。' }, f.sw('group.ownerBrief.enabled')),
      h(Row, { key: 'ot', label: '群里的本机工具', hint: '默认关：群里ta只能聊天，没有任何电脑操作能力。「只有主人」＝主人在群里说话的那一轮ta才拿得到命令和文件工具。' },
        f.choices('group.ownerTools', [{ value: 'off', label: '谁都不行' }, { value: 'owner', label: '只有主人' }])),
      // 条件显隐：ownerTools 非 off 才出现群列表（保持原有依赖语义）
      draft.group.ownerTools && draft.group.ownerTools !== 'off'
        ? h(Row, { key: 'og2', label: '工具只在这些群生效', hint: '一行一个群号；留空 = 白名单里所有群都生效' }, f.list('group.ownerToolsGroups', { placeholder: '100200300' }))
        : null,
      h(Row, { key: 'cr', label: '能不能看别的群', hint: '只读白名单里的群，一次最多 50 条，主人随时能看。开到「群里也行」后，ta在 A 群的回答全群都看得到；读到的内容也会留在这个会话里。' }, f.choices('group.crossRead', [{ value: 'off', label: '关', desc: '只看当前聊天' }, { value: 'private', label: '私聊可以', desc: '主人，以及私聊里问的人本身在那个群（默认）' }, { value: 'group', label: '群里也行', desc: '再加上群里问的人都在那个群' }])),
      h(Row, { key: 'ol', label: '每个群给几条摘要', hint: '越少越省上下文；最多 30 条' }, f.range('group.ownerBrief.lines', 1, 30, 1, (v) => v + ' 条')),
      h(Row, { key: 'og', label: '摘要只取哪些群', hint: '没勾 = 所有白名单群；只列白名单里的群' }, h(OwnerBriefGroups, { draft, setDraft })),
    ]),

    // 折叠 E：发文件明细（3 项）
    more('发文件', [
      h(Row, { key: 'fe', label: '允许发文件', hint: '关了之后ta不能发任何本机文件。' }, f.sw('files.enabled')),
      h(Row, { key: 'd', label: '单个文件最大' }, f.num('files.maxMB', { min: 1, max: 2048 }), h('span', { className: 'ab-muted' }, ' MB')),
      h(Row, { key: 'dir', label: '额外允许的目录', hint: '一行一个完整路径。QQ 工作区里的文件一直允许，不用写；留空 = 只能发工作区里的' }, f.list('files.dirs', { placeholder: 'D:\\Aurabot\\要发的文件' })),
      h(Row, { key: 'p', label: '图片按路径直发', hint: '网关和 NapCat 在同一台机器或共享挂载时，直接把路径交给网关，省掉读盘和 base64 膨胀；网关读不到会自动改用 base64。默认开。' }, f.sw('files.imageByPath')),
    ]),

    // 折叠 F：不想理的人与头衔（整卡默认折叠，内容自成一卡）
    h(Card, { title: '不想理的人与头衔', desc: '按 QQ 号或群头衔屏蔽：说了也不回（包括 @、引用、戳一戳和模块指令）。私聊和主人不受影响。', collapsible: true, defaultOpen: false },
      h(MemberFilter, { draft, setDraft }),
      h(TitleFilter, { draft, setDraft }),
    ),

    ) : null,
  )
}

/** 群聊摘要的群多选（原 OwnerBrief 内联逻辑抽出，供「更多设置」复用） */

function OwnerBriefGroups({ draft, setDraft }) {
  const ob = draft.group.ownerBrief || { enabled: false, lines: 12, groups: [] }
  const groups = (draft.allow.groups || []).map(String)
  const [info, setInfo] = useState(null)
  useEffect(() => { get('/groups/titles').then((r) => { if (r.ok) setInfo(r) }).catch(() => {}) }, [])
  const nameOf = (gid) => {
    const g = ((info && info.groups) || []).find((x) => x.groupId === gid)
    return g && g.name && g.name !== gid ? g.name : ''
  }
  const on = (gid) => (ob.groups || []).includes(gid)
  const toggle = (gid) => setDraft(setPath(draft, 'group.ownerBrief.groups', on(gid) ? (ob.groups || []).filter((x) => x !== gid) : [...(ob.groups || []), gid]))
  return h('div', { className: 'ab-flex', style: { flexWrap: 'wrap' } }, groups.length
    ? groups.map((gid) => h('button', { key: gid, type: 'button', className: cx('ab-chip', on(gid) && 'on'), onClick: () => toggle(gid) },
      (on(gid) ? '✓ ' : '') + (nameOf(gid) || '群'), h('span', { className: 'n' }, gid)))
    : h('span', { className: 'ab-muted ab-small' }, '先到「聊天 → 单个群」添加群，选择「仅模块」或「允许 AI 聊天」。'))
}

export { Access, usePermissionSave, PrivatePermissions, GroupPermissions, GlobalAccess, ProfilePerms, CommandList, GroupRoles, TitleFilter, OwnerBrief, MemberFilter, GroupOverrides, Group, OwnerBriefGroups }
