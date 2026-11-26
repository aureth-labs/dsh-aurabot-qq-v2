# @aurabot/plugin-api

AuraBot 插件接口 v2 的公开类型与 `Schema` 运行时。插件只依赖这一个包，
不用去翻宿主内部文件结构。

## 安装

```bash
npm install @aurabot/plugin-api
```

包还没发布到 npm 时，用本仓源码本地安装：

```bash
npm install file:D:/QQbots/project/github/aurabot/plugins/dsh-aurabot-qq-v2/packages/plugin-api
```

## 用法

```ts
import { Schema, type Ctx } from '@aurabot/plugin-api'

export const name = '示例'
export const config = Schema.object({
  greeting: Schema.string().default('你好').description('打招呼用的话'),
})

export function apply(ctx: Ctx, config: { greeting: string }) {
  ctx.command('hello').action(async ({ session }) => {
    await session.send(config.greeting)
  })
}
```

- `Schema` 的 `meta` 是宿主生成面板配置的唯一来源；加 `role('secret')` 的字段不会回传明文。
- `Ctx` / `Session` / `Element` / `AdapterSpec` 全部是类型，编译后不留代码。
- 接口版本用 `API_VERSION`（当前为 2）与 `package.json.aurabot.api` 对照。
