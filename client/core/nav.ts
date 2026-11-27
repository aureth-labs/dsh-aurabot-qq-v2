import React, { useState, useEffect, useRef } from './ui/react.ts'
import { WhaleIcon, navIcon } from './ui/icons.ts'
import { Btn, Card, cx, h } from './ui/ui.ts'

// ---------------- 标签页 ----------------
type TabDef = { id: string; label: string; flag?: string; flagFn?: (cfg: any) => boolean; flagDefault?: any; ext?: any; page?: any; navGroup?: string }
const TABS: TabDef[] = [
  { id: 'overview', label: '概览' },
  { id: 'manage', label: '管理功能' },
  { id: 'bots', label: '机器人' },
  { id: 'connect', label: '连接' },
  { id: 'character', label: '人格' },
  { id: 'access', label: '权限' },
  { id: 'group', label: '聊天', flag: 'group' },
  { id: 'model', label: '模型' },
  { id: 'voice', label: '语音', flag: 'voice.enabled' },
  { id: 'stickers', label: '表情包', flag: 'stickers.enabled' },
  { id: 'imagegen', label: '生图', flag: 'imageGen.enabled' },
  { id: 'video', label: '视频', flagFn: (cfg) => { const v = cfg.video || {}; const p = v.provider || 'local'; return p === 'local' ? Boolean(cfg.local && cfg.local.video) : p === 'minimax' ? Boolean(v.minimax && v.minimax.apiKeySet) : Boolean(v.custom && v.custom.createUrl && v.custom.queryUrl) } },
  { id: 'speakup', label: '目的引擎', flag: 'ext.purpose.enabled' },
  { id: 'autotelic', label: '自驱引擎（实验）', flag: 'ext.autotelic.enabled' },
  { id: 'pet', label: '桌宠' },
  { id: 'mood', label: '心情', flag: 'mood.enabled' },
  { id: 'memory', label: '记忆', flag: 'memory.enabled' },
  { id: 'song', label: '翻唱', flag: 'song.enabled' },
  { id: 'local', label: '本地接口' },
  { id: 'browser', label: '浏览器' },
  { id: 'security', label: '安全防护' },
  { id: 'market', label: '模块市场' },
  { id: 'modules', label: '已安装' },
  { id: 'backup', label: '备份' },
  { id: 'about', label: '关于' },
  { id: 'logs', label: '日志' },
]

// 内置标签页属于哪个模块：模块都没在跑就不显示这一页（语音识别 asr 已并入「语音」页）
const TAB_MODS = { voice: ['voice'], stickers: ['stickers'], imagegen: ['imagegen'], video: ['video'], speakup: ['speakup', 'purpose'], pet: ['pet'], mood: ['mood', 'memory'], memory: ['memory', 'persona'], song: ['song'], autotelic: ['autotelic'] }

const modOn = (st, id) => (st.modules || []).some((m) => m.id === id && m.running)

// 两层导航：上面一排是分组，下面一排是这组里的页面；每组记住上次看的那页，Alt+K 查找功能
// （分组导航的思路来自社区贡献的「导航布局」扩展，这里改成面板自己实现）
const NAV_GROUPS = [
  { id: 'home', label: '概览', icon: 'M3 10.5 12 3l9 7.5M5.5 9v11.5h13V9M10 20.5v-6h4v6', tabs: ['overview', 'manage'] },
  { id: 'self', label: '人设', icon: 'M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5zM4.5 20.5c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5', tabs: ['character', 'group', 'speakup', 'autotelic', 'mood', 'memory'] },
  { id: 'express', label: '表达', icon: 'M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.4A8 8 0 1 1 20.5 11.5zM9 13.2s1.1 1.5 3 1.5 3-1.5 3-1.5M9.5 9.6h.01M14.5 9.6h.01', tabs: ['voice', 'stickers', 'imagegen', 'video', 'song', 'pet'] },
  { id: 'platform', label: '平台', icon: 'M3.5 6.5h17v11h-17zM10.5 9.8v4.4l3.8-2.2z', tabs: [] },
  { id: 'system', label: '系统', icon: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4', tabs: ['bots', 'connect', 'model', 'access', 'browser', 'security', 'backup', 'about', 'logs'] },
  { id: 'market', label: '模块', icon: 'M4 9.5 5.5 4h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20', tabs: ['market', 'modules', 'local'] },
]

// 自己写的模块：名字像逛平台的放「平台」，其余放「系统」（排在「日志」前面）
const PLATFORM_EXT = /逛|刷|B站|抖音|小红书|闲鱼|淘宝|微博|知乎|贴吧|快手|触站|小黑盒/

const navGroupById = (id) => NAV_GROUPS.find((group) => group.id === id)

const navGroupOf = (t) => NAV_GROUPS.find((g) => g.tabs.includes(t.id)) || navGroupById(t.navGroup) ||
  (t.ext && PLATFORM_EXT.test(t.label) ? NAV_GROUPS[3] : NAV_GROUPS[4])

const navOrder = (g, t) => { const i = g.tabs.indexOf(t.id); return i >= 0 ? i : g.tabs.length - (g.tabs.includes('logs') ? 1.5 : 0) }

const NAV_ALIAS = {
  overview: '首页 状态', manage: '管理功能 开关 启用 停用 可选功能', bots: '机器人 适配器 平台 在线 多平台', connect: 'qq 网关 onebot 登录 工作区', character: '人设 性格 设定 头像', access: '主人 白名单 权限 群管 改资料',
  group: '群聊 发言 白名单 仅模块 主动 窗口 插话 旁听 静默 合并 不回应 不理 屏蔽 黑名单 通用设置 继续回应 回复方式 权限与限制', model: 'ai 大模型 视觉 思考强度', voice: '语音 tts 说话 音色 edge 语音识别 听语音 转文字 asr 语音转文本', stickers: '表情 小黄脸 gif 商城表情',
  imagegen: '画图 图片', video: '视频 生视频 拍视频', speakup: '搭话 主动 目的引擎 目的 素材 立目标 小闹钟 追问', autotelic: '自驱 自主 后台 账本 审计 做梦 立项', mood: '心情', memory: '记忆 星图 联想 翻一翻 向量 重排 人物 画像 小档案 群印象 梗概 时间轴 相处经验 说话方式', song: '唱歌 翻唱 rvc 点歌',
  pet: '桌宠 宠物 悬浮窗 气泡 electron', local: '本地 接口 sd sovits', browser: '浏览器 侧边 侧边栏 ego 共享 独立窗口', security: '安全 防护 ssrf 内网 图片 下载', modules: '扩展 自己写 模板 安全模式', market: '模块 市场 插件 社区 下载 安装 桌宠 群管', logs: '日志 报错', about: '关于 关于我们 版本 许可 鸣谢 开源', backup: '备份 恢复 换电脑 迁移 导入 导出',
}

// connections 是平台连接快照数组（平台/实例/连接阶段）；推不出 QQ 网关状态时返回 null、保留旧值不动。
// 字段按契约语义取 platform/stage；契约未细化的字段形状不猜，推不出来就不改界面状态。
const connectionsToOnebot = (connections, fallback) => {
  if (!Array.isArray(connections)) return null
  const qq = connections.find((c) => c && (c.platform === 'qq' || c.platform === 'onebot' || c.id === 'onebot' || c.instanceId === 'onebot'))
  if (!qq || qq.stage == null) return null
  const state = { connected: 'connected', connecting: 'connecting', disconnected: 'disconnected', stopped: 'stopped', unconfigured: 'unconfigured' }[qq.stage]
  return state ? { ...fallback, state } : null
}

function NavBar({ tabs, cur, go, mark }) {
  const drawer = useRef(null)
  const search = useRef(null)
  const [query, setQuery] = useState('')
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const resize = () => { drawer.current?.close(); setOpened(false); setMobile(media.matches) }
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  const open = () => {
    if (mobile && !drawer.current?.open) { drawer.current?.showModal(); setOpened(true) }
    search.current?.focus()
  }
  useEffect(() => {
    const shortcut = (event) => {
      if (event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); open() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [mobile])
  const needle = query.trim().toLowerCase()
  const groups = NAV_GROUPS.map(group => ({
    ...group, pages: tabs.filter(page => navGroupOf(page).id === group.id &&
      [page.label, group.label, page.id, NAV_ALIAS[page.id]].join(' ').toLowerCase().includes(needle))
      .sort((first, second) => navOrder(group, first) - navOrder(group, second)),
  })).filter(group => group.pages.length)
  const select = page => { go(page.id); setQuery(''); drawer.current?.close() }
  const navigation = h('nav', { className: 'ab-directory', 'aria-label': '功能导航' },
    h('div', { className: 'ab-brand' }, h('span', null, h(WhaleIcon, { size: 25 })), 'AuraBot'),
    h('input', { type: 'search', className: 'ab-input', ref: search, placeholder: '查找功能', 'aria-label': '查找功能', value: query,
      onChange: event => setQuery(event.target.value), onKeyDown: event => {
        if (event.key === 'Enter' && groups.length) select(groups[0].pages[0])
      } }),
    groups.map(group => h('section', { key: group.id, 'data-group': group.id },
      h('h2', null, navIcon(group.icon), group.label),
      group.pages.map(page => h('button', { key: page.id, type: 'button', 'aria-current': page.id === cur.id ? 'page' : undefined,
        onClick: () => select(page) }, page.label, mark(page))))),
    groups.length ? null : h('p', { role: 'status' }, '没有匹配的页面'))
  if (!mobile) return h('aside', { className: 'ab-sidebar' }, navigation)
  return h('div', { className: 'ab-menu-bar' },
    h('button', { type: 'button', 'aria-label': '打开菜单', 'aria-haspopup': 'dialog', 'aria-expanded': opened, onClick: open }, navIcon('M4 6h16M4 12h11M4 18h16')),
    h('span', null, cur.label),
    h('dialog', { className: 'ab-drawer', ref: drawer, 'aria-label': '功能菜单',
      onClose: () => { setOpened(false); setQuery('') },
      onClick: event => { if (event.target === drawer.current && event.clientX >= drawer.current.getBoundingClientRect().right) drawer.current.close() } },
      h('button', { type: 'button', className: 'ab-drawer-close', 'aria-label': '关闭菜单', onClick: () => drawer.current.close() }, navIcon('m7 7 10 10M17 7 7 17')), navigation))
}

function ModOff({ name }) {
  return h(Card, { title: name }, h('div', { className: 'ab-muted ab-small' }, '「' + name + '」模块关着，这部分用不了。要用的话去「扩展」页把它打开。'))
}
/** 一个标签页出错时只坏这一页：显示原因和「回到概览」，不会整个面板白屏（也不会因为记住了这一页而一直白）。 */

class TabBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { try { localStorage.setItem('aurabot.tab', 'overview') } catch (e) {} }
  render() {
    if (!this.state.error) return this.props.children
    return h(Card, { title: '这一页出错了' },
      h('div', { className: 'ab-note err' }, String((this.state.error && this.state.error.message) || this.state.error)),
      h('div', { className: 'ab-small ab-muted', style: { margin: '8px 0' } }, '别的页面不受影响。把这段报错截图发给作者就行。'),
      h('div', { className: 'ab-flex' },
        h(Btn, { small: true, kind: 'primary', onClick: () => this.props.onHome && this.props.onHome() }, '回到概览'),
        h(Btn, { small: true, kind: 'ghost', onClick: () => this.setState({ error: null }) }, '再试一次')))
  }
}

class PanelBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? h('div', { className: 'ab-note err' }, '这个模块的面板出错了：' + String((this.state.error && this.state.error.message) || this.state.error)) : this.props.children }
}

export { TABS, TAB_MODS, modOn, NAV_GROUPS, PLATFORM_EXT, navGroupById, navGroupOf, navOrder, NAV_ALIAS, connectionsToOnebot, NavBar, ModOff, TabBoundary, PanelBoundary }
