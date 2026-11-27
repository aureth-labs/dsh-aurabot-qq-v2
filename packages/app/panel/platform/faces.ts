import { FACE_TABLE } from '../../../adapters/qq/onebot-v11/src/face/table.ts'
import { buildFaceIndex } from '../../../adapters/qq/onebot-v11/src/face/index.ts'

export function registerFaceRoutes({ http, bot, logger }) {
  const { route } = http

  // 贴表情：面板要展示「当前有哪些表情可以贴」——内置常用 + 网关系统表情目录（取不到就只用内置）
  // emoji 走 Unicode 码点，QQ 老表情走它自己那套编号，两套在 set_msg_emoji_like 里都能直接用。
  const REACT_EMOJIS = [
    { char: '👍', name: '赞', id: '128077' },
    { char: '❤️', name: '爱心', id: '10084' },
    { char: '😂', name: '笑哭', id: '128514' },
    { char: '😭', name: '大哭', id: '128557' },
    { char: '🤔', name: '思考', id: '129300' },
    { char: '😅', name: '冷汗', id: '128517' },
    { char: '😳', name: '脸红', id: '128563' },
    { char: '🥺', name: '委屈', id: '129402' },
    { char: '🎉', name: '庆祝', id: '127881' },
    { char: '🌹', name: '玫瑰', id: '127801' },
    { char: '🍬', name: '糖', id: '127852' },
    { char: '✨', name: '闪', id: '10024' },
    { char: '🔥', name: '火', id: '128293' },
    { char: '🙏', name: '拜托', id: '128591' },
  ]
  route('/panel/faces', async () => {
    // 先用内置整表（329 条）打底：网关取不到目录时，面板也不会只剩 65 个常用表情
    let byId = new Map(FACE_TABLE.map((f) => [String(f.id), f.name]))
    try {
      const r = await bot().internal('fetch_sys_faces', {}, { timeoutMs: 8000 })
      const built = buildFaceIndex(r?.packs ? r : r?.data)
      if (built.byId.size) byId = new Map([...byId, ...built.byId])
    } catch (error) {
      logger.child('faces').debug('取系统表情目录失败，只用内置的：', error.message)
    }
    const faces = [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => Number(a.id) - Number(b.id))
    return { ok: true, faces, emojis: REACT_EMOJIS }
  })
}
