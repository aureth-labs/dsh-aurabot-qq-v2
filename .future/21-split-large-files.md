# 拆分超过 700 行的文件

- 编号：21
- 优先级：P2
- 状态：todo

## 现状

chat/hub/index.ts、chat/policy/outbound/index.ts 等文件过长，阅读与改动成本高。

## 目标

按职责拆成同目录子模块，单文件 ≤ 700 行。

## 验收

脚本统计全仓无 >700 行的 TS 源文件。
