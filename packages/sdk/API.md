# Aurabot 插件接口（v2）

具名导出 name、config 和 apply(ctx, config)。开发依赖 @aurabot/plugin-api 提供 Schema、h、Bot 和类型，安装后的插件由宿主提供同一接口。
能力全部从 `ctx` 取，注册的东西随插件卸载自动回收。这份文件随插件同步到数据目录 `modules/`，别改它。

## 最小例子

```ts
import { Schema, type Ctx } from '@aurabot/plugin-api'

export const name = '打招呼'

export const config = Schema.object({
  reply: Schema.string().default('你好呀～').description('回复内容'),
})

export function apply(ctx: Ctx, config: { reply: string }) {
  ctx.middleware(async (session, next) => {
    if (session.content.trim() !== '你好') return next()
    await session.send(config.reply)
  })
}
```

| 形态 | 放哪 | 适合 |
| --- | --- | --- |
| 单文件 | `modules/<id>.mjs` | 关键词回复、链接解析 |
| 文件夹 | `modules/<id>/index.ts` 或 `package.json` 的 `main` | 要分文件、带依赖、带面板 |

文件夹名就是插件 id（小写字母开头，小写字母 / 数字 / `-`，2~40 字）。以 `_` 或 `.` 开头的不加载。
`Schema` 与 `h` 由宿主注入到全局，不用 import。

Schema 的 `title('字段名')` 与 `description('填写说明')` 分别用于表单标签与提示。多行文本可用 `Schema.string().role('textarea')`。

## 可选导出

| 导出 | 说明 |
| --- | --- |
| `name` / `version` / `description` | 面板显示用 |
| `Config` | `Schema.object({...})`，面板表单与默认值都从它派生 |
| `kind = 'adapter'` | 适配器插件 |
| `reusable = true` | 允许多份配置（适配器默认开） |
| `reloadOnConfig = true` | 改配置后整个插件重载；默认只换 `ctx.config` |

## ctx

| 写法 | 说明 |
| --- | --- |
| `ctx.config` / `ctx.updateConfig(patch)` | 本插件配置（活值） |
| `ctx.root.config` | 全局配置（主人、指令前缀、黑白名单……） |
| `ctx.logger` | `info / warn / error / debug` |
| `ctx.setInterval / setTimeout / effect` | 随卸载回收 |
| `ctx.middleware(fn, { name, before, after })` | 入站中间件 |
| `ctx.command('名字 <参数>').action(fn)` | 指令（不经过 AI） |
| `ctx.tool(spec \| (where) => spec[])` | 给 AI 调用的工具，用户不能直接触发 |
| `ctx.prompt(fn)` / `ctx.rule(text)` | 每轮上下文 / 系统提示规则 |
| `ctx.think(prompt, { title, key, timeoutMs })` | 以她的人格跑一轮后台会话，返回正文 |
| `ctx.thinkCooldown(key?)` | 后台会话在退避期就给出 `retryAt` |
| `ctx.ask(options)` | 裸问一次模型（无人格、无会话） |
| `ctx.llm.generate({ text, system?, sessionId?, maxTokens? })` | 使用配置的模型生成回复，调用失败会抛错 |
| `ctx.llm.polish / rewrite / summarize` | 文本小任务 |
| `ctx.chatLog.read(day) / append(...)` | 她的聊天流水 |
| `ctx.server.get/post/...` + `ctx.http.body/query/send` | 面板接口 |
| `ctx.page({ path, name })` | 侧栏页面 |
| `ctx.on / ctx.emit` | 事件 |
| `ctx.provide(name, impl)` / `ctx.require(name)` / `ctx.get(id)` | 服务 |
| `ctx.bots` / `ctx.bot(id?, platform?)` | 省略 ID 取默认实例。多个平台共用一个 ID 时，传入平台才能定位实例。 |
| `ctx.isOwner(session)` | 按平台和可选机器人实例匹配。也可传入 userId、platform 与可选 botId。 |
| `ctx.dataDir(...parts)` | 本插件数据目录 |
| `ctx.platform('qq') / ctx.guild() / ctx.private()` | 作用域视图 |

## Bot

Bot 承载平台 API，和 Satori 对齐：`sendMessage / sendPrivateMessage / getUser / getGuild / getGuildList /
getUserList / getChannel / getChannelList / getMessage / getMessageList / deleteMessage / createReaction`。
平台不支持的方法抛 `UnsupportedApiError`。

平台专属能力走 `bot.internal(action, params)`：QQ 上就是 OneBot action，例如

```ts
const bot = ctx.bots.list().find((b) => b.platform === 'qq' && b.status === 'online')
await bot?.internal('send_qzone_msg', { content: '今天天气不错' })
```

只支持某个平台的插件在 `package.json` 写 `aurabot.platforms: ["qq"]`。

## 消息与 h

消息是 Satori 元素树：

```ts
await session.send(h('text', { content: '你好' }))
await session.send([h.text('看这个：'), h.image('https://example.com/a.png')])
h.select(h.parse('<at id="123"/> 你好'), 'at')
```

适配器按能力表渲染，发不出去的元素降级成文字。模型吐出的未知或未闭合标签整块丢弃。
`<voice>要念的话</voice>` 出站时交给 TTS 服务。

## 管线

```text
入站 → command → middleware → llm（她自己判断要不要回）
```

- 中间件不调 `next()` 就算处理完；`return next()` 交给下一段
- `session.send()` 可多次调用，每次一条
- `session.execute('tell …')` 等价于当前会话又发了这句话，过完整管线

## 适配器插件

```ts
export const name = 'Discord'
export const kind = 'adapter'
export const Config = Schema.object({ token: Schema.string().role('secret') })

export async function apply(ctx, config) {
  await ctx.adapter({ platform: 'discord', async connect(cfg, runtime) { /* 返回已上线的 bot */ } }, config)
}
```

连接完成后宿主登记 Bot。网关掉线或恢复时，适配器先更新 `bot.status`，再调用 `runtime.statusChanged(reason?)`。同一实例在重连期间保留原 ID。

频道 ID 原样传递。对群和私聊可能使用相同编号的平台，用 `bot.getChannel(channelId, session.type)` 或 `bot.getMessageList(channelId, { channelType: session.type, limit: 20 })` 指明类型。

## 开发

- 入口写 `.ts`，同目录 `aurabot.d.ts` 提供 `ctx` / `session` / `h` 补全
- 保存即热重载（监听整个插件文件夹）
- `debug` 日志只在面板打开调试模式时输出；日志在 `<数据目录>/data/logs/`

### 引用消息

原消息包含引用时，命令和中间件可读取 `session.quote`。引用始终包含原消息 ID 与频道 ID。本机已有记录或适配器能按会话确认来源时，还会提供正文和发送者。已撤回的记录提供 `deletedAt`。

## 服务依赖

插件可导出 `export const inject = ['llm']`，也可以在 package.json 中声明 `aurabot.inject`。宿主等待这些服务就绪后调用 `apply`。提供者退出时，依赖它的实例会释放命令、定时器和监听器。服务恢复后，仍启用的实例会重新启动。

用 `ctx.provide('服务名', 实现对象)` 提供服务。同一个服务名只能由一个实例持有；面板会显示冲突双方的实例名。可选功能通过 `ctx.services.get(name)` 查询。默认的 `llm` 插件提供 `ctx.llm.generate`、`polish`、`rewrite` 和 `summarize`。替换模型实现时，先停用原提供者，再启用实现同一接口的插件。

## 消息和平台事件

| `ctx.on` 事件 | 参数与调用时机 |
| --- | --- |
| `before-parse` | 解析入站消息前按注册顺序调用，可异步替换 `draft.elements`。 |
| `message` | 指令和中间件运行前收到 `Session`。`userId` 是发送者，`id` 是消息 ID，`sn` 是适配器给出的事件序号。 |
| `before-send` | 参数含 `bot`、`target` 和待发送的 `elements`。监听器返回 `true` 即取消此次发送。 |
| `send` | 发送成功后触发。平台返回消息 ID 时写入 `messageId`。平台将一条内容拆为多条消息时，每个 ID 触发一次。 |
| `guild-member-added`、`guild-member-removed`、`guild-member-updated` | 成员变更。事件提供 `botId`、`guildId`、`userId` 与平台资源 `data`。 |
| `friend-request`、`guild-request`、`guild-member-request` | 好友、邀请或入群申请。申请标识和附言可从 `data.message` 读取。 |
| `message-deleted`、`message-updated` | 撤回或编辑。按 `platform`、`botId`、`channelId` 与 `messageId` 定位消息。 |

对支持撤回且返回频道和消息 ID 的适配器，可在 `send` 监听器里调用 `await event.bot.deleteMessage(event.channelId, event.messageId)`。主动私信时频道 ID 取决于平台回执。试运行、入队和被取消的发送不会触发成功事件。
