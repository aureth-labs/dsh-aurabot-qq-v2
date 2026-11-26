import { spawn } from 'node:child_process'
import { findFfmpeg } from '../../../src/core/message/media/img.ts'
import { canSeeImages } from '../../../src/core/llm/index.ts'
import type { PluginContext } from '../../../src/types/plugin/ctx.ts'

function grabFrame(ffmpeg, file, at) {
  return new Promise((resolve) => {
    let settled = false
    const chunks = []
    let timer
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }
    let proc
    try {
      proc = spawn(ffmpeg, ['-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true })
    } catch (error) { finish(null); return }
    timer = setTimeout(() => { try { proc.kill() } catch (error) {} finish(null) }, 20_000)
    proc.stdout.on('data', (d) => { if (chunks.reduce((n, b) => n + b.length, 0) < 2 * 1024 * 1024) chunks.push(d) })
    proc.stderr.on('data', () => {})
    proc.on('error', () => finish(null))
    proc.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      finish(code === 0 && buf.length > 500 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null)
    })
  })
}

export function videoReview(ctx: PluginContext) {
  const cfg = () => ctx.root.config
  const v = () => cfg().video || {}
  async function selfView(file, prompt, seconds) {
    if (v().selfView === false) return ''
    try {
      if (canSeeImages && (await canSeeImages(ctx.harness, cfg())) === false) { ctx.logger.debug('当前模型看不了图，跳过自检'); return '' }
      const ffmpeg = findFfmpeg(cfg().local?.ffmpegPath || '')
      if (!ffmpeg) { ctx.logger.debug('没找到 ffmpeg，跳过抽帧'); return '' }
      const d = Math.max(4, Math.round(Number(seconds) || 5))
      const frames = []
      for (const p of [0.2, 0.4, 0.6, 0.8]) {
        const f = await grabFrame(ffmpeg, file, Math.max(0, Math.round(d * p * 10) / 10))
        if (f) frames.push(f)
      }
      if (!frames.length) return ''
      const out = await ctx.ask({
        module: 'video-selfview',
        cfg: cfg(),
        system: '你在看自己刚生成的一段视频的截图。只写画面上确实能看到的东西：场景、主体、动作、光线、色调、画面里的文字。不要猜剧情，不要编造。用 2~4 句中文写。',
        text: `这些截图来自你刚才按这个描述做的视频（${d} 秒）：${prompt}\n按时间先后排列。如实记下你看到了什么。`,
        images: frames.map((f) => ({ data: f.toString('base64'), mediaType: 'image/jpeg' })),
        maxTokens: 500,
        temperature: 0.3,
      })
      return String(out || '').trim()
    } catch (error) {
      ctx.logger.warn('视频自检失败（不影响发送）：', error.message)
      return ''
    }
  }

  /** 把一句话场景扩写成可直接喂视频模型的分镜提示词；失败用原文。 */
  async function enhance(text) {
    if (v().enhance === false) return text
    try {
      const out = await ctx.ask({
        system: '你是视频分镜师。把用户的一句话场景扩写成一段可直接用于文生视频模型的提示词：镜头运动、主体外形与动作、环境与光线、色调与质感，按时间顺序描述，只输出提示词本身，不要解释、不要分点。中文，120 字以内。',
        text,
        maxTokens: 400,
      })
      const s = String(out || '').trim()
      return s.length >= 20 ? s.slice(0, 900) : text
    } catch (error) {
      ctx.logger.debug('提示词扩写失败，用原文：', error.message)
      return text
    }
  }
  return { enhance, selfView }
}
