import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../src/core/store/index.ts'
import { backup, createFile, object, read, type Values } from './files.ts'

const plugin = 'shangxueink/bilibili'
const adapter = 'adapter-qq-onebot-v11'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const rows = (value: unknown) => (Array.isArray(value) ? value.map(object) : [])
const positive = (value: unknown) => Math.max(0, Number(value) || 0)
const qq = (value: unknown) => (/^[1-9]\d+$/.test(String(value)) ? String(value) : '')

function credentials(old: Values) {
  const keys = {
    sessdata: 'SESSDATA',
    biliJct: 'bili_jct',
    dedeUserId: 'DedeUserID',
    buvid3: 'buvid3',
    buvid4: 'buvid4',
  }
  const values = new Map<string, string>()
  for (const raw of [old.cookie, old.sessdata, old.biliJct]) {
    for (const field of String(raw || '').split(';')) {
      const match = /^\s*([\w]+)=([^;\s]+)\s*$/.exec(field)
      if (match && Object.values(keys).includes(match[1])) values.set(match[1], match[2])
    }
  }
  for (const [field, key] of Object.entries(keys)) {
    const value = String(old[field] || '').trim()
    if (value && !/[;\s]/.test(value) && !/^(?:SESSDATA|bili_jct)=/.test(value)) values.set(key, value)
  }
  return [...values].map(([k, v]) => k + '=' + v).join('; ')
}
function settings(raw: Values, old: Values, enabled: boolean) {
  const group = object(old.groupShare),
    perms = object(raw.profilePerms)
  const targets: { platform: string; botId: string; type: string; id: string }[] = []
  if (enabled && old.shareToOwner !== false && qq(raw.ownerQQ))
    targets.push({ platform: 'qq', botId: adapter, type: 'private', id: qq(raw.ownerQQ) })
  if (enabled && group.enabled === true && qq(group.groupId))
    targets.push({ platform: 'qq', botId: adapter, type: 'group', id: qq(group.groupId) })
  const config: Values = { cookie: credentials(old), destinations: targets }
  const limits = {
    intervalHours: 168,
    maxRunsPerDay: 100,
    perRun: 10,
    minViews: 1e9,
    maxAgeDays: 3650,
    maxCommentsPerDay: 100,
    maxRepliesPerDay: 100,
    maxDanmakuPerDay: 100,
    visionFrames: 6,
    shotLibrary: 1000,
  }
  for (const [key, max] of Object.entries(limits)) {
    if (typeof old[key] === 'number' && Number.isFinite(old[key]))
      config[key] = Math.max(0, Math.min(max, Math.round(old[key])))
  }
  if (typeof old.ffmpegPath === 'string') config.ffmpegPath = old.ffmpegPath.trim()
  if (typeof old.offpeak === 'boolean') config.offpeak = old.offpeak
  if (Array.isArray(old.keywords)) config.keywords = old.keywords.filter((k) => typeof k === 'string')
  for (const key of ['autoBrowse', 'comment', 'reply', 'like', 'danmakuEnabled', 'autoDanmaku', 'vision'])
    config[key] =
      enabled &&
      (old[key] === true || (old[key] === undefined && ['autoBrowse', 'comment', 'reply'].includes(key)))
  for (const [key, legacy] of [
    ['ownerComment', 'biliComment'],
    ['changeSign', 'biliSign'],
    ['changeAvatar', 'biliAvatar'],
  ])
    config[key] = enabled && perms[legacy] !== 'off'
  for (const [key, legacy] of [
    ['shareLimit', 'dailyLimit'],
    ['pendingHours', 'pendingTtlHours'],
    ['queueLimit', 'queueLimit'],
  ])
    if (group[legacy] !== undefined) config[key] = group[legacy]
  return config
}
function entry(row: Values) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(String(row.bvid))) return
  return {
    bvid: String(row.bvid),
    title: String(row.title || ''),
    thought: String(row.text || ''),
    part: 1,
    at: positive(row.at),
    aid: 0,
    author: '',
    views: 0,
    published: 0,
    desc: '',
    cover: '',
    public: false,
  }
}
function migrateJournal(root: string, dest: string, key: string, raw: Values, cfg: Values) {
  const load = (name: string) => (existsSync(join(root, name)) ? object(read(join(root, name))) : {})
  const old = load('bili.json'),
    share = load('bili-group-share.json')
  const today = new Date().toLocaleDateString('sv-SE')
  const counts = { browse: 0, comment: 0, reply: 0, share: 0, danmaku: 0 }
  if (old.day === today)
    Object.assign(counts, {
      browse: positive(old.runs),
      comment: positive(old.comments),
      reply: positive(old.replies),
    })
  if (share.day === today) counts.share = positive(share.sentToday)
  const danmaku = rows(load(join('modules-data', 'bili', 'danmaku.json')).history).filter(
    (r) => r.submitted === true,
  )
  counts.danmaku = danmaku.filter(
    (r) => new Date(positive(r.at)).toLocaleDateString('sv-SE') === today,
  ).length
  const targets = rows(cfg.destinations)
  const pending = rows(share.items).flatMap((row) => {
    const item = entry(row),
      selfId = qq(raw.botQQ)
    const target = targets.find(
      (t) => t.type === 'group' && t.id === qq(row.groupId) && t.platform === 'qq' && t.botId === adapter,
    )
    const expires = positive(row.at) + Number(cfg.pendingHours ?? 24) * 3600000
    if (row.state !== 'pending' || !selfId || !target || !item || !(expires > Date.now())) return []
    return [
      {
        id: digest(JSON.stringify([row.id, item.at, item.bvid, target.id])).slice(0, 8),
        item,
        target,
        selfId,
        expires,
      },
    ]
  })
  const history = rows(old.history)
    .filter((r) => r.kind === 'watch')
    .flatMap((r) => entry(r) || [])
  createFile(join(dest, key + '-browsing.json'), {
    history,
    pending,
    day: today,
    counts,
    lastRun: positive(old.lastRun),
    seenReplies: Array.isArray(old.repliedFeed) ? old.repliedFeed.map(String).slice(0, 500) : [],
  })
}
function migrateFrames(root: string, dest: string, key: string) {
  const source = join(root, 'bili-shots'),
    index = join(source, 'index.json')
  if (!existsSync(index) || !lstatSync(source).isDirectory() || !lstatSync(index).isFile()) return
  const directory = join(dest, 'frames-' + key)
  for (const row of rows(object(read(index)).items)) {
    const name = String(row.file)
    if (!/^[a-f0-9]{12}\.jpg$/.test(name)) continue
    const path = join(source, name)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue
    const bytes = readFileSync(path),
      md5 = createHash('md5').update(bytes).digest('hex')
    if (!md5.startsWith(name.slice(0, 12)) || bytes[0] !== 255 || bytes[1] !== 216) continue
    mkdirSync(directory, { recursive: true })
    const file = join(directory, md5 + '.jpg')
    createFile(file, bytes)
    createFile(file + '.json', {
      md5,
      title: String(row.title || ''),
      bvid: String(row.bvid || ''),
      second: positive(row.sec),
      at: positive(row.at),
      public: false,
    })
  }
}
export function migrateBilibili(root = dataDir()) {
  const path = join(root, 'config.json')
  if (!existsSync(path)) return
  const raw = object(read(path))
  if (!Object.hasOwn(raw, 'bili')) return
  backup(path, '.before-community-bilibili')
  const old = object(raw.bili),
    modules = object(raw.modules),
    ext = object(raw.ext)
  const enabled = old.enabled === true && object(modules.bili).enabled !== false
  const cfg = settings(raw, old, enabled)
  const cookie = String(cfg.cookie)
  const key = digest(
    /\bDedeUserID=(\d+)\b/.exec(cookie)?.[1] || /\bSESSDATA=([^;]+)/.exec(cookie)?.[1] || 'anonymous',
  ).slice(0, 24)
  const dest = join(root, 'modules-data', plugin)
  mkdirSync(dest, { recursive: true })
  migrateJournal(root, dest, key, raw, cfg)
  migrateFrames(root, dest, key)
  const local = object(raw.local)
  if (old.ffmpegPath && !local.ffmpegPath) local.ffmpegPath = old.ffmpegPath
  const existing = object(ext[plugin])
  delete raw.bili
  delete modules.bili
  const perms = object(raw.profilePerms)
  for (const key of ['biliSign', 'biliComment', 'biliAvatar']) delete perms[key]
  const migrated =
    Object.hasOwn(existing, 'cookie') && existing.cookie !== cfg.cookie ? existing : { ...cfg, ...existing }
  writeJson(path, { ...raw, local, modules, ext: { ...ext, [plugin]: migrated } })
}
