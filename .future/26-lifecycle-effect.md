# media/recent 等生命周期用 ctx.effect

- 编号：26
- 优先级：P2
- 状态：todo

## 现状

靠手写定时器与全局 Map 维护，插件卸载会漏。

## 目标

改用 ctx.effect / ctx.on('dispose') 自动回收。

## 验收

卸载插件后定时器与缓存清空；无残留 setInterval。
