// QQ 系统表情（小黄脸）：名字 ↔ 编号。她在回复里写 <face:捂脸>，发的时候换成 QQ 自带的表情，和文字在同一条消息里。
// 目录从协议端现取（扩展动作 fetch_sys_faces，缓存一天）；取不到时用下面这份常用的兜底。

import { FACE_TABLE } from './table.ts'
export { textToSegments, textToElements, stripFaceTags, speakableText, splitSpeakable } from '../../../../../../src/chat/reply/format/speech.ts'

/** 迁移期选项对象：属性名固定，值按调用方传。 */
type CreateFacesOptions = Partial<Record<'bot' | 'log', any>>

/**
 * 系统表情（名字 → 编号），取不到网关目录时用。
 * 以前这里只兜底 65 个常用表情，别人贴了个表里没有的，回应就只剩一个数字编号；
 * 现在直接用 QQ 的整张表（329 条），同名的取第一个，优先客户端还显示的那些。
 */
export const COMMON_FACES = (() => {
  const out: Record<string, any> = {}
  for (const f of FACE_TABLE) if (!f.hide && out[f.name] === undefined) out[f.name] = Number(f.id)
  for (const f of FACE_TABLE) if (out[f.name] === undefined) out[f.name] = Number(f.id)
  return out
})()

/** 给她看的几个例子（提示词里用，别太长）。 */
export const FACE_EXAMPLES = ['微笑', '呲牙', '偷笑', '捂脸', '斜眼笑', '笑哭', '吃瓜', '白眼', '委屈', '裂开', '摸鱼', '抱拳', '赞', 'OK']


/**
 * 网关目录（{ packs: [{ pack_name, emojis: [{ q_sid, q_des, emoji_name_alias, is_super }] }] }）→ 名字 / 编号对照。
 * 只要数字编号的（emoji 分组的编号是字符，不是系统表情）；同名的优先普通表情，没有再用超级表情。
 */
export function buildFaceIndex(catalog) {
  const byName = new Map()
  const byId = new Map()
  const entries = []
  for (const p of catalog?.packs || []) for (const e of p.emojis || []) entries.push(e)
  entries.sort((a, c) => Number(Boolean(a.is_super)) - Number(Boolean(c.is_super)))
  for (const e of entries) {
    const id = String(e.q_sid ?? '')
    if (!/^\d+$/.test(id)) continue
    const name = String(e.q_des || '').replace(/^\//, '').trim()
    if (!name) continue
    if (!byId.has(id)) byId.set(id, name)
    for (const n of [name, ...(e.emoji_name_alias || [])].map((x) => String(x).replace(/^\//, '').trim()).filter(Boolean)) {
      if (!byName.has(n)) byName.set(n, Number(id))
    }
  }
  return { byName, byId }
}

const COMMON_INDEX = (() => {
  const byName = new Map(Object.entries(COMMON_FACES))
  // 编号 → 名字用整张表（含客户端已不显示的老表情），被贴了冷门表情也能翻出名字
  const byId = new Map(FACE_TABLE.map((f) => [String(f.id), f.name]))
  for (const [n, id] of Object.entries(COMMON_FACES)) if (!byId.has(String(id))) byId.set(String(id), n)
  return { byName, byId }
})()

/** 系统表情对照：先用常用的，第一次用到时再去网关拉完整目录（一天刷新一次）。 */
export function createFaces({ bot, log } : CreateFacesOptions = {}) {
  let index = COMMON_INDEX
  let at = 0
  let loading = null
  function refresh() {
    if (loading || (at && Date.now() - at < 24 * 3600_000)) return loading
    loading = Promise.resolve().then(() => { const account = bot?.(); return account?.platform === 'qq' ? account.internal('fetch_sys_faces', {}, { timeoutMs: 15000 }) : null })
      .then((r) => {
        const built = buildFaceIndex(r?.packs ? r : r?.data)
        if (built.byName.size) index = { byName: new Map([...COMMON_INDEX.byName, ...built.byName]), byId: new Map([...COMMON_INDEX.byId, ...built.byId]) }
      })
      .catch((error) => log?.debug?.('取 QQ 系统表情目录失败，用内置的常用表情：', error.message))
      .finally(() => { at = Date.now(); loading = null })
    return loading
  }
  return {
    refresh,
    idOf: (name) => { refresh(); return index.byName.get(String(name || '').replace(/^\//, '').trim()) },
    nameOf: (id) => { refresh(); return index.byId.get(String(id)) },
  }
}
