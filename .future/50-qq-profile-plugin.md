# src/features/platform/qq/profile.ts 抽成插件

- 编号：50
- 优先级：P1
- 状态：todo

## 现状

这是 QQ 平台专有能力，却住在内核 features 下。

## 目标

抽成独立插件（packages/profile 或 packages/adapters/qq 下的附属插件），走 Satori 语义方法。

## 验收

src 下无该文件；插件可单独卸载；QQ 下资料卡功能不变。
