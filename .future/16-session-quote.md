# 引用消息 session.quote

- 编号：16
- 优先级：P1
- 状态：todo

## 现状

引用靠解析平台私有字段，且撤回会把库里的消息删掉。

## 目标

提供 session.quote；用 session.bot.getMessage(id) 反查，先查本地库再问平台；撤回是事件，不删库。

## 验收

sandbox 与 onebot 下引用均可解析；撤回后库里仍有记录且标记为已撤回。
