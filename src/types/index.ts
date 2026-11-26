/**
 * 框架契约的统一出口。
 *
 * 插件作者只需要 `import type { PluginContext, SessionLike, Element } from 'dsh-aurabot-qq'`，
 * 不用去猜宿主的内部文件结构。
 */

export type { Target, TargetType } from './target.ts'
export type { Element, ElementSource, ElementFactory, OneBotSegment, Selector } from './element.ts'
export type {
  BotLike,
  BotStatus,
  BotEvents,
  BotsAccessor,
  Capability,
  Channel,
  ChannelType,
  Guild,
  GuildMember,
  Message,
  MessageQuery,
  SendOptions,
  User,
} from './bot.ts'
export type { SessionInit, SessionLike } from './session.ts'
export type {
  StageName,
  PipelineConfig,
  PipelineRunner,
  CommandOptions,
  Middleware,
  MiddlewareOptions,
  Next,
  PipelineResult,
  PipelineSession,
  SessionFilter,
  CommandHandler,
  LlmHandler,
} from './pipeline.ts'
export type {
  AdapterHandle,
  AdapterInfo,
  AdapterRuntime,
  AdapterSpec,
  DiscordCreateMessageParams,
  DiscordEmbed,
  InboundMessage,
  OneBotSendMessageParams,
  QQGuildMessageParams,
  QQOfficialMessageParams,
  TelegramMessageEntity,
  TelegramSendMessageParams,
} from './adapter.ts'
export type {
  ApiLike,
  BotAccessor,
  BroadcastResult,
  CommandActionContext,
  CommandArg,
  CommandBuilder,
  LlmFacade,
  LlmSummaryOptions,
  LlmTextOptions,
  PipelineLike,
  PluginContext,
  PluginContextExtras,
  RouteHandler,
  ScopeFactory,
  ServerFacade,
  TtsFacade,
} from './ctx.ts'
export type {
  MemoryAssocMap,
  MemoryFollowUp,
  MemoryGist,
  MemoryInput,
  MemoryItem,
  MemoryMeta,
  MemoryStar,
  MemoryState,
  VectorIndex,
} from './memory.ts'
