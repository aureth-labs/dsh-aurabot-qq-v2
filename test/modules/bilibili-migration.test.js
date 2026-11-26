import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateBilibili } from '../../packages/app/migrations/bilibili.ts'

test('配置与浏览数据留在原账号；迁移可重试，已改的设置和历史优先', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-bili-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const name = 'shangxueink/bilibili',
    base = 'modules-data/' + name + '/'
  const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
  const save = (p, v) => writeFileSync(join(root, p), JSON.stringify(v))
  const raw = {
    botQQ: '12345',
    ownerQQ: '98765',
    bili: {
      enabled: true,
      dedeUserId: '100',
      sessdata: 'example',
      ffmpegPath: 'tool',
      groupShare: { enabled: true, groupId: '777' },
    },
  }
  save('config.json', raw)
  const item = { bvid: 'BV1234567890', at: Date.now(), title: '云', text: '晴天' }
  save('bili.json', { history: [{ ...item, kind: 'watch' }], repliedFeed: [27] })
  save('bili-group-share.json', {
    items: [
      { ...item, id: 1, state: 'pending', groupId: '777' },
      { ...item, id: 2, state: 'sent', groupId: '777' },
      { ...item, id: 3, state: 'pending', groupId: '888' },
    ],
  })
  mkdirSync(join(root, 'bili-shots'))
  const bytes = Buffer.from([255, 216, 255, 217]),
    hash = createHash('md5').update(bytes).digest('hex')
  const file = hash.slice(0, 12) + '.jpg'
  writeFileSync(join(root, 'bili-shots', file), bytes)
  save('bili-shots/index.json', { items: [{ ...item, file, sec: 5 }, { file: '../config.json' }] })
  migrateBilibili(root)
  const cfg = json('config.json'),
    key = createHash('sha256').update('100').digest('hex').slice(0, 24)
  const journal = base + key + '-browsing.json'
  assert.deepEqual(json('config.json.before-community-bilibili'), raw)
  assert(!('bili' in cfg))
  assert.equal(cfg.local.ffmpegPath, 'tool')
  assert.equal(cfg.ext[name].autoBrowse, true)
  assert.deepEqual(json(journal).seenReplies, ['27'])
  assert.equal(json(journal).history[0].public, false)
  assert.deepEqual(
    json(journal).pending.map((p) => [p.selfId, p.target.id]),
    [['12345', '777']],
  )
  assert.equal(json(base + 'frames-' + key + '/' + hash + '.jpg.json').public, false)
  assert(existsSync(join(root, 'bili-shots', file)))
  save(journal, { history: ['custom'] })
  raw.bili.enabled = false
  save('config.json', { ...raw, ext: { [name]: { cookie: 'DedeUserID=200' } } })
  migrateBilibili(root)
  assert.deepEqual(json('config.json').ext[name], { cookie: 'DedeUserID=200' })
  assert.deepEqual(json(journal), { history: ['custom'] })
  migrateBilibili(root)
  save('config.json', raw)
  migrateBilibili(root)
  assert.equal(json('config.json').ext[name].reply, false)
  assert.deepEqual(json('config.json').ext[name].destinations, [])
})
