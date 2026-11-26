// 后台定时任务不该在网关没连上时空跑：B 站刷视频、空间日记/互动、主动搭话（P4 起由 purpose 承担）
// 都会调 OneBot，没连上时跑了只会白白触发请求和日志。这里锁住「调度入口带网关判断」这个行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MODULES = ['bili', 'diary', 'qzone-social']

for (const id of MODULES) {
  test(`模块 ${id}：网关未连接时跳过定时任务`, () => {
    const src = readFileSync(new URL(`../src/modules/${id}/index.ts`, import.meta.url), 'utf8')
    assert.match(src, /api\.core\.onebot\?\.state/, `${id}/index.js 的定时任务缺少 onebot 状态判断`)
    assert.match(src, /!== 'connected'/, `${id}/index.js 的定时任务没有判断「未连接」`)
  })
}

// purpose 的守卫看「有没有在线的 bot」：适配器插件化之后平台不止 QQ，
// 单看 onebot.state 会把「只接了别的平台」误判成离线。
test('purpose：守卫看在线 bot 列表，不再绑死 onebot', () => {
  const src = readFileSync(new URL('../src/modules/purpose/index.ts', import.meta.url), 'utf8')
  assert.match(src, /api\.core\.bots\?\.list\?\.\(\)/)
  assert.match(src, /status === 'online'/)
  assert.ok(!src.includes('api.core.onebot?.state'), 'purpose 不该再直接读 onebot.state')
})
