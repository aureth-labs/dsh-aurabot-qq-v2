# TS 源码直接 HMR

- 编号：55
- 优先级：P1
- 状态：todo

## 现状

HMR 监听的是产物，改 TS 必须等编译，开发体验割裂。

## 目标

dev 流程内置 tsc -w（对开发者透明），HMR 目录指向产物；文档写明 hmr.root 该怎么配。

## 验收

保存 .ts 后 1s 内实例重载；文档有对应章节。

## 进度

- 实测：`npm run build` 之后 8787 上的 `logger` 仍显示旧版本号，说明 dsh-hmr 没跟随重新构建的 `lib/`。
  入口 `index.mjs` 静态导出 `lib/src/plugin/index.js`，监听只覆盖它自己那张图；
  改 `.ts` 能热重载，改完再 build 的产物不行。
- 已落地：`pnpm run dev` 起 DSH 并带 `AURABOT_DEV=1`（dev 入口 + 前端 watch），
  `pnpm run start` 走 `lib/`。实测改 `packages/logger/index.ts` 的 version，4 秒后
  8787 上的模块列表就变成新版本，没有 build。
