# 删试运行，日志四级别 + 日志页

- 编号：54
- 优先级：P1
- 状态：todo

## 现状

试运行模式与 sandbox 重复；日志只有单一输出。

## 目标

删除试运行；logger 提供 info/warn/error/debug，debug 仅在调试模式输出；日志插件按长度分文件写 data/logs，页面流畅可过滤。

## 验收

grep 无 dryRun；日志页可切级别；大日志下滚动不掉帧。
