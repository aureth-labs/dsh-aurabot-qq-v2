# packages/adapters/qq/common 并入 qq-official

- 编号：02
- 优先级：P0
- 状态：todo

## 现状

现在 QQ 下有三个包：common / onebot-v11 / qq-official，一个适配器被拆成两个包，安装与升级都难对齐。

## 目标

common 的公共代码并入 qq-official，形成「一个适配器一个包」；qq-official 内部再分 src/ 子目录。

## 验收

packages/adapters/qq 下只剩 onebot-v11 与 qq-official；无 common 目录；两包各自 npm run check 通过、可单独加载。
