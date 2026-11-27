import { ownerId } from '../../../src/core/config/owners.ts'
// QQ 里的主人命令：/silent /active 之类，直接在 QQ 上管她。只认主人；在总开关关着时也能用（所以 /on 才有用）。

import { runEffortCommand } from './effort-command.ts'
import { policyFor } from '../../../src/chat/policy/rules/group.ts'
import { dataDir, readJson, writeJson } from '../../../src/core/store/index.ts'
import { runGroupSettingsCommand } from './group-settings-command.ts'
import { runPermissionsCommand } from './permissions-command.ts'

/**
 * 解析命令：「/silent 30」→ { name: 'silent', arg: '30' }。不是命令返回 null。支持全角斜杠和中文别名。
 * extra：扩展模块加的命令 [{ name, aliases, desc, run }]，命中时返回 { name, arg, ext }；和内置同名时扩展的优先。
 */
export function parseCommand(text, extra = []) {
  const m = String(text || '').trim().match(/^[/／]\s*([A-Za-z0-9一-龥_-]+)\s*([\s\S]*)$/)
  if (!m) return null
  const word = m[1].toLowerCase()
  // 权限管理是保留命令，扩展模块不能抢占。
  if (word === '权限' || word === 'permissions' || word === 'perms') return { name: 'permissions', arg: m[2].trim() }
  if (word === 'groupsettings' || word.startsWith('群设置')) return { name: 'groupsettings', arg: (word === 'groupsettings' ? m[2] : m[1].slice(3) + ' ' + m[2]).trim() }
  for (const c of extra) {
    const names = [c.name, ...(c.aliases || [])].map((x) => String(x).toLowerCase())
    if (names.includes(word)) return { name: c.name, arg: m[2].trim(), ext: c }
    // 中文命令后面直接跟内容：「/天气北京」
    const pre = names.filter((k) => /[一-龥]/.test(k) && word.startsWith(k)).sort((a, b) => b.length - a.length)[0]
    if (pre) return { name: c.name, arg: (m[1].slice(pre.length) + ' ' + m[2]).trim(), ext: c }
  }
  const name = ALIASES[word] || word
  if (COMMANDS[name]) return { name, arg: m[2].trim() }
  // 中文命令后面不加空格直接跟内容：「/记住我不吃香菜」
  const pre = Object.keys(ALIASES).filter((k) => /[一-龥]/.test(k) && word.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return pre ? { name: ALIASES[pre], arg: (m[1].slice(pre.length) + ' ' + m[2]).trim() } : null
}

const ALIASES = {
  群设置: 'groupsettings',
  闭嘴: 'silent', 安静: 'silent', 静音: 'silent', shutup: 'silent', mute: 'silent',
  说话: 'active', 醒醒: 'active', 解除静音: 'active', unmute: 'active',
  少说: 'quiet', 话少: 'quiet',
  多说: 'chatty', 话多: 'chatty',
  正常: 'normal',
  思考: 'effort', 思考强度: 'effort',
  状态: 'status', 心情: 'mood', 记住: 'remember', 记一下: 'remember',
  搭话: 'speak', 主动搭话: 'speak',
  重开: 'reset', 开机: 'on', 关机: 'off', 帮助: 'help', 命令: 'help', h: 'help',
}

const COMMANDS = {
  help: '看这份命令列表',
  permissions: '主人私聊管理权限：/权限 查看用法',
  groupsettings: '主人私聊管理群发言和记忆：/群设置 查看用法',
  quiet: '这个群里只在被叫到时说话，不插话',
  chatty: '这个群里话多一点，更爱插话',
  normal: '这个群恢复默认的插话频率',
  effort: '查看当前聊天的模型思考档位；发 /effort 序号 或 档位名切换，/effort 默认恢复跟随',
  status: '看她现在的状态',
  mood: '看她现在的心情',
  remember: '让她记住一件事，如 /remember 我不吃香菜',
  speak: '管主动搭话白名单：/speak 看名单，/speak add QQ 号 加人，/speak del QQ 号 移除',
  reset: '这个聊天重新开始（旧的对话在 DSH 侧栏里还能找回）',
  on: '打开总开关',
  off: '关掉总开关（之后除了命令什么都不回）',
}

export const commandList = (extra = []) => [
  ...Object.entries(COMMANDS).map(([name, desc]) => ({ name, desc, aliases: Object.keys(ALIASES).filter((k) => ALIASES[k] === name && /[一-龥]/.test(k)) })),
  ...extra.map((c) => ({ name: c.name, desc: c.desc || '', aliases: c.aliases || [], module: c.module || '' })),
]

export function helpText(extra = []) {
  return '主人命令（也可以用中文，如 /闭嘴 /说话）：\n' + Object.entries(COMMANDS).map(([k, v]) => `/${k}  ${v}`).join('\n')
    + (extra.length ? '\n扩展模块加的：\n' + extra.map((c) => `/${c.name}  ${c.desc || ''}`).join('\n') : '')
}

/** 每个聊天的闭嘴状态：chatId → 到什么时候（毫秒，Infinity 写成 0 表示一直）。 */
export function createMutes() {
  const file = () => dataDir('mutes.json')
  const load = () => readJson(file(), {})
  return {
    muted(chatId, now = Date.now()) {
      const m = load()
      if (!(chatId in m)) return false
      if (m[chatId] === 0 || m[chatId] > now) return true
      delete m[chatId]
      writeJson(file(), m)
      return false
    },
    set(chatId, minutes) {
      const m = load()
      m[chatId] = minutes > 0 ? Date.now() + minutes * 60_000 : 0
      writeJson(file(), m)
    },
    clear(chatId) {
      const m = load()
      delete m[chatId]
      writeJson(file(), m)
    },
    until: (chatId) => load()[chatId],
  }
}

/**
 * 执行命令，返回要回给主人的话。
 * @param {object} deps { getConfig, setConfig, mutes, hub, mood, memory, bot }
 */
export async function runCommand(cmd, msg, deps) {
  const { getConfig, setConfig, mutes, hub, mood, memory } = deps
  const cfg = getConfig()
  const inGroup = msg.kind === 'group'
  const here = inGroup ? '这个群' : '这里'
  const setGroup = (patch) => {
    const overrides = { ...(cfg.group.overrides || {}) }
    if (patch === null) delete overrides[msg.groupId]
    else overrides[msg.groupId] = { ...(overrides[msg.groupId] || {}), ...patch }
    setConfig({ ...cfg, group: { ...cfg.group, overrides } })
  }
  switch (cmd.name) {
    case 'groupsettings':
      return runGroupSettingsCommand(cmd.arg, msg, deps)
    case 'permissions':
      return runPermissionsCommand(cmd.arg, msg, deps)
    case 'help':
      return helpText(deps.extraCommands || [])
    case 'quiet':
      if (!inGroup) return '这个命令要在群里用'
      setGroup({ interjectChance: 0, proactiveEnabled: false, engagedEnabled: false })
      return '好，这个群里没人叫我我就不插话'
    case 'speak': {
      const c = getConfig()
      const [verb = '', target = ''] = String(cmd.arg || '').split(/\s+/)
      const list = c.speakUp.allow || []
      if (!verb) return list.length ? `主动搭话白名单：${list.join('、')}` : '主动搭话白名单是空的，用 /speak add QQ 号 加人'
      const qq = target.replace(/\D/g, '')
      if (!/^\d{5,}$/.test(qq) || !/^(add|加|添加|del|rm|删|删除|移除)$/.test(verb)) return '用法：/speak add QQ 号，或 /speak del QQ 号'
      if (/^(add|加|添加)$/.test(verb)) {
        if (list.includes(qq)) return `${qq} 已经在白名单里了`
        // 要能聊得上：顺手加进私聊白名单
        setConfig({ ...c, speakUp: { ...c.speakUp, allow: [...list, qq] }, allow: { ...c.allow, private: [...new Set([...c.allow.private, qq])] } })
        return `好，以后也会主动找 ${qq}（对方要是她的好友才发得出去）`
      }
      if (!list.includes(qq)) return `${qq} 不在白名单里`
      setConfig({ ...c, speakUp: { ...c.speakUp, allow: list.filter((x) => x !== qq) } })
      return `好，不再主动找 ${qq} 了`
    }
    case 'chatty':
      if (!inGroup) return '这个命令要在群里用'
      setGroup({ interjectChance: 0.4, minRelevance: 0.1, proactiveEnabled: true, engagedEnabled: true })
      return '好耶，那我在这个群多说两句'
    case 'normal':
      if (!inGroup) return '这个命令要在群里用'
      setGroup(null)
      return '好，按平常的样子来'
    case 'status': {
      const st = hub.stats()
      const mu = mutes.until(msg.chatId)
      const lines = [
        `总开关：${cfg.enabled ? '开' : '关'}`,
        ...(mood ? [`心情：${mood.label()}`] : []),
        `今天：收到 ${st.received} 条，发出 ${st.sent} 条`,
        `${here}：${mu === undefined ? '正常说话' : mu === 0 ? '闭嘴中' : '闭嘴到 ' + new Date(mu).toLocaleTimeString().slice(0, 5)}`,
      ]
      if (inGroup) {
        const p = policyFor(cfg.group, cfg.group.overrides, msg.groupId)
        const proactive = p.proactiveEnabled !== false && p.interjectChance > 0
        const engaged = typeof p.engagedEnabled === 'boolean' ? p.engagedEnabled : p.interjectChance > 0
        lines.push(`主动加入话题：${proactive ? '开' : '关'}；窗口内接话：${engaged ? '开' : '关'}`)
      }
      return lines.join('\n')
    }
    case 'effort':
      return runEffortCommand(cmd.arg, msg, deps)
    case 'mood':
      return mood ? `现在${mood.label()}` : '心情模块关着'
    case 'remember': {
      if (!memory) return '记忆模块关着'
      if (!cmd.arg) return '要我记住什么呀？比如 /remember 我不吃香菜'
      const r = memory.add({ text: cmd.arg, aboutName: cfg.ownerName || '主人', about: ownerId(cfg), importance: 0.8, source: 'panel', chatId: msg.chatId })
      if (r.ok) return '记住了'
      deps.log?.warn?.('记忆命令失败：', r.message)
      return '这次记忆保存未确认，请先在记忆面板查看；详细原因请主人查看本机日志。'
    }
    case 'reset':
      hub.resetChat(msg.chatId)
      return '好，我们重新开始'
    case 'on':
      setConfig({ ...cfg, enabled: true })
      return '我上线啦'
    case 'off':
      setConfig({ ...cfg, enabled: false })
      return '好，我先下线了。发 /on 叫我回来'
    default:
      return null
  }
}
