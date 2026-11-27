import type { StickerSource } from '../../../../../src/core/message/media/sticker.ts'
import { elementBytes } from '../../../../../src/core/net/index.ts'
import type { createOneBotConnection } from './connection.ts'

export function stickerSource(connection: ReturnType<typeof createOneBotConnection>) {
  return {
    capture(): StickerSource | undefined {
      if (!connection.verified) return
      const bot = connection.bot
      const identity = connection.login
      const selfId = bot.selfId
      const active = () => connection.verified && connection.login === identity && bot.status === 'online' && bot.selfId === selfId
      async function call(action: string, params: Record<string, unknown>) {
        if (!active()) throw Error('表情来源账号已下线')
        const result = await connection.client.call(action, params, { retries: 0, timeoutMs: 30000 })
        if (!active()) throw Error('表情来源账号已改变')
        return result as Record<string, any>
      }
      return {
        selfId, active,
        read: (el, maxBytes) => elementBytes({ attrs: {
          url: String(el.attrs.url || '').replace(/^data:image\/[\w.+-]+;base64,/i, 'base64://'),
          file: String(el.attrs.file || el.attrs.url || ''),
        } }, { internal: (action, params) => call(action, params ?? {}) as any }, { maxBytes, allowLocal: false, timeoutMs: 5000 }),
        add: async path => String((await call('add_custom_face', { file: path }))?.emoji_id ?? ''),
        rename: async (id, name) => { await call('modify_custom_face', { emoji_id: id, desc: name.slice(0, 20) }) },
        remove: async id => { await call('delete_custom_face', { emoji_id: id }) },
        async list(limit) {
          const result = await call('fetch_custom_face', { count: limit })
          return (Array.isArray(result) ? result : result?.data ?? []).map(x => typeof x === 'string' ? x : x?.url).filter(x => typeof x === 'string' && x)
        },
        attributes(item) {
          const old = item.market as { emojiId?: string; packageId?: number; key?: string } | undefined
          return old?.emojiId ? { 'qq:emoji': old.emojiId, 'qq:pack': String(old.packageId || ''), 'qq:key': old.key || '' } : {}
        },
      }
    },
  }
}
