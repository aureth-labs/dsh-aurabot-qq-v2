# .future — 待办与审查意见索引

每条建议一份文件，写清现状 / 目标 / 验收。完成一项就把「状态」改成 done，并在 commit 里带上编号。 4 / 58 done.

| 编号 | 事项 | 优先级 | 状态 |
| --- | --- | --- | --- |
| 01 | [删除 packages/_template/index.mjs](./01-delete-template-mjs.md) | P0 | done |
| 02 | [packages/adapters/qq/common 并入 qq-official](./02-merge-qq-common.md) | P0 | done |
| 03 | [内置插件全部改成 v2 写法](./03-builtin-plugins-v2.md) | P0 | todo |
| 04 | [qq-api / qq-tools 改用 Bot 实例 API](./04-bot-api-session.md) | P0 | todo |
| 05 | [sandbox 改 v2 + 页面不用字符串拼 HTML](./05-sandbox-v2-page.md) | P0 | todo |
| 06 | [ChatId 改名 channelId，去掉 private:/group: 前缀](./06-channelid-no-prefix.md) | P0 | todo |
| 07 | [song 插件彻底独立](./07-song-standalone.md) | P1 | todo |
| 08 | [生图/生视频做成服务，XML 改 tool](./08-image-video-service.md) | P1 | todo |
| 09 | [每个插件 index.ts 只做导出](./09-index-only-exports.md) | P2 | todo |
| 10 | [模型切换独立成插件](./10-model-switch-plugin.md) | P1 | todo |
| 11 | [src/chat/commands 清理](./11-commands-cleanup.md) | P2 | todo |
| 12 | [全局配置的名单改成表格](./12-global-config-tables.md) | P1 | todo |
| 13 | [默认模型按能识图处理](./13-drop-no-vision.md) | P1 | todo |
| 14 | [出站事件对齐 Koishi/Satori](./14-outbound-events.md) | P1 | todo |
| 15 | [hub 里的 OneBot 专用调用改 Satori](./15-hub-satori-api.md) | P1 | todo |
| 16 | [引用消息 session.quote](./16-session-quote.md) | P1 | todo |
| 17 | [图片收录与大文件上限进全局配置](./17-media-limits-config.md) | P2 | todo |
| 18 | [语音转文字做成插件](./18-asr-plugin.md) | P1 | todo |
| 19 | [会话标识统一 userId / id / sn](./19-session-identity.md) | P2 | todo |
| 20 | [logger 服务插件化](./20-logger-plugin.md) | P1 | todo |
| 21 | [拆分超过 700 行的文件](./21-split-large-files.md) | P2 | todo |
| 22 | [群头衔过滤改全局黑名单](./22-title-filter-global.md) | P2 | todo |
| 23 | [合并转发展开改适配器行为](./23-merge-forward-adapter.md) | P2 | todo |
| 24 | [identity.ts 提示词不写死 QQ](./24-identity-platform.md) | P2 | todo |
| 25 | [QQ 解析与表情表搬进 onebot-v11](./25-inbound-qq-parsing.md) | P1 | todo |
| 26 | [media/recent 等生命周期用 ctx.effect](./26-lifecycle-effect.md) | P2 | todo |
| 27 | [出站常量与规则去 QQ 化](./27-outbound-constants.md) | P2 | todo |
| 28 | [权限管理面板](./28-permission-panel.md) | P1 | todo |
| 29 | [唤醒词进全局配置](./29-wakewords-global.md) | P2 | todo |
| 30 | [表情包插件走 Satori 元素](./30-stickers-satori.md) | P2 | todo |
| 31 | [给模型当前 messageId 以支持引用](./31-quote-for-model.md) | P2 | todo |
| 32 | [保留常驻时间上下文](./32-keep-time-context.md) | P3 | todo |
| 33 | [删除 html-fragments.ts](./33-delete-html-fragments.md) | P3 | todo |
| 34 | [poke 改成元素](./34-poke-element.md) | P2 | todo |
| 35 | [notices 按 Satori 事件名](./35-notices-satori.md) | P2 | todo |
| 36 | [用量页改纯 token 统计](./36-usage-token-panel.md) | P3 | todo |
| 37 | [LLM 做成服务插件](./37-llm-service.md) | P1 | todo |
| 38 | [ffmpeg 查找跨平台](./38-ffmpeg-cross-platform.md) | P3 | todo |
| 39 | [插件市场换 v2 镜像源](./39-market-v2-mirror.md) | P2 | todo |
| 40 | [备份打包 basedir](./40-backup-basedir.md) | P3 | todo |
| 41 | [浏览器定位改用 puppeteer-finder](./41-puppeteer-finder.md) | P2 | todo |
| 42 | [更新检查改 npm 发布口径](./42-update-npm.md) | P3 | todo |
| 43 | [消息库统一用 node:sqlite](./43-sqlite-store.md) | P2 | todo |
| 44 | [审查 persona-memory-bridge 的网关提示](./44-persona-bridge-review.md) | P3 | todo |
| 45 | [出站脱敏做成插件](./45-redact-plugin.md) | P2 | todo |
| 46 | [删 support/time/official-reference.ts 与 features/codex](./46-delete-official-ref.md) | P3 | todo |
| 47 | [QQ 空间与 B 站拆成两个插件](./47-qzone-bili-plugins.md) | P2 | todo |
| 48 | [memory/mood 暂留并确认默认值](./48-memory-mood-default.md) | P3 | todo |
| 49 | [「用户发完消息」判定参考 AstrBot](./49-notices-astrbot.md) | P3 | todo |
| 50 | [src/features/platform/qq/profile.ts 抽成插件](./50-qq-profile-plugin.md) | P1 | done |
| 51 | [src/features/qzone/social.ts 抽成插件](./51-qzone-social-plugin.md) | P1 | done |
| 52 | [本地接口文档口径：TS 插件 + ESM 小脚本](./52-readme-module-js.md) | P2 | todo |
| 53 | [删掉设置向导，直接进 UI](./53-no-setup-wizard.md) | P0 | todo |
| 54 | [删试运行，日志四级别 + 日志页](./54-no-dryrun-logger.md) | P1 | todo |
| 55 | [TS 源码直接 HMR](./55-ts-hmr.md) | P1 | todo |
| 56 | [适配器即插件](./56-adapter-as-plugin.md) | P2 | todo |
| 57 | [配置语义统一：缺省即开](./57-config-semantics.md) | P2 | todo |
| 58 | [目录层级与平铺文件上限](./58-flat-file-limit.md) | P3 | todo |
