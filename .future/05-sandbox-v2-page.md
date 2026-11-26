# sandbox 改 v2 + 页面不用字符串拼 HTML

- 编号：05
- 优先级：P0
- 状态：todo

## 现状

sandbox 仍是 v1；ui.ts 里手拼 HTML 字符串，样式与交互无法复用 DSH 前端能力。

## 目标

sandbox 走 v2 apply；页面用 ctx.page 注册，前端复用 DSH 的 React 组件（至少独立 HTML+前后端通信），目标对齐 Koishi WebUI 的 ctx.page。

## 验收

sandbox 出厂即开；页面能从侧栏进入并完成收发消息；ui.ts 无字符串拼 DOM。
