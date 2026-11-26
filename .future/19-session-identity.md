# 会话标识统一 userId / id / sn

- 编号：19
- 优先级：P2
- 状态：todo

## 现状

query.ts 里混用多种字段名，容易取错。

## 目标

统一 session.userId（用户）、session.id（消息）、session.sn（会话序号）语义。

## 验收

query.ts 只用这三个字段；相关测试通过。
