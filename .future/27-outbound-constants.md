# 出站常量与规则去 QQ 化

- 编号：27
- 优先级：P2
- 状态：todo

## 现状

policy/outbound/constants.ts 写死平台参数，rules/access.ts 有 QQ 专属分支。

## 目标

常量进全局配置；access 只按通用权限等级判断。

## 验收

grep 无 QQ 专属判断；常量可从面板调整。
