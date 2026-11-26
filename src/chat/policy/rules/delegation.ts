const COMMAND_GRANTS = {
  help: '查看自己可用的命令',
  status: '查看机器人运行状态',
  mood: '查看机器人心情',
  reset: '归档自己的私聊会话，下一条消息开新会话',
  silent: '暂停自己的私聊回复',
  active: '恢复自己的私聊回复',
  model: '查看模型列表并切换自己的私聊模型，可能增加用量',
  sing: '在自己的私聊使用翻唱服务',
}

export const DELEGATED_COMMANDS = Object.keys(COMMAND_GRANTS)

export function delegatedCommandCatalog(extra = []) {
  return [
    ...DELEGATED_COMMANDS.map((key) => ({ key, label: `/${key}`, description: COMMAND_GRANTS[key], group: '命令' })),
    ...extra.flatMap((cmd) => {
      const key = delegatedCommandKey({ name: cmd.name, ext: cmd })
      return key ? [{ key, label: `/${cmd.name} · ${cmd.module}`, description: cmd.desc || '执行模块命令', group: '扩展命令' }] : []
    }),
  ]
}

export function delegatedCommandKey(cmd) {
  if (!cmd) return ''
  if (!cmd.ext) return DELEGATED_COMMANDS.includes(cmd.name) ? cmd.name : ''
  if (cmd.ext.delegatable !== true || cmd.ext.sensitive === true) return ''
  const moduleId = String(cmd.ext.module || '')
  const name = String(cmd.name || '')
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(moduleId) || !/^[A-Za-z0-9一-龥_-]+$/.test(name)) return ''
  return `ext:${moduleId}:${name}`
}

export function isDelegatedCommandKey(key) {
  return DELEGATED_COMMANDS.includes(key) || /^ext:[a-z][a-z0-9-]{1,39}:[A-Za-z0-9一-龥_-]+$/.test(key)
}

export function canUseDelegatedCommand(cfg, msg, key) {
  if (msg?.kind !== 'private' || !isDelegatedCommandKey(key)) return false
  const userId = String(msg.userId || '')
  return Boolean(userId && (cfg.allow?.private || []).map(String).includes(userId)
    && (cfg.commandAllow?.[key] || []).map(String).includes(userId))
}
