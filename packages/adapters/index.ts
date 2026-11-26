// 适配器总入口。一个平台一个目录；QQ 下面按「接入方式」再分：
//
//   packages/adapters/qq/onebot-v11/ ← 外置协议端（SnowLuma / LLOneBot / NapCat）
//   packages/adapters/qq/qq-official/ ← QQ 官方机器人（QQ 开放平台 · 群 / 单聊）
//
// 这两种是**完全不同的东西**：协议不同、鉴权不同、能发的消息也不同。
// 所以不能合成一个「QQ 适配器」，只能一个接入方式一个实现，平台名都叫 `qq`，
// 面板里靠 `name` 区分。
//
// 官方机器人用开放平台那套基础设施：`access-token.ts`（换 token）、
// `gateway.ts`（WebSocket 网关）、`openapi.ts`（HTTP 调用）。

export { OneBotBot, createOneBotV11Spec } from './qq/onebot-v11/src/index.ts'
export type { OneBotBotInit, OneBotCall, OneBotV11SpecOptions } from './qq/onebot-v11/src/index.ts'

export {
  QQOfficialBot,
  createQQOfficialBotSpec,
  QQ_OFFICIAL_DEFAULT_INTENTS,
  inboundOf as qqOfficialInboundOf,
} from './qq/qq-official/src/index.ts'
export type {
  QQOfficialBotInit,
  QQOfficialBotSpecOptions,
  QQOfficialMessageParams,
} from './qq/qq-official/src/index.ts'

export { AccessTokenProvider } from './qq/qq-official/src/common/access-token.ts'
export type { AccessTokenOptions } from './qq/qq-official/src/common/access-token.ts'
export { QQGateway, QQ_OP } from './qq/qq-official/src/common/gateway.ts'
export type { GatewaySocket, GatewaySocketFactory, QQGatewayOptions } from './qq/qq-official/src/common/gateway.ts'
export { QQOpenApi } from './qq/qq-official/src/common/openapi.ts'
export type { QQOpenApiOptions } from './qq/qq-official/src/common/openapi.ts'

export { satoriAdapter, inboundOf as satoriInboundOf } from './satori/src/index.ts'
export type { SatoriAdapterConfig } from './satori/src/index.ts'
