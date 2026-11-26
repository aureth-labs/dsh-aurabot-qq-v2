# qq-api / qq-tools 改用 Bot 实例 API

- 编号：04
- 优先级：P0
- 状态：todo

## 现状

这些插件直接 onebot.call('get_group_list') 之类的私有调用，跨平台就废了。

## 目标

改用 session.bot.getGuildList() / getUserList() 等 Satori 语义方法；确实只有平台有的能力走 session.bot.internal.xxx()。

## 验收

grep 无 onebot.call；在 sandbox 与 onebot-v11 上各跑一遍同一段插件逻辑不报错。
