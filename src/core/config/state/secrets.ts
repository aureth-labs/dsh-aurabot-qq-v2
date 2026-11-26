import { isObj } from './shared.ts'

// 面板里不回传原文的字段：路径（几层都行）
const SECRETS = [['voice', 'fishApiKey'], ['onebot', 'httpToken'], ['onebot', 'wsToken'], ['imageGen', 'apiKey'], ['imageGen', 'minimax', 'apiKey'], ['voice', 'asrApi', 'apiKey'], ['memory', 'vector', 'apiKey'], ['memory', 'rerank', 'apiKey'], ['song', 'neteaseCookie'], ['heybox', 'cookie'], ['bridge', 'token'], ['video', 'minimax', 'apiKey'], ['video', 'custom', 'headers'], ['voice', 'volcano', 'apiKey'], ['voice', 'breeze', 'key'], ['voice', 'breeze', 'password'], ['voice', 'minimax', 'apiKey'], ['backup', 'remote', 'token'], ['backup', 'remote', 'webdav', 'password']]
export const allSecrets = () => SECRETS
export const parentOf = (obj, path, create) => {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) { if (!create) return null; cur[k] = {} }
    cur = cur[k]
  }
  return cur
}
export const getAt = (obj, path) => { const p = parentOf(obj, path, false); return p ? p[path.at(-1)] : undefined }
