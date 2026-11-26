# 删除 html-fragments.ts

- 编号：33
- 优先级：P3
- 状态：todo

## 现状

不闭合 XML 本来就不渲染，这段容错逻辑是多余的。

## 目标

删除 reply/format/html-fragments.ts 及其引用。

## 验收

文件不存在；相关测试删除；check 通过。
