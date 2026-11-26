# identity.ts 提示词不写死 QQ

- 编号：24
- 优先级：P2
- 状态：todo

## 现状

身份提示词里硬编码「QQ」，换平台就错了。

## 目标

改用 session.platform 变量拼装。

## 验收

grep 提示词无 QQ 字面量；sandbox 下提示词为 sandbox。
