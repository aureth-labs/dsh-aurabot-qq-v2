import { API_VERSION, PKG } from '../../../../src/core/module/index.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeFromPanel } from '../../../../src/core/config/index.ts'
import { REGISTRY_URL, PAGES_URL } from '../../../../src/core/module/market/community.ts'
import { parseCommand } from '../../../modules/commands/dispatch.ts'
import {
  canUseDelegatedCommand,
  delegatedCommandKey,
} from '../../../../src/chat/policy/rules/delegation.ts'

export function registerModuleRoutes({
  http,
  mods,
  getConfig,
  community,
  setConfig,
  log,
  openFolder,
  hub,
  use,
}) {
  const { route, query, readBody, send } = http

  // 模块（面板「扩展」页）
  route('/modules', async () => ({
    ok: true,
    dir: mods.dir(),
    safeMode: getConfig().safeMode,
    apiVersion: API_VERSION,
    list: mods.status(),
    prompt: mods.promptFor(''),
  }))
  route('/modules/community', async (req) => {
    try {
      return { ok: true, ...(await community.list({ force: query(req).force === '1' })) }
    } catch (error) {
      return { ok: false, message: error.message, list: [] }
    }
  })
  route('/modules/tutorial', async () => {
    try {
      return { ok: true, text: readFileSync(join(PKG, 'sdk', 'API.md'), 'utf8') }
    } catch (error) {
      return { ok: false, message: '教程文件不见了' }
    }
  })
  route('/modules/community/progress', async () => ({ ok: true, progress: community.progress() }))
  route('/modules/community/install', async (req) => {
    const b = await readBody(req)
    return {
      ...((await community.install(String(b.id || ''), {
        confirmReplace: b.confirmReplace === true,
      })) as Record<string, any>),
      modules: mods.status(),
    }
  })
  route('/modules/community/remove', async (req) => {
    const b = await readBody(req)
    return {
      ...((await community.remove(String(b.id || ''), { purge: b.purge === true })) as Record<string, any>),
      modules: mods.status(),
    }
  })
  route('/modules/remove', async (req) => {
    const b = await readBody(req)
    return { ...(await mods.remove(String(b.id || ''), { purge: b.purge === true })), list: mods.status() }
  })
  // 模块市场地址：换索引源（自建索引 / 国内镜像 / 内网部署）用。留空 = 回到内置 GitHub 地址；
  // 只收 http/https，别把 file:// 之类塞进来当下载源。单一真相在 ext.market.registryUrl，
  // community.js 读取时按 config > AURABOT_REGISTRY_URL > 内置默认 的优先级解析。
  route('/panel/market/registry', async (req) => {
    if (String(req?.method || 'GET').toUpperCase() === 'POST') {
      const b = await readBody(req)
      const u = String(b.registryUrl ?? '')
        .trim()
        .slice(0, 1000)
        .replace(/\/+$/, '')
      if (u && !/^https?:\/\//i.test(u))
        return {
          ok: false,
          message: '要填 http(s):// 开头的完整地址，如 https://example.com/registry/index.json',
        }
      setConfig(mergeFromPanel(getConfig(), { ext: { market: { registryUrl: u } } }))
      log.info(`面板已保存模块市场地址｜${u || '（留空，回到内置 GitHub 索引）'}`)
      return {
        ok: true,
        registryUrl: community.registryUrl(),
        message: u ? '已换成自定义模块市场地址' : '已恢复内置 GitHub 索引地址',
      }
    }
    return {
      ok: true,
      registryUrl: community.registryUrl(),
      default: REGISTRY_URL,
      sources: [
        { id: 'github', label: 'GitHub 官方源', url: REGISTRY_URL, note: '默认；海外直连，国内偶尔慢' },
        { id: 'pages', label: 'GitHub Pages', url: PAGES_URL, note: '市场构建发布的同版索引' },
        { id: 'custom', label: '自定义', url: '', note: '自建索引 / ghproxy 中转 / 内网部署' },
      ],
    }
  })
  route('/modules/reload', async (req) => {
    const id = String((await readBody(req)).id || '')
    if (!id) {
      await mods.sync()
      return { ok: true, message: '检查过了', list: mods.status() }
    }
    const m = await mods.reload(id)
    return {
      ok: Boolean(m && !m.error),
      message: m?.error ? '加载失败：' + m.error : '重新加载好了',
      list: mods.status(),
    }
  })
  route('/modules/create', async (req) => {
    const b = await readBody(req)
    const r = mods.create(String(b.id || '').trim(), String(b.name || '').trim())
    if (r.ok) await mods.sync()
    return { ...r, list: mods.status(), prompt: r.ok ? mods.promptFor(String(b.id).trim()) : '' }
  })
  route('/modules/prompt', async (req) => ({ ok: true, prompt: mods.promptFor(String(query(req).id || '')) }))
  route('/modules/open', async (req) => {
    const id = String(query(req).id || '')
    return openFolder(id ? join(mods.dir(), id) : mods.dir())
  })
  // 模拟测试：不用上 QQ 就能试模块。发出去的消息只截下来给面板看，不真发
  // （模块直接调 api.onebot(...) 的操作不在此列，是真的会执行的）
  const simChat = (b) => {
    const owner = b.as !== 'other'
    const userId = owner ? getConfig().ownerQQ : '10001'
    const group = b.kind === 'group'
    const groupId = String(b.groupId || getConfig().allow.groups[0] || '10002')
    return {
      owner,
      userId,
      chat: group
        ? { chatId: `group:${groupId}`, kind: 'group', groupId, userId }
        : { chatId: `private:${userId}`, kind: 'private', userId },
    }
  }
  // 没有文字的（语音条、表情、图片）显示发送备注，比如「[语音·edge] 早呀」
  const sentLines = (sent) =>
    sent.map((s) => ({
      chatId: s.chatId,
      note: s.note,
      text: s.message.some((seg) => seg.type === 'text')
        ? s.message
            .map((seg) => (seg.type === 'text' ? seg.data.text : seg.type === 'reply' ? '' : `[${seg.type}]`))
            .join('')
        : s.note,
    }))
  route('/modules/simulate', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const text = String(b.text || '')
    const steps = []
    const msg = {
      ...chat,
      nickname: owner ? getConfig().ownerName || '主人' : '路人',
      role: '',
      messageId: 'sim',
      text,
      mentioned: Boolean(b.mentioned),
      replyId: '',
      images: [],
      stickers: [],
      records: [],
      forwards: [],
      raw: { simulated: true },
    }
    const { sent } = await hub.capture(
      async () => {
        if (text) {
          const parsed =
            (owner || chat.kind === 'private') && /^\s*[/／]/.test(text)
              ? parseCommand(text, mods.commands())
              : null
          // 内置命令表默认关（commands 模块）；插件自己注册的命令不受影响
          const cmd = parsed && (parsed.ext || use('commands')) ? parsed : null
          if (cmd && !owner && !canUseDelegatedCommand(getConfig(), msg, delegatedCommandKey(cmd))) {
            steps.push('这个私聊对象没有使用该命令的权限')
          } else if (cmd && cmd.ext) {
            const reply = String((await cmd.ext.run(cmd.arg, msg)) ?? '')
            steps.push(`命令 /${cmd.name}（模块「${cmd.ext.module}」）回：${reply || '（空）'}`)
            if (reply) await hub.sendText(chat.chatId, reply)
          } else if (cmd) {
            steps.push(`这是内置命令 /${cmd.name}，模拟里不执行（会真的改设置）`)
          } else if (await mods.claim('message', msg)) {
            steps.push('有模块接管了这条消息，她不会再回')
          } else {
            steps.push('没有模块接管，这条会交给她（模拟里不会真的让她想）')
          }
        }
        if (b.reply) {
          const items = await hub.deliver(chat.chatId, String(b.reply), { simulate: true })
          steps.push(items ? `她的回复经过模块改写后拆成 ${items.length} 条` : '她的回复被模块拦下了，不发')
        }
      },
      { simulate: true },
    )
    return { ok: true, steps, sent: sentLines(sent) }
  })
  route('/modules/tools', async (req) => {
    const q = query(req)
    const { owner, chat } = simChat(q)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    return {
      ok: true,
      level,
      list: mods
        .buildTools({ chat, level, sessionId: 'sim' })
        .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    }
  })
  route('/modules/tool', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    const tool = mods.buildTools({ chat, level, sessionId: 'sim' }).find((t) => t.name === b.name)
    if (!tool) return { ok: false, message: `这个场合没有 ${b.name} 这个工具` }
    hub.simulateTurn('sim', [userId])
    const { result, sent } = await hub.capture(
      () => tool.execute(b.args && typeof b.args === 'object' ? b.args : {}, {}),
      { simulate: true },
    )
    return { ok: true, result, sent: sentLines(sent) }
  })
  route('/modules/panel', async (req, res) => {
    const src = mods.panelSource(String(query(req).id || ''))
    if (src === null) return send(res, 404, '')
    send(res, 200, src, 'text/javascript; charset=utf-8')
  })
}
