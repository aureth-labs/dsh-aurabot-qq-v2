// 网页半边的入口。打包成 dist/client.js 后由宿主当模块加载：
//   window.__ModuleLoader__.load({ id: 'dsh-aurabot-qq', factory })
// 这里导出的就是模块的 exports，宿主读 apply / inject。

export { inject } from './core/api/constants.ts'
export { apply } from './apply.ts'
export { AurabotPage } from './panel.ts'
export { WhaleIcon } from './core/ui/icons.ts'
