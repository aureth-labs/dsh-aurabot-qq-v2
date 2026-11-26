// 内置模块：空间互动。逛好友动态点赞评论，回复自己说说下的新评论。

import { createQzoneSocial } from './src/social.ts'

export default {
  id: 'qzone-social',
  name: '空间互动',
  version: '1.0.0',
  description: '逛好友的 QQ 空间点赞评论，回复自己说说下的评论',
  tab: 'diary',
  apply(ctx, config) {
    const { hub, onebot } = ctx.host
    const social = createQzoneSocial({ getConfig: ctx.root.read, onebot, hub, memory: ctx.lazy('memory'), log: ctx.logger })
    ctx.setInterval(60_000, () => (ctx.host.onebot?.state && ctx.host.onebot.state !== 'connected' ? undefined : social.tick()), '空间互动')
    ctx.server.get('/qzone/social/run', async () => social.run({ force: true }))
    ctx.server.get('/qzone/social/state', async () => ({ ok: true, ...social.state() }))
    return social
  },
}
