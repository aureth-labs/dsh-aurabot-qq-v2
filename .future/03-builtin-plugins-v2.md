# 内置插件全部改成 v2 写法

- 编号：03
- 优先级：P0
- 状态：todo

## 现状

多数内置插件仍是 v1 形态，靠内核特判加载，和「社区插件与内置插件同一套写法」的目标不一致。

## 目标

统一为 export const name / usage / inject / Config / apply(ctx, config)；配置用 Schema 声明即可自动渲染面板。

## 验收

所有 packages/*/index.ts 只导出 v2 字段；内核无 v1 分支；逐个在 8787 热加载为 ready。

## 进度

- 加载器已认具名导出：`export const name/version/description/Config` + `export function apply`，
  `id` 取文件夹名；`Config` 是 Schema 时自动生成 `settings` 与 `defaults`。
- 已转换：`logger`（3.0.0）、`chat-bridge`（2.0.0）。21 个内置模块全部解析成功，无缺 id / 缺 apply。
- 剩 19 个仍是 `export default { id, ... }`。
