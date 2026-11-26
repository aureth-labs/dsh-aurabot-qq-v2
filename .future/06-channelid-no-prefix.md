# ChatId 改名 channelId，去掉 private:/group: 前缀

- 编号：06
- 优先级：P0
- 状态：todo

## 现状

用 private:/group: 前缀表达会话类型，既不符合 Satori，也挡死了 GitHub issue/PR 这类新前缀。

## 目标

统一叫 channelId；会话类型由平台与 channel 元数据决定，不再靠字符串前缀推断。receipts.ts 等一并改。

## 验收

grep 无 ChatId 类型；无 private:/group: 前缀判断；相关测试按 channelId 重写并通过。
