# 模型切换独立成插件

- 编号：10
- 优先级：P1
- 状态：todo

## 现状

模型切换指令散在 delegated-commands.ts 与 group-settings-command.ts，属于内核职责外溢。

## 目标

独立「模型切换」插件，走 ctx.llm.config.model；配置区分私聊/群聊/仅主人。

## 验收

内核无模型切换代码；插件默认不注册指令；开启后能在群/私聊切换并落配置。
