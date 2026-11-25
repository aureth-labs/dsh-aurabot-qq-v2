// 开发入口：直接跑 src/ 里的 TS，不产出任何 JS。
//
// 用法：起 dsh 时带 AURABOT_DEV=1。cordis.patch.yml 会禁用 aurabot、
// 启用 aurabot-dev（name: dsh-aurabot-qq/dev），不需要改任何 profile 配置。
// 原理：Node >= 22.18 原生剥离类型，`./x.ts` 直接 import 就是源码本身。
// 这里必须是**静态** re-export：dsh-hmr 沿 Node 的 ESM 模块图找文件，
// 静态 import 的每一步都留在图里，改任何一个 .ts 都会热重载。
// 动态 import 不进模块图，那条路是没有热重载的。
export * from './src/host.ts'
