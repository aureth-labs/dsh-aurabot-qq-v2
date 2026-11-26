# notices 按 Satori 事件名

- 编号：35
- 优先级：P2
- 状态：todo

## 现状

现在按 QQ 事件名分发，跨平台不可用。

## 目标

改用 Satori 事件（guild-member-added 等），QQ 适配器负责下发；好友申请这类无 session 的走 data。

## 验收

QQ 与 sandbox 各触发一次通知；事件名与 Satori 文档一致。
