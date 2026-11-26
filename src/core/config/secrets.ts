import { isObj } from './shared.ts'

export type BuildBiliCookieOptions = Partial<Record<'sessdata' | 'biliJct' | 'buvid3' | 'buvid4' | 'dedeUserId', any>>
export type SplitBiliCookieOptions = Partial<Record<'sessdata' | 'biliJct' | 'cookie' | 'buvid3' | 'buvid4' | 'dedeUserId', any>>

// 面板里不回传原文的字段：路径（几层都行）
const SECRETS = [['voice', 'fishApiKey'], ['onebot', 'httpToken'], ['onebot', 'wsToken'], ['imageGen', 'apiKey'], ['imageGen', 'minimax', 'apiKey'], ['voice', 'asrApi', 'apiKey'], ['memory', 'vector', 'apiKey'], ['memory', 'rerank', 'apiKey'], ['song', 'neteaseCookie'], ['bili', 'cookie'], ['bili', 'sessdata'], ['bili', 'biliJct'], ['heybox', 'cookie'], ['bridge', 'token'], ['video', 'minimax', 'apiKey'], ['video', 'custom', 'headers'], ['voice', 'volcano', 'apiKey'], ['voice', 'breeze', 'key'], ['voice', 'breeze', 'password'], ['voice', 'minimax', 'apiKey'], ['backup', 'remote', 'token'], ['backup', 'remote', 'webdav', 'password']]
// 扩展模块设置里的密码类字段（模块加载时登记）：['ext', 模块id, 字段]
const extraSecrets = new Map()
export function registerSecretField(path) { extraSecrets.set(path.join('\u0000'), path) }
export const allSecrets = () => [...SECRETS, ...extraSecrets.values()]
export const parentOf = (obj, path, create) => {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) { if (!create) return null; cur[k] = {} }
    cur = cur[k]
  }
  return cur
}
export const getAt = (obj, path) => { const p = parentOf(obj, path, false); return p ? p[path.at(-1)] : undefined }
// 这些密钥在面板里显示结尾几位（「已保存（结尾 …a1b2）」），方便认出存的是哪一份；完整值不回传
export const HINTED = [['bili', 'sessdata'], ['bili', 'biliJct']]

/** 从一串 Cookie 里取某个值（「SESSDATA=xxx; bili_jct=yyy」）。 */
export function cookieValue(raw, key) {
  for (const part of String(raw || '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === key) return part.slice(i + 1).trim()
  }
  return ''
}

/**
 * 把票和设备指纹拼成接口要的 Cookie 串。字段顺序固定：SESSDATA → bili_jct → buvid3 → buvid4 → DedeUserID。
 * 扫码登录、配置归一化、手工粘贴三条路都走这里——各拼一份的话，字段或顺序漂移一次，票就和指纹对不上了。
 */
export function buildBiliCookie({ sessdata = '', biliJct = '', buvid3 = '', buvid4 = '', dedeUserId = '' } : BuildBiliCookieOptions = {}) {
  return [
    sessdata && `SESSDATA=${sessdata}`,
    biliJct && `bili_jct=${biliJct}`,
    buvid3 && `buvid3=${buvid3}`,
    buvid4 && `buvid4=${buvid4}`,
    dedeUserId && `DedeUserID=${dedeUserId}`,
  ].filter(Boolean).join('; ')
}

/**
 * B 站 Cookie 整理成完整指纹：粘了整串 / 带了「SESSDATA=」前缀的都认得；老配置只有整串的拆开。
 * 返回 {sessdata, biliJct, buvid3, buvid4, dedeUserId, cookie}，cookie 是拼好给接口用的。
 * 设备指纹三项优先用字段，为空时从整串 cookie 里补（扫码登录写回配置后，重启也沿用同一个指纹）。
 */
export function splitBiliCookie({ sessdata = '', biliJct = '', cookie = '', buvid3 = '', buvid4 = '', dedeUserId = '' } : SplitBiliCookieOptions = {}) {
  const a = String(sessdata || '').trim()
  const b = String(biliJct || '').trim()
  // 框里粘的是「xxx=…」这种整串或带前缀的：从里面取；纯值原样用
  const isRaw = (v) => /(^|;\s*)(SESSDATA|bili_jct)=/.test(v)
  let s = isRaw(a) ? '' : a
  let j = isRaw(b) ? '' : b
  for (const v of [a, b]) {
    if (!isRaw(v)) continue
    s = cookieValue(v, 'SESSDATA') || s
    j = cookieValue(v, 'bili_jct') || j
  }
  if (!s && !j && cookie) {
    s = cookieValue(cookie, 'SESSDATA')
    j = cookieValue(cookie, 'bili_jct')
  }
  // 指纹：字段优先；没填就从整串 cookie / 粘进来的整串里找。都没有就保持空串，不产生空段。
  let b3 = String(buvid3 || '').trim()
  let b4 = String(buvid4 || '').trim()
  let uid = String(dedeUserId || '').trim()
  if (!b3 || !b4 || !uid) {
    const sources = [cookie, isRaw(a) ? a : '', isRaw(b) ? b : ''].filter(Boolean)
    for (const src of sources) {
      if (!b3) b3 = cookieValue(src, 'buvid3')
      if (!b4) b4 = cookieValue(src, 'buvid4')
      if (!uid) uid = cookieValue(src, 'DedeUserID')
    }
  }
  return { sessdata: s, biliJct: j, buvid3: b3, buvid4: b4, dedeUserId: uid, cookie: buildBiliCookie({ sessdata: s, biliJct: j, buvid3: b3, buvid4: b4, dedeUserId: uid }) }
}
