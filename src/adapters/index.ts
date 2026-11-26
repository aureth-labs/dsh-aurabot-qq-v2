// 适配器总入口。一个平台一个目录；QQ 下面按「接入方式」再分：
//
//   adapters/qq/onebot-v11/      ← 外置协议端（SnowLuma / LLOneBot / NapCat）
//   adapters/qq/qq-guild/        ← QQ 频道（频道机器人 API）
//   adapters/qq/qq-official-bot/ ← QQ 官方机器人（QQ 开放平台 · 群 / 单聊）
//
// 这三种是**完全不同的东西**：协议不同、鉴权不同、能发的消息也不同。
// 所以不能合成一个「QQ 适配器」，只能一个接入方式一个实现，平台名都叫 `qq`，
// 面板里靠 `name` 区分。
//
// 频道与官方机器人共用同一套开放平台基础设施：`access-token.ts`（换 token）、
// `gateway.ts`（WebSocket 网关）、`openapi.ts`（HTTP 调用）。

export { OneBotBot, createOneBotV11Spec } from './qq/onebot-v11/index.ts'
export type { OneBotBotInit, OneBotCall, OneBotV11SpecOptions } from './qq/onebot-v11/index.ts'

export {
  QQGuildBot,
  createQQGuildSpec,
  QQ_GUILD_DEFAULT_INTENTS,
  inboundOf as qqGuildInboundOf,
} from './qq/qq-guild/index.ts'
export type {
  QQGuildBotInit,
  QQGuildSpecOptions,
  QQGuildMessageParams,
  QQGuildCreateDmParams,
  QQGuildDmChannel,
} from './qq/qq-guild/index.ts'

export {
  QQOfficialBot,
  createQQOfficialBotSpec,
  QQ_OFFICIAL_DEFAULT_INTENTS,
  inboundOf as qqOfficialInboundOf,
} from './qq/qq-official-bot/index.ts'
export type {
  QQOfficialBotInit,
  QQOfficialBotSpecOptions,
  QQOfficialMessageParams,
} from './qq/qq-official-bot/index.ts'

export { AccessTokenProvider } from './qq/access-token.ts'
export type { AccessTokenOptions } from './qq/access-token.ts'
export { QQGateway, QQ_OP } from './qq/gateway.ts'
export type { GatewaySocket, GatewaySocketFactory, QQGatewayOptions } from './qq/gateway.ts'
export { QQOpenApi } from './qq/openapi.ts'
export type { QQOpenApiOptions } from './qq/openapi.ts'

export { satoriAdapter, inboundOf as satoriInboundOf } from './satori/index.ts'
export type { SatoriAdapterConfig } from './satori/index.ts'
