# QQ 解析与表情表搬进 onebot-v11

- 编号：25
- 优先级：P1
- 状态：todo

## 现状

inbound/index.ts 与 chat/media/face/table.ts 里有 QQ 专有的消息解析与表情表。

## 目标

搬进 packages/adapters/qq/onebot-v11，由适配器把 CQ 码解析成元素树。

## 验收

内核无 CQ 码解析、无 QQ 表情表；onebot 适配器自测通过。
