import { clearReasoningCache, clearVisionCache } from '../../../../src/core/llm/index.ts'

export function registerModelRoutes({ http, listModels, generate }) {
  const { route, readBody } = http

  // 模型：列出 DSH 里可用的模型，测一下哪个回得快
  route('/models', async (req) => {
    try {
      if (new URL(req.url, 'http://x').searchParams.get('refresh') === '1') {
        clearReasoningCache()
        clearVisionCache()
      }
      return { ok: true, list: await listModels() }
    } catch (error) {
      return { ok: false, message: error.message, list: [] }
    }
  })
  route('/model/ping', async (req) => {
    const b = await readBody(req)
    const t = Date.now()
    try {
      const text = await generate({
        cfg: { model: { provider: b.provider, model: b.model } },
        module: 'model-ping',
        system: '只回复两个字：在呢',
        text: '在吗',
        maxTokens: 800,
      })
      return { ok: true, ms: Date.now() - t, text: text.slice(0, 40) }
    } catch (error) {
      return { ok: false, ms: Date.now() - t, message: error.message }
    }
  })
}
