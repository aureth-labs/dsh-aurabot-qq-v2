# QQ 频道（未实现）

走 QQ 频道的机器人接口（`api.sgroup.qq.com`）：Bot Token + 分片 WebSocket 收事件，
发送走 `/channels/{channel_id}/messages`。

和另外两种的差别：

- 频道 id、子频道 id、身份组（角色）是它独有的概念
- 消息里有 `ark` / `embed` / `markdown` 这些频道专有模板
- 权限按「身份组 + 频道」两级配

要做的时候按 `../onebot-v11/` 的样子建 `index.ts` + `bot.ts`，
`platform` 仍然是 `qq`，`name` 写「QQ（频道）」，能力表里把 `markdown` 打开。
