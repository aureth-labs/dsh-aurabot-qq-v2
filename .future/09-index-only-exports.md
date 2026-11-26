# 每个插件 index.ts 只做导出

- 编号：09
- 优先级：P2
- 状态：todo

## 现状

部分插件 index.ts 里塞满实现，入口文件读起来像主文件而不是清单。

## 目标

index.ts 只写 name/usage/inject/Config/apply 等导出与方法转发，实现放同目录其它文件。

## 验收

所有 packages/*/index.ts 均 ≤ 60 行且无业务实现。
