# hub 里的 OneBot 专用调用改 Satori

- 编号：15
- 优先级：P1
- 状态：todo

## 现状

chat/hub/events/*、hub/media/react.ts 直接用 OneBot 方法，平台差异漏进内核。

## 目标

统一 getGuildList/getUserList/createReaction/messageReaction 等 Satori 语义 API，平台差异留给适配器。

## 验收

grep 无 onebot 专有方法名；三平台适配器下同一逻辑都能跑。
