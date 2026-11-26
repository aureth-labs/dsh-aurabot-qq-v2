# 消息库统一用 node:sqlite

- 编号：43
- 优先级：P2
- 状态：todo

## 现状

仍有可能写 JSON 的路径。

## 目标

全部走 Node 内置 sqlite，放 data/ 下。

## 验收

grep 无 JSON 落盘消息；重启后历史仍在。
