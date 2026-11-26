import {
  readLook,
  lookImage,
  lookMime,
  saveLookImage,
  deleteLookImage,
  configureLookImage,
  lookImages,
  describeLook,
  saveAppearance,
} from '../../../../src/persona/persona-look.ts'
import {
  readPersona,
  listPersonas,
  dataOwner,
  claimPending,
  savePersona,
  safeId,
  deletePersona,
  personaDataDir,
} from '../../../../src/persona/personas.ts'
import { dataDir } from '../../../../src/core/store/index.ts'
import { closeMessageLogsUnder } from '../../../../src/core/store/messages.ts'
import { rmSync } from 'node:fs'

export function registerPersonaRoutes({ http, ctx, generate, getConfig, bridge, use, hub, setConfig, log }) {
  const { send, route, query, readRaw, readBody } = http

  // 人格：新增写操作显式限制 POST，避免 GET 绕过 CSRF 方法检查。
  const personaPost = (req, res) => {
    if (req.method === 'POST') return true
    send(res, 405, { ok: false, message: '请使用 POST' })
    return false
  }
  const savedLookId = (id) => {
    readLook(id) // 严格检查 id，不接受清洗后指向另一人格
    if (!readPersona(id)) throw new Error('请先保存人格')
    return id
  }
  route('/persona/look', async (req) => ({ ok: true, look: readLook(savedLookId(query(req).id)) }))
  route('/persona/look/image', async (req, res) => {
    const q = query(req)
    const buf = lookImage(savedLookId(q.id), q.imageId)
    if (!buf) {
      send(res, 404, { ok: false, message: '还没有人设图' })
      return
    }
    res.setHeader?.('x-content-type-options', 'nosniff')
    send(res, 200, buf, lookMime(buf))
  })
  route('/persona/look/upload', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = JSON.parse((await readRaw(req, 8 * 1024 * 1024)).toString('utf8'))
    const id = savedLookId(b?.id)
    const match =
      typeof b.data === 'string' &&
      b.data.match(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    if (!match || match[1].length % 4 !== 0) throw new Error('请选择有效的图片 data URL')
    return {
      ok: true,
      look: saveLookImage(id, Buffer.from(match[1], 'base64'), {
        imageId: b.imageId,
        append: b.append === true,
      }),
    }
  })
  route('/persona/look/delete', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    return { ok: true, look: deleteLookImage(savedLookId(b.id), b.imageId) }
  })
  route('/persona/look/configure', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = JSON.parse((await readRaw(req, 16 * 1024)).toString('utf8'))
    return {
      ok: true,
      look: configureLookImage(savedLookId(b.id), b.imageId, { reference: b.reference, note: b.note }),
    }
  })
  route('/persona/look/describe', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    const id = savedLookId(b.id)
    const buffers = lookImages(id)
    if (!buffers.length) throw new Error('请先上传人设图')
    const imageHash = readLook(id).imageHash
    const text = await describeLook({ dsh: ctx, generate, cfg: getConfig(), buffers })
    // 在途解析不覆盖换图后的状态；描述仍由面板确认保存。
    if (!readPersona(id) || readLook(id).imageHash !== imageHash) throw new Error('人设图已变化，请重新解析')
    return { ok: true, text, imageHash }
  })
  route('/personas', async () => ({
    ok: true,
    list: listPersonas(),
    current: getConfig().persona.current,
    dataOwner: dataOwner(getConfig()),
    claimPending: claimPending(getConfig()),
  }))
  route('/persona/get', async (req) => {
    const p = readPersona(query(req).id)
    return p ? { ok: true, persona: p, look: readLook(p.id) } : { ok: false, message: '没有这个人格' }
  })
  route('/persona/save', async (req, res) => {
    if (!personaPost(req, res)) return
    const b = await readBody(req)
    readLook(b.id)
    if (b.appearance !== undefined && typeof b.appearance !== 'string') throw new Error('外貌描述须为文字')
    const p = savePersona(b.id, b)
    if (b.appearance !== undefined) saveAppearance(p.id, b.appearance, b.appearanceSource)
    bridge.refresh()
    return { ok: true, persona: p, look: readLook(p.id), message: '人格已保存，下一轮起生效' }
  })
  route('/persona/delete', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (id === safeId(getConfig().persona.current)) return { ok: false, message: '正在用的人格不能删' }
    deletePersona(id)
    // 连数据一起删：只删 persona-data/<id>/。根目录归数据归属人格（还没认领时大家共用），不能删。
    const dir = personaDataDir(getConfig(), id)
    if (b.withData && id && dir !== dataDir()) {
      use('memory')?.closePersona?.(id)
      closeMessageLogsUnder(dir)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch (error) {
        return {
          ok: false,
          list: listPersonas(),
          message: '人格删掉了，但它的数据没删干净：' + error.message,
        }
      }
    }
    return { ok: true, list: listPersonas() }
  })
  route('/persona/use', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (!readPersona(id)) return { ok: false, message: '没有这个人格' }
    // 正在回复或在忙后台的事：切过去会把旧人格的回复当成新人格的发出去
    if (id !== safeId(getConfig().persona.current) && hub.busy())
      return { ok: false, message: '她正在回复或在忙后台的事，等这一轮结束再切' }
    setConfig({ ...getConfig(), persona: { ...getConfig().persona, current: id } })
    log.info(`切换人格 → ${id}`)
    return { ok: true, current: id, message: '切换好了，下一轮回复起生效' }
  })
  // 老用户升级后认领根目录的数据：只能认领一次，之后其他人格用 persona-data/<id>/ 里自己的记忆和会话
  route('/persona/data-owner', async (req) => {
    const b = await readBody(req)
    const id = safeId(b.id)
    if (dataOwner(getConfig())) return { ok: false, message: '根目录的数据已经认领过了' }
    if (!readPersona(id)) return { ok: false, message: '没有这个人格' }
    if (hub.busy()) return { ok: false, message: '她正在回复或在忙后台的事，等这一轮结束再认领' }
    setConfig({ ...getConfig(), persona: { ...getConfig().persona, dataOwner: id } })
    log.info(`根目录的记忆和会话归给人格 ${id}`)
    return { ok: true, dataOwner: id, message: '认领好了，其他人格从下一轮起用自己的记忆和会话' }
  })
  // 人格页「AI 润色」：只改面板上这一节的文字，不保存；用不用由主人在面板里选
  route('/persona/polish', async (req) => {
    const b = await readBody(req)
    const title = String(b.title || '').slice(0, 30) || '开场（她是谁）'
    const text = String(b.text || '').slice(0, 4000)
    const others = (Array.isArray(b.others) ? b.others : []).map((x) => String(x).slice(0, 30)).slice(0, 20)
    const system =
      '你在帮人改一个 QQ 聊天角色的人设。人设按【标题】分节，你一次只改其中一节。' +
      '只输出这一节改好后的正文：不要写标题，不要加粗、不要 Markdown 标题，不要任何解释。原来是「- 」开头的条目就继续用条目，一条一行、短句。'
    const ask = [
      `角色：${String(b.name || '她').slice(0, 30)}`,
      `要改的这一节：${title}`,
      `人设里另外几节：${others.join('、') || '无'}（只是让你知道还有哪些，别把它们的内容写进这一节）`,
      text.trim()
        ? '要求：保留原来的设定和事实，不编新的身份信息；说得更具体、更像真人；删掉重复和空话；长度别超过原来的 1.5 倍。'
        : '要求：这一节还是空的，按这个角色和这一节的标题写 4 到 8 条。',
      text.trim() ? `原文：\n${text}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    try {
      const out = String(
        (await generate({
          cfg: getConfig(),
          module: 'persona',
          system,
          text: ask,
          maxTokens: 1500,
          temperature: 0.6,
        })) || '',
      )
        .replace(/^```[a-z]*\n?|\n?```$/g, '')
        .replace(new RegExp('^【' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '】\\s*'), '')
        .trim()
      return out ? { ok: true, text: out } : { ok: false, message: '模型没给出内容，再试一次' }
    } catch (error) {
      return { ok: false, message: '润色没成功：' + error.message }
    }
  })
}
