import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { backup, createFile, object, read, type Values } from './files.ts'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../src/core/store/index.ts'

const plugin = 'shangxueink/qzone'
const adapter = 'adapter-qq-onebot-v11'
function historyFor(selfId: string, root: string) {
  const dir = join(root, 'modules-data', plugin)
  mkdirSync(dir, { recursive: true })
  const prefix = createHash('sha256')
    .update(JSON.stringify([adapter, selfId]))
    .digest('hex')
  const file = (name: string) => join(dir, prefix + '-' + name + '.json')
  const diaryPath = join(root, 'diary.json')
  if (existsSync(diaryPath)) {
    const old = object(read(diaryPath))
    if (Array.isArray(old.history))
      createFile(
        file('diary'),
        old.history.map((item) => ({ ...object(item), images: object(item).imageCount ?? 0 })),
      )
    const plan = object(old.plan)
    if (Array.isArray(plan.times) && Array.isArray(plan.done))
      createFile(file('schedule'), {
        day: plan.day,
        slots: plan.times,
        done: plan.done,
        retry: plan.retry || {},
      })
  }
  const social = join(root, 'qzone-social.json')
  if (existsSync(social)) createFile(file('social'), read(social))
}

export function migrateQzone(root = dataDir()) {
  const path = join(root, 'config.json')
  if (!existsSync(path)) return
  const raw = object(read(path))
  if (!Object.hasOwn(raw, 'diary') && !Object.hasOwn(raw, 'qzoneSocial')) return
  backup(path, '.before-community-qzone')
  const previous = raw.diary
  const { enabled: diaryOn, rich, archive, ...diary } = object(previous)
  const { enabled: socialOn, ...social } = object(raw.qzoneSocial)
  const modules = object(raw.modules)
  const ext = object(raw.ext)
  const awake = object(raw.speakUp)
  const richConfig = object(rich)
  const archiveConfig = object(archive)
  const cleaned = { ...raw }
  delete cleaned.diary
  delete cleaned.qzoneSocial
  const settings = {
    ...diary,
    ...social,
    ...richConfig,
    rich: richConfig.enabled === true,
    archive: archiveConfig.enabled === true,
    archiveFolder: archiveConfig.folder,
    awakeFrom: awake.awakeFrom,
    awakeTo: awake.awakeTo,
    botId: adapter,
    diary: diaryOn !== false && object(modules.diary).enabled !== false,
    social:
      socialOn !== false &&
      (raw.qzoneSocial !== undefined || !raw.ownerQQ) &&
      object(modules['qzone-social']).enabled !== false,
  }
  delete (settings as Values).enabled
  delete (settings as Values).cards
  if (/^[1-9]\d+$/.test(String(raw.botQQ || ''))) historyFor(String(raw.botQQ), root)
  writeJson(path, { ...cleaned, ext: { ...ext, [plugin]: { ...settings, ...object(ext[plugin]) } } })
}
