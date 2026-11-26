import type { PluginContext } from '../../../src/types/plugin/ctx.ts'
import { videoService } from './service.ts'
import { registerVideoTool } from './tool.ts'
import { videoReview } from './review.ts'

export { videoFile, videoReady, minimaxBody, clampResolution, customRequestParts, fillUrl, fillJson, dotted, parseHeaders, MINIMAX_MODELS, RATIOS, RESOLUTIONS } from './providers.ts'
export const name = '生视频'
export const version = '2.0.0'
export const description = '生成视频，按当前会话确认并投递'

export function apply(ctx: PluginContext) {
  registerVideoTool(ctx, videoService(ctx), videoReview(ctx))
}
