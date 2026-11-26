// 插件唯一入口（DSH 只认根目录的这份），加载编译产物 lib/。
//
// 这里必须是静态 re-export：dsh-hmr 只跟随静态 import 的模块图。
// 用 await import() 的话，整棵子图对它不可见，改 lib 不会热重载。
//
// 开发期想直接跑 TS 源码、不产出 JS：起 dsh 时带 AURABOT_DEV=1，
// cordis.patch.yml 会把这一项换成 aurabot-dev（dev.mjs -> src/host.ts）。
export * from './lib/src/host.js'
