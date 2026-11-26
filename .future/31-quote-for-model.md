# 给模型当前 messageId 以支持引用

- 编号：31
- 优先级：P2
- 状态：todo

## 现状

模型不知道自己回的是哪条，无法主动引用。

## 目标

出站前在上下文里带上 session.messageId（或完整 JSON），模型可用 <quote id="…"/> 引用。

## 验收

模型输出 quote 元素时适配器渲染为引用；无 quote 时行为不变。
