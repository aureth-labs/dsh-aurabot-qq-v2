# Aurabot 插件接口（v2）

插件只写一种形态：`apply(ctx, config)`。能力全部从 `ctx` 取，注册的东西随插件卸载自动回收。
这份文件在插件每次启动时同步到数据目录 `modules/`，**别改它**。

## 两种插件

| 形态 | 放哪 | 适合 |
| --- | --- | --- |
| 单文件 | `modules/<id>.mjs` | 关键词回复、链接解析，几十行就写完 |
| 文件夹 | `modules/<id>/index.ts` 或 `index.mjs` | 要分文件、要装 npm 依赖、要带面板页 |

单文件只认 `.mjs`：`modules/` 下没有 `package.json` 兜底，`.js` 会被 Node 当成 CommonJS。
TS 入口直接用 Node 的类型剥离跑，不需要先编译；保存就热重载。

## 最小例子

```ts
import type { Ctx } from './aurabot'

export default {
  name: '打招呼',
  defaults: { registerCommands: false },
  apply(ctx: Ctx, config: Record<string, any>) {
    ctx.middleware(async (session, next) => {
      if (session.content.trim() !== '你好') return next()
      await session.send('你好呀～')
    }, { name: 'hello' })
  },
}
```

文件夹名就是插件 id（小写字母开头，只能小写字母、数字、`-`，2~40 字）。以 `_` 或 `.` 开头的文件夹不加载。

## 模块定义

```ts
export default {
  name: '查天气',
  version: '0.1.0',
  description: '一句话说明',
  kind: 'plugin',          // 适配器写 'adapter'
  reusable: false,         // 适配器可以开多个实例时写 true
  reloadOnConfig: false,   // true = 改配置后整个插件重载；默认只换 config 对象
  defaults: { city: '北京' },
  settings: [
    { key: 'city', label: '城市', type: 'string' },
  ],
  apply(ctx, config) { /* … */ },
}
```

`api` 字段不用写（现在只有 v2）。`setup(api)` 已删除，不再兼容。

## ctx 能力

| 写法 | 说明 |
| --- | --- |
| `ctx.config` | 本插件配置（活值，面板保存后立刻更新） |
| `ctx.root.config` | 全局配置（多主人、指令前缀、黑白名单……） |
| `ctx.updateConfig(patch)` | 存本插件配置 |
| `ctx.logger` | `info / warn / error / debug`；`debug` 只在面板打开调试模式时输出 |
| `ctx.setInterval(ms, fn, label?)` | 定时器，卸载自动清 |
| `ctx.setTimeout(ms, fn)` | 同上 |
| `ctx.effect(fn)` | 注册一个清理函数，卸载时执行 |
| `ctx.middleware(fn, { name, before, after })` | 入站中间件 |
| `ctx.command('名字 <参数>').action(fn)` | 注册指令（不经过 AI） |
| `ctx.tool(spec)` | 注册给 AI 调用的工具；用户不能直接触发，要靠模型决定调用并传参 |
| `ctx.server.get/post/...` | 面板 HTTP 接口，默认走面板鉴权 |
| `ctx.page({ path, name, icon, order, url })` | 侧栏注册页面 |
| `ctx.on / ctx.emit` | 自定义事件；任何插件都能定义自己的事件名给别的插件监听 |
| `ctx.get(id)` / `ctx.lazy(id)` | 取另一个插件的导出 |
| `ctx.provide(name, impl)` / `ctx.require(name)` | 服务：谁提供都行，没人提供就明确报错 |
| `ctx.voice` / `ctx.sing` / `ctx.database` / `ctx.ffmpeg` | 常用服务的快捷入口 |
| `ctx.bots` | 机器人列表：`ctx.bots[0]`、`ctx.bots('号')`、`ctx.bots.list()` |
| `ctx.bot(id?)` | 同上，按 id 取默认 / 指定实例 |
| `ctx.broadcast(targets, content)` | 按 Target 广播 |
| `ctx.sendTo / sendImage / sendFile / sendVoiceFile / reply` | 主动发送 |
| `ctx.ask(options)` | 问一次模型，不进聊天会话 |
| `ctx.isOwner(userId)` | 是不是主人（支持多个主人 ID） |
| `ctx.dataDir(...parts)` | 本插件的数据目录 |

`ctx.command` 对官方插件受配置项 `registerCommands` 控制（默认关）；社区插件不声明这个字段时照常注册。

## 消息与 h

消息内部是一棵元素树，平台差异留给适配器。宿主注入全局 `h`，不用 import：

```ts
await session.send(h('text', { content: '你好' }))
await session.send(h.image('https://example.com/a.png'))
await session.send([h.text('看这个：'), h.file('file:///D:/a.zip')])

const tree = h.parse('<at id="123"/> 你好')
h.select(tree, 'image')
h.stringify(tree)
```

发送接受字符串、元素、元素数组。适配器按自己的能力表渲染；发不出去的元素降级成文字占位符，不会整条吞掉。

模型吐出的未知标签（`<acp>`、`<thinking>` 之类）整块丢弃；孤立的闭标签只丢标签，正文照发。

`<voice>要念的话</voice>` 会在出站时交给 TTS 换成音频；`<file>file:///路径</file>` 同理。

## 管线三段

```text
入站消息
  └─ command    指令命中 → action
       └─ middleware  插件中间件（默认段）
            └─ llm        AI 消费 → 模型 → ctx.tool → 发送
```

- 指令先匹配；没被消费才进中间件
- 中间件 `return`（不调 `next()`）= 这条处理完了；`return next()` = 交给下一段
- 同一段可以多次 `await session.send()`，每次都真的发
- `session.execute('tell …')` 等价于当前会话又发了这句话：过完整管线，该发就发；递归深度限 1

全局配置 `middlewareAfterCommand`（默认关）可以让指令消费完也继续走中间件。

## 配置与面板

`defaults` + `settings` 就能生成面板表单，不需要写前端：

```ts
export default {
  defaults: { city: '北京', onlyOwner: false },
  settings: [
    { key: 'city', label: '城市', type: 'string' },
    { key: 'onlyOwner', label: '只回主人', type: 'boolean' },
  ],
  apply(ctx, config) { /* config.city */ },
}
```

语义：缺省即开；`null` 缺省 = 关，显式 `true` 才开。

要自己画面板时用 `ctx.page` 注册页面，前端放 `panel.js`（可选）。

## 服务

内核和插件都不直接 import 别人的实现，只认服务：

```ts
// 提供
ctx.provide('weather', { query: async (city) => ({ city, text: '晴' }) })

// 使用
const weather = ctx.require('weather')   // 没人提供就抛错
const maybe = ctx.services.get('weather') // 没有返回 null
```

内置服务：`voice`（TTS）、`tts`、`asr`、`sing`、`database`、`ffmpeg`。

## 适配器插件

适配器也是插件，只是 `kind: 'adapter'`，`apply` 里注册机器人：

```ts
export default {
  name: 'Discord',
  kind: 'adapter',
  reusable: true,
  defaults: { token: '' },
  settings: [{ key: 'token', label: 'Bot Token', type: 'password' }],
  async apply(ctx, config) {
    const bot = await ctx.adapter({ platform: 'discord' }, config)
    return { bot }
  },
}
```

连上、登录、上线之后才发 `online` 事件；下线时正常下线，再调用它的 API 会抛错。
平台不支持的资源方法（`getGuild` / `getMessageList` 之类）由基类抛 `UnsupportedApiError`，不静默返回空。

## 开发体验

**类型提示**：入口写 `.ts`，同目录的 `aurabot.d.ts` 就是类型源；VS Code 直接有 `ctx` / `session` / `h` 的补全。
`.mjs` 文件在 `export default` 上一行写 `/** @type {import('./aurabot').AurabotModule} */` 也有补全。

**热重载**：保存即生效。插件会监听整个插件文件夹（递归），改文件、加文件、删文件都会重新加载，
发行版里也一样，不用重启宿主。

**日志**：`ctx.logger.info` 少用；`debug` 只在面板打开调试模式时出现。日志文件在
`<数据目录>/data/logs/`，面板「日志」页能按文件查看。

**排查**：面板「已安装」页会显示插件在不在跑、报错原因。常见原因：

- 文件夹名和 `id` 不一致
- 入口不是 ESM（单文件必须是 `.mjs`）
- 依赖没装（在插件文件夹里 `npm install`）
- 忘了 `await` 发送方法

## 内置插件

内置插件同样住在 `packages/<id>/`，和社区插件走同一套接口。它们可以被单独关掉；
想改就复制一份到 `modules/<id>/` 覆盖，或者直接给仓库提 issue。
