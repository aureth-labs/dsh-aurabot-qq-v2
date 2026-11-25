# QQ 官方机器人（未实现）

走 QQ 开放平台（q.qq.com）的官方接口：AppID + AppSecret 换 access_token，
收事件靠 WebSocket 或 HTTP 回调，发消息走 `/v2/groups/{group_openid}/messages`。

和 OneBot v11 的差别：

- 鉴权：AppID / AppSecret / 回调签名，不是「填个 QQ 号 + 网关地址」
- 群号是 `group_openid`（不是 QQ 群号），用户是 `member_openid`
- 被动回复有时间窗和条数限制；主动推送要单独申请
- 支持的富媒体比 OneBot 少，`<file>` / `<voice>` 需要上传换成 `media` 再发

要做的时候按 `../onebot-v11/` 的样子建 `index.ts` + `bot.ts`，
`platform` 仍然是 `qq`，`name` 写「QQ（官方机器人）」。
