// 插件「__NAME__」—— 放在数据目录 modules/__ID__/ 里，插件升级不会动它。
// 保存就生效：改这个文件夹里的任何文件，几秒内整个插件重新加载。
//
// 类型提示：同目录有 aurabot.d.ts，下一行就是补全入口。
// 用不到的部分删掉即可。

/** @type {import('./aurabot').AurabotModule} */
export default {
  name: '__NAME__',
  version: '0.1.0',
  description: '一个例子：关键词自动回复 + 指令 + AI 工具 + 定时任务',

  // 面板按 settings 自动生成表单；默认值也进这里（缺省即开，显式 false 才关）。
  defaults: {
    replies: '早安=早呀～今天也要元气满满\n晚安=晚安，做个好梦',
    onlyOwner: false,
    registerCommands: false,
  },
  settings: [
    { key: 'replies', label: '关键词=回复', type: 'textarea', hint: '一行一条；完全匹配才回，不经过模型' },
    { key: 'onlyOwner', label: '只回主人', type: 'boolean' },
    { key: 'registerCommands', label: '注册指令（默认关）', type: 'boolean' },
  ],

  /**
   * @param {import('./aurabot').Ctx} ctx
   * @param {Record<string, any>} config
   */
  apply(ctx, config) {
    const table = () => Object.fromEntries(
      String(config.replies || '')
        .split('\n')
        .map((line) => line.split('='))
        .filter((pair) => pair.length >= 2)
        .map(([key, ...rest]) => [key.trim(), rest.join('=').trim()]),
    )

    // 1. 中间件：命中就回一句，不调 next() = 这条到此为止
    ctx.middleware(async (session, next) => {
      if (config.onlyOwner && !ctx.isOwner(session.userId)) return next()
      const reply = table()[session.content.trim()]
      if (!reply) return next()
      await session.send(reply)
    }, { name: '__ID__-replies' })

    // 2. 指令（不经过 AI）：官方默认关，这里跟配置走
    if (config.registerCommands) {
      ctx.command('__ID__')
        .description('看看配了哪些关键词')
        .action(() => Object.keys(table()).join('、') || '还没配关键词')
    }

    // 3. 给 AI 调用的工具：用户不能直接触发，模型自己决定传参
    ctx.tool({
      name: '__TOOL___keywords',
      description: '看看自动回复配了哪些关键词',
      properties: {},
      execute: async () => ({ ok: true, message: Object.keys(table()).join('、') || '没有' }),
    })

    // 4. 定时任务：插件卸载 / 重载时自动停，不会泄漏
    ctx.setInterval(60 * 60_000, () => ctx.logger.debug('「__NAME__」还活着'), '__ID__-tick')
  },
}
