// 内置插件：日志。内存环给面板实时看，按天写的文件在这里列出来、按需读末尾。
import { config } from './config.ts'

export default {
  id: 'logger',
  name: '日志',
  version: '2.0.0',
  description: '运行日志：内存最近 500 条 + 数据目录 logs/ 下的按天文件',
  ...config,
  apply(ctx, config) {
    const store = () => ctx.host.logger
    ctx.server.get('/logs/files', async () => ({
      ok: true,
      dir: store().dir(),
      files: store().files(),
    }))
    ctx.server.get('/logs/tail', async (req) => {
      const url = new URL(String(req.url || '/'), 'http://x')
      const name = url.searchParams.get('name') || ''
      const limit = Number(url.searchParams.get('limit')) || Number(ctx.config.pageSize) || 300
      try {
        return { ok: true, name, lines: store().tail(name, limit) }
      } catch (error) {
        return { ok: false, message: String(error?.message || error) }
      }
    })
    return {
      recent: (limit, filter) => store().recent(limit, filter),
      files: () => store().files(),
      tail: (name, limit) => store().tail(name, limit),
    }
  },
}
