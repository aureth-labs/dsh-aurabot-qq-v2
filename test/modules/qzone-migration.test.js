import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateQzone } from '../../packages/app/migrations/qzone.ts'

test('迁移空间设置与原账号历史，保留备份和已有插件配置', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'qzone-migration-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const id = 'shangxueink/qzone'
  const raw = {
    botQQ: '123456',
    ownerQQ: '654321',
    diary: {
      enabled: false,
      visibility: 'selected',
      audienceQQs: '12345',
      rich: { enabled: true, local: true, folder: 'D:/photos' },
    },
    ext: { [id]: { minChars: 30 } },
  }
  const json = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify(raw))
  writeFileSync(
    join(dir, 'diary.json'),
    JSON.stringify({
      history: [{ tid: 'one', imageCount: 2 }],
      plan: { day: '2026-11-27', times: [11], done: [] },
    }),
  )
  migrateQzone(dir)
  const cfg = json('config.json')
  assert.deepEqual(json('config.json.before-community-qzone'), raw)
  assert.equal(cfg.diary, undefined)
  assert.equal(cfg.ext[id].social, false)
  assert.equal(cfg.ext[id].diary, false)
  assert.equal(cfg.ext[id].rich, true)
  assert.equal(cfg.ext[id].visibility, 'selected')
  assert.equal(cfg.ext[id].minChars, 30)
  const directory = 'modules-data/' + id
  const files = readdirSync(join(dir, directory))
  assert.deepEqual(json(directory + '/' + files.find((file) => file.endsWith('-schedule.json'))).slots, [11])
  assert.equal(json(directory + '/' + files.find((file) => file.endsWith('-diary.json')))[0].images, 2)
  migrateQzone(dir)
  assert.deepEqual(json('config.json'), cfg)
  assert(existsSync(join(dir, 'diary.json')))
})
