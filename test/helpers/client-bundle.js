// 面板真产物：用 scripts/bundle-client.mjs 现场打一份 dist/client.js 的等价文本。
//
// 需要「跑起来看行为」的用例（渲染组件、调内部纯函数）应该用这个，而不是读源码文本——
// 源码是 TS，带类型标注和 import/export，直接丢进 vm 跑不了；读旧单文件又会读到过期副本。
//
// 同一进程只打一次（esbuild 约 0.3s）。同步接口，用例不用为了读产物全改成 async。
import { bundleClientSync } from '../../scripts/bundle-client.mjs'

const FACTORY_END = '    return module.exports'

let cache = null

/** dist/client.js 的文本（含 window.__ModuleLoader__.load 包装）。 */
export function clientBundleText() {
  if (cache === null) cache = bundleClientSync()
  return cache
}

/**
 * 往 factory 末尾塞一批额外导出，给测试拿内部组件用。
 *
 * 打包后所有模块符号都在同一个 factory 作用域里，所以 `{ Market, sortMarketModules }`
 * 这种写法能直接引用到；不用再像旧单文件那样找 `exports.xxx = xxx` 锚点。
 */
export function injectExports(source, expression) {
  if (!source.includes(FACTORY_END)) throw new Error('bundle 结构变了：factory 末尾锚点找不到')
  return source.replace(FACTORY_END, `    Object.assign(module.exports, ${expression})\n${FACTORY_END}`)
}
