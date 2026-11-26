import { open } from 'node:fs/promises'
import { h } from '../../../src/core/message/element/element.ts'
import { mimeOf } from '../../../src/core/message/media/inspect.ts'
import type { GenerateVideoOptions, PluginContext } from '../../../src/types/plugin/ctx.ts'
import { customGenerate, minimaxGenerate, videoFile, videoReady } from './providers.ts'

export function videoService(ctx: PluginContext) {
  const local = ctx.host.local
  const lifetime = new AbortController()
  ctx.effect(() => lifetime.abort())
  let busy = false
  const ready = () => !lifetime.signal.aborted && videoReady(ctx.root.config, local)
  async function generate(prompt: string, options: GenerateVideoOptions = {}) {
    if (!ready() || !prompt.trim()) throw Error('视频服务未就绪或缺少提示词')
    if (busy) throw Error('上一段视频仍在生成')
    busy = true
    try {
      const cfg = ctx.root.config
      const frame = options.firstFrame && Buffer.from(options.firstFrame)
      const mime = frame && mimeOf(frame)
      if (frame && !mime?.startsWith('image/')) throw Error('首帧需要图片')
      const args = { prompt, seconds: Math.max(4, Math.min(15, Math.round(Number(options.seconds) || 5))),
        image: frame ? 'data:' + mime + ';base64,' + frame.toString('base64') : '' }
      const remote = { ...args, cfg, log: ctx.logger, timeoutMs: Math.max(1, Number(cfg.local?.videoTimeoutMin) || 20) * 60000, signal: lifetime.signal }
      const provider = cfg.video?.provider
      const file = provider === 'minimax' ? await minimaxGenerate(remote) :
        provider === 'custom' ? await customGenerate(remote) : videoFile(await local.call('video', args))
      lifetime.signal.throwIfAborted()
      if (!file) throw Error('没有收到视频文件')
      const handle = await open(file, 'r')
      try {
        const stat = await handle.stat()
        const limit = Math.max(1, Number(cfg.files?.maxMB) || 50) * 1048576
        if (!stat.isFile() || !stat.size || stat.size > limit) throw Error('视频文件为空或超过发送上限')
        const bytes = Buffer.alloc(stat.size)
        let offset = 0
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
          if (!bytesRead) throw Error('读取视频时文件已改变')
          offset += bytesRead
        }
        lifetime.signal.throwIfAborted()
        if (bytes.toString('ascii', 4, 8) !== 'ftyp') throw Error('生成结果不是 MP4 视频')
        return { file, element: h.video('data:video/mp4;base64,' + bytes.toString('base64')) }
      } finally { await handle.close() }
    } finally { busy = false }
  }
  ctx.provide('generateVideo', { generate: async (prompt: string, options?: GenerateVideoOptions) => (await generate(prompt, options)).element })
  return { ready, generate, busy: () => busy }
}
