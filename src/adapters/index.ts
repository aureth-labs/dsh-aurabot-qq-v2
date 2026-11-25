// 适配器总入口。一个平台一个目录；QQ 下面按「接入方式」再分：
//
//   adapters/qq/onebot-v11/      ← 已实现：外置协议端（SnowLuma / LLOneBot / NapCat）
//   adapters/qq/qq-official-bot/ ← 未实现：QQ 官方机器人（QQ 开放平台，AppID + Token + 回调）
//   adapters/qq/qq-guild/        ← 未实现：QQ 频道（频道机器人 API）
//
// 这三种是**完全不同的东西**：协议不同、鉴权不同、能发的消息也不同。
// 所以不能合成一个「QQ 适配器」，只能一个接入方式一个实现，平台名都叫 `qq`，
// 面板里靠 `name` 区分。

export { OneBotBot, createOneBotV11Spec } from './qq/onebot-v11/index.ts'
export type { OneBotBotInit, OneBotCall, OneBotV11SpecOptions } from './qq/onebot-v11/index.ts'
