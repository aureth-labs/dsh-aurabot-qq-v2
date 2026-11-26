/**
 * 发送目标：所有出站消息最后都落成一个 Target。
 *
 * 适配器、Session、Bot 三处共用这一套结构，谁也别自己发明「发给谁」的写法。
 * 群里发群号、私聊发用户号、频道发频道号，靠 `type` 区分。
 */

export type TargetType = 'group' | 'private' | 'channel'

export interface Target {
  /** 平台名：qq / discord / telegram …… 与 BotLike.platform 同源。 */
  platform: string
  /** 具体哪个机器人实例。同一个平台可以挂多个号。 */
  botId: string
  type: TargetType
  /** 群号 / 用户号 / 频道号，统一存字符串。 */
  id: string
}
