# 插件模板

一个 AuraBot v2 插件只需一个目录 + 一份清单式入口，没有单独的 `index.mjs`。

```text
packages/<id>/
  index.ts       只写 name / usage / inject / Config / apply，实现放同目录其它文件
  config.ts      Schema 声明（自动渲染面板，不必写前端组件）
  package.json   name / version / aurobot.api = 2
```

`apply(ctx, config)` 里能拿到 `ctx.command`、`ctx.tool`、`ctx.middleware`、`ctx.on`、
`ctx.page`、`ctx.setInterval`、`ctx.bot` / `ctx.bots`、`ctx.logger`、`ctx.llm` 等能力，
完整清单见 `packages/sdk/API.md`。
