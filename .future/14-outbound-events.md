# 出站事件对齐 Koishi/Satori

- 编号：14
- 优先级：P1
- 状态：todo

## 现状

出站只有内部函数调用，插件无法拦截、取消或拿到 messageId。

## 目标

提供 before-send（可取消）、before-parse、message、send（带 messageId，可撤回）四个事件。

## 验收

写一个测试插件分别监听四个事件并生效；文档补事件表。
