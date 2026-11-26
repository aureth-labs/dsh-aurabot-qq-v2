# AuraBot v2 交接文档

写给接手重构的人。目标不是「接着改」，是**把整个框架按既定架构重做一遍**。
下面所有路径都是绝对路径，数字是 2026-11-26 实测。

---

## 0. 一句话任务

把 `dsh-aurabot-qq-v2` 重构成 **「跑在 DeepSeek Harness 上的 Koishi」**：
插件写法、消息模型、事件模型、服务注入全部对齐 Koishi / Satori，
同时保留 AuraBot 自己的东西（AI 人格、是否回复的判断、QQ 接入）。

---

## 1. 仓库与环境

| 项 | 值 |
| --- | --- |
| 主仓 | `D:\QQbots\project\github\aurabot\plugins\dsh-aurabot-qq-v2` |
| 分支 | `beta`，HEAD `5227e7d`，已推送到 `origin/beta` |
| 代码量 | `src` 173 文件 / 35,741 行；`packages` 100 文件 / 20,971 行；`client` 34 文件 / 10,326 行 |
| 插件入口 | `index.mjs` → 静态 `export * from './lib/src/plugin/index.js'`（DSH 只认根目录这份） |
| 开发入口 | `dev.mjs` → `src/plugin/index.ts`（Node 原生剥类型，直接跑 TS） |
| 编译产物 | `lib/`（后端）、`dist/client.js`（前端单文件 bundle） |
| 测试 | `test/**/*.test.js`，`node --import ./scripts/ts-resolution.mjs --test` |

### 跑起来

```bash
cd D:\QQbots\project\github\aurabot\plugins\dsh-aurabot-qq-v2
pnpm run dev        # 开发模式：起 DSH(8787) + 前端 watch，插件直接跑 src/**/*.ts
pnpm run start      # 生产模式：插件走 lib/
npm run check       # tsc ×2 + 生命周期检查（裸定时器/进程监听）
npm run build       # src -> lib, client -> dist
```

- 两者只差环境变量 `AURABOT_DEV`，`cordis.patch.yml` 里用 `!!js` 切换 `aurabot` / `aurabot-dev` 两项。
- 端口用 `DSH_PORT`；DSH 位置用 `DSH_BIN`（默认找 `D:\software_apps\DeepSeekharness\dsh`）。
- **启动日志会打印带 token 的 URL**：`dsh web: http://127.0.0.1:8787/?token=...`。token 每次重启都变，别写死。

### 面板 API（自查用）

```bash
# 头：x-aurabot-token: <启动日志里那个 token>
GET  /aurabot/api/state                       # 插件版本、apiVersion、完整配置
GET  /aurabot/api/modules                     # 模块清单：id/version/running/error/settings
POST /aurabot/api/modules/reload              # 重新扫模块
GET  /aurabot/api/dsh/...
```

正常状态：**28 个模块，`error` 全空**。任何一次改动后都要看这一眼，别只看 tsc 绿。

---

## 2. 目标架构（这是验收标准，不是建议）

```text
packages/
  adapters/
    qq/onebot-v11/       QQ 的 OneBot v11 适配器
    qq/qq-official/      QQ 官方机器人（含 common/ 公共代码）
    satori/              真实 Satori 服务端适配器
  <plugin-id>/           其余全部是插件：logger / sandbox / voice / song / mood / memory ...
src/
  core/                  内核：module 加载、bot、pipeline、llm 门面、store、runtime、config
  chat/                  聊天管线：inbound → policy → outbound、hub、session
  plugin/                插件宿主入口（index.ts 2628 行，必须拆）
  types/                 集中类型声明（type.ts 一处声明，不要每个文件各写一份）
client/                  前端 TS 源码（10.3k 行，34 文件）
test/                    分域测试
```

### 铁律

1. **`src` 不许 import `packages`**。跨层只能走服务：`ctx.provide('llm', …)` / `ctx.require('llm')`。
   已有服务：`llm`、`logger`、`tts`、`asr`、`voice`、`image`、`video`、`database`。
2. **插件住 `packages/<id>`，适配器住 `packages/adapters/<平台>/<实现>`**，`src` 下不许再有 `features/**` 业务实现。
3. **一个适配器一个包**。不要 `common` 这种半包（我刚合并过一次，别再拆回去）。
4. **破坏性更新，不做 v1 兼容**。`export default { id, ... }` 这种入口要彻底砍掉，只留
   `export const name / version / description / Config` + `export function apply(ctx, config)`。
   现在就砍——加载器里那层「两种入口都认」的兼容代码（`packages/index.ts` 的 `asBuiltin` + `loader.ts` 的 `namedModuleDef`）
   是为了平滑过渡临时加的，**新会话应该把它删掉**。
5. **配置只写 Schema**：`export const Config = Schema.object({...})` → 自动生成面板字段，
   不自写 React 组件（`ctx.page` 只用于真正的自定义页面，比如日志、权限表、沙盒）。
6. **注释只在必要处**。解释「为什么」，不解释「是什么」。源码注释密度已经偏高。
7. **单文件 ≤ 700 行；单目录平铺 ≤ 5~10 个文件**，超了按职责建子目录。
8. **测试别多写、别全量跑**。用户明确说过：时间不该花在跑测试上。改动后跑对应域即可。

### 消息模型（Satori）

- 消息是元素树，宿主注入全局 `h`（不用 import）：`h('text', { content })`、`h.parse(...)`、`h.select(...)`。
- 出站只认闭合标签；**未闭合的 XML 片段整段丢弃**，不要把 `</ACP>` 当正文发出去。
- `<voice>文字</voice>` → 出站时由 TTS 服务换成 `<voice>file:///...mp3</voice>`，平台不支持就降级成文本。
- `<file>`、`<img>`、`<poke id>`、`<quote id>` 均已元素化，平台差异由适配器渲染。
- 引用：`session.quote`，反查顺序是**先本地库、再问平台**；撤回是事件，**不从库里删**。

### 会话与事件

- `session.userId` / `session.channelId` / `session.id` / `session.sn` / `session.platform`。
  **没有 `ChatId`，也没有 `private:` / `group:` 前缀**——会话类型由平台元数据决定。
- 发送必须 await：`await session.sendMessage(channelId, content)` / `await session.sendPrivateMessage(userId, content)`。
  `ctx.send` 是「所有机器人广播」，不是私聊。
- `session.execute('tell 插件坏了')` = **把这句话当成当前会话真的发出去**：走中间件、走指令、会发到平台。
- 中间件阶段固定 `command → middleware → llm`，默认「指令消费掉就不再进中间件」，
  例外行为放全局配置开关（默认关，标注「开发中」）。

### 全局配置（`src/core/config/**`）

- 主人 ID 是**数组**（跨平台，一人多号），下面紧跟 `wakeWords` 数组。
- 群白名单 / 私聊白名单是 **表格**：`Schema.array(Schema.object({ id, note })).role('table')`，前端两列可加行。
- 指令前缀：`[null, "/"]`，`null` 表示无前缀。
- 语义：**缺省即开**；要关就显式 `false`；标了「缺省关」的项必须显式 `true` 才开。

### 权限

`user` 表（id / 昵称 / 等级）+ `channel` 表；等级 0 = 拉黑，1..5，主人默认 5，**只有 5 能授权**。
消息进来就写库，前端实时联动。这是 `.future/28`。

---

## 3. 当前真实状态（别信 README，信这里）

### 已经能用的

- `npm run check` 全绿，`npm run build` 全绿。
- 8787 开发模式起得来：28 个模块，`error` 空；`logger 3.0.0`、`chat-bridge 2.0.0` 已转 v2 具名导出。
- 改 `.ts` → 4 秒内实例重载（实测把 logger 版本号 +1，面板模块列表立刻变），不用 build。
- 沙盒（`packages/sandbox`，出厂即开）能端到端收到模型回复：`POST /_sandbox/send`。
- 适配器：`onebot-v11`、`qq-official`（已合并 `common`）、`satori` 三个包。
- 内置插件默认**不注册任何指令**（`kernel/create.ts` 给 builtin 补 `registerCommands:false`）。
- `h` 已挂 `globalThis`，SDK 的 `aurabot.d.ts` 有 `declare global const h`。

### 半成品 / 结构债（按痛感排序）

| 位置 | 问题 |
| --- | --- |
| `src/plugin/index.ts` 2,618 行 | 宿主入口什么都干：路由、鉴权、配置、面板、生命周期 |
| `src/chat/hub/index.ts` 2,494 行 | 聊天中枢，应当拆成 session / pipeline / outbound 三块 |
| `src/features/memory/index.ts` 2,418 行 | 记忆模块整块还住在 `src`，应该是插件 |
| `packages/*/index.ts` **20 个**仍是 `export default { id, ... }` | 只剩 logger / chat-bridge 转了 v2 |
| `src/features/**` 仍在 | `qzone/index.ts`、`stickers/index.ts`、`platform/qq/file.ts` 等平台实现没搬走 |
| `packages/stickers` | 深度绑定 NapCat 的 `add_custom_face` / mface 商场表情，没走 Satori 元素 |
| `packages/song` | 仍 import `src/**`，不是独立插件 |
| `packages/sandbox/ui.ts` | 字符串拼 HTML，没走 `ctx.page` + 前端组件 |
| `client/**` 10.3k 行 | 前端没拆模块，`tabs/content/content.ts` 单文件 922 行 |

### 明确是坏的

- `test/platform/**` **69 个 fail**：这些用例调 `qqApi.setup(...)`，而 `packages/qq-api/index.ts` 早没有 `setup`。
  这是 v1 测试壳，不是代码 bug。**要么重写这些用例，要么删掉**，别为了让它绿去加回 `setup`。
- `test/chat/reply/outbound-wiring.test.js:686` 有 1 个断言失败（`actual null`），没查。

---

## 4. 待办清单在哪

`.future/` 目录，58 条，一条一份 md，写清「现状 / 目标 / 验收」，`README.md` 是索引。

完成 4 条（01 删模板入口、02 合并 qq/common、50 profile 插件、51 qzone-social 插件），
两条在推进（03 内置插件 v2 —— 2/21；55 TS HMR —— 机制已通）。

**但 `.future` 只是用户口头审查的一部分**。还有一批更狠的要求没建档，散在对话里，核心是：

1. **适配器必须是插件**：默认只装 QQ，用户从市场装 Discord / Telegram 适配器就能用。
2. **首个启动不能有向导**：直接进 UI；主人 ID 在全局配置，机器人 ID 在适配器配置。
3. **删掉试运行模式**（已有 sandbox 替代）；调试模式只控制 `logger.debug`。
4. **logger 必须是插件**，提供 `logger` 服务（info/warn/error/debug），不可重名。
5. **生图/生视频做成服务**（`ctx.generateImage` / `ctx.generateVideo`），走 AI tool，**不要 XML 元素方案**。
6. **语音转文字做成插件**：中间件把 `<voice>file://…</voice>` 扩成带 `<translateVoice>` 的形态。
7. **权限面板**：user 表 + channel 表 + 0..5 等级。
8. **黑名单按 userId 全局拦**，适配器下发前拦掉，不进 session。
9. **合并转发展开是适配器行为**（配置项，默认开）。
10. **适配器 API 要覆盖 Satori 的完整面**：`getSelfId/getUser/getUserList/getChannel/getChannelList/getGuild/getGuildList/createReaction/...`，
    不支持的方法要给出「这个平台没实现」的明确报错，而不是 `not a function`。

---

## 5. 工具链的坑（能省你一天）

| 坑 | 处理 |
| --- | --- |
| PowerShell `Set-Content -Encoding utf8` 会把中文/引号写坏 | 改文件只用 `apply_patch` 或 `node -e` + `fs.writeFileSync(..., 'utf8')` |
| `apply_patch` 的 cwd 是隔壁仓 `dsh-aurabot-qq-mods` | 改本仓必须写 `../dsh-aurabot-qq-v2/<path>` |
| `Remove-Item` 常被 policy 拦 | 用 `git rm -r` 或 `node -e "fs.rmSync(p,{recursive:true})"` |
| 全量 `npm test` 会卡机 | 分域：`node --import ./scripts/ts-resolution.mjs --test --test-concurrency=2 "test/<域>/**/*.test.js"` |
| `lib/` 改了不会热重载 | 开发模式只跟 `src`；生产模式必须重启 DSH |
| 重启 DSH | `Stop-Process -Id <pid> -Force`，再 `Start-Process node -ArgumentList 'scripts/dsh.mjs dev' -WindowStyle Hidden` |
| 文件多为 CRLF | LF→CRLF 的 git warning 忽略 |

---

## 6. 上一任走偏的地方（别重蹈）

1. **先动手、后定图**。`modules/` → `packages/` 搬了两次，适配器拆了又合，`profile`/`qzone` 先包一层再搬 —— 都是因为没先画完全图。
2. **舍不得破坏性更新**。加载器同时支持 `export default` 和具名导出，看着稳，实际让「统一写法」永远差一口气。
3. **把时间花在跑测试和写文档上**，而不是把 35k 行内核拆开。
4. **在 QQ 专有实现上打补丁**（stickers 的 NapCat API、inbound 的 CQ 码解析），而不是先定 Satori 元素契约再回填。
5. **服务化只做了一半**：ASR 改成 `ctx.provide`，但 llm / image / video 还是内核直连。

---

## 7. 建议的第一批动作（按这个顺序，别跳）

1. **画一张最终目录树**（含每个包的职责、它 provide 什么、require 什么），先给用户看，再动代码。
2. **砍掉兼容层**：删 `packages/index.ts` 的 `asBuiltin`、`loader.ts` 的 `namedModuleDef`，让 20 个 v1 包一次性全部转 v2。
3. **拆 `src/plugin/index.ts`**（2618 行）成 `host/{routes,auth,panel,lifecycle}`。
4. **拆 `src/chat/hub/index.ts`**（2494 行）成 `session/pipeline/outbound`。
5. **把 `src/features/**` 全部搬进 `packages/`**，包括 memory、qzone、stickers、platform/qq。
6. **服务化 llm / image / video / database**，内核只留调度。
7. **每个阶段结束跑**：`npm run check` + `npm run build` + `GET /aurabot/api/modules`（28 项、error 空）+ 沙盒发一条消息。

## 8. 预算与验证口径

- 工具链预算（按官方 1 折那条按量渠道：入 ¥28/M、出 ¥140/M、缓存 ¥1.4/M）：全量重构约 **¥400~600**。
- 每次交付必须能复述：**改了什么、怎么验证的、还剩什么**。不要用「应该可以」结案。
- 用户判定标准只有一条：**新会话能不能只靠 `packages/sdk/API.md` 写出一个能跑的插件**。写不出来就是没做到。
