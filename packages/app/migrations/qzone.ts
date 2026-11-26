import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { dataDir, writeJson } from '../../../src/core/store/index.ts'

const plugin = 'shangxueink/qzone'
const adapter = 'adapter-qq-onebot-v11'
type Values = Record<string, unknown>

function object(value: unknown): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {}
}

function read(path: string) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown
}

function createFile(path: string, value: unknown) {
  if (existsSync(path)) return
  const tmp = path + '.' + randomUUID()
  writeFileSync(tmp, JSON.stringify(value))
  try {
    linkSync(tmp, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    unlinkSync(tmp)
  }
}

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
  const backup = path + '.before-community-qzone'
  try {
    copyFileSync(path, backup, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
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
