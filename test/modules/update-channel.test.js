import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecker, compareVersions } from '../../src/core/runtime/update.ts'

test('npm 渠道可即时切换，正式版覆盖预览，重复查询复用缓存', async () => {
  let subscribed = false, calls = 0, stable = '1.7.0'
  const check = createUpdateChecker({ pkg: { name: '@team/bot', version: '2.0.0-beta.3' }, unstable: () => subscribed,
    fetchImpl: async url => {
      calls++
      assert.equal(url, 'https://registry.npmjs.org/-/package/%40team%2Fbot/dist-tags')
      return Response.json({ latest: stable, beta: '2.0.0-beta.10', next: 'oops' })
    } })
  const [a, b] = await Promise.all([check(), check()])
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.newer, false)
  subscribed = true
  assert.equal((await check()).latest, '2.0.0-beta.10'); assert.equal(calls, 2)
  stable = '2.0.0'
  assert.equal((await check({ force: true })).latest, '2.0.0')
  assert(compareVersions('2.0.0-rc.1', '2.0.0-beta.10') > 0)
  assert.equal(compareVersions('2.0.0+local', '2.0.0'), 0)
})

test('未发布与暂时离线分别报告，手动重查可恢复', async () => {
  let status = 404
  const check = createUpdateChecker({ pkg: { name: 'aurabot', version: '1.0.0' },
    fetchImpl: async () => status === 200 ? Response.json({ latest: '1.1.0' }) : new Response(null, { status }) })
  assert.match((await check()).message, /尚无 npm 发布/)
  status = 503
  assert.equal((await check({ force: true })).ok, false)
  status = 200
  assert.equal((await check({ force: true })).newer, true)
})
