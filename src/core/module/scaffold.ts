import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PKG, ID_RE, TYPES_SRC, idDir } from './loader.ts'

export function createPlugin(id: string, displayName: string) {
  if (!ID_RE.test(id)) return { ok: false, message: '请输入小写插件名，例如 weather 或 team/weather' }
  const dir = idDir(id)
  if (existsSync(dir)) return { ok: false, message: '插件目录已存在' }
  const name = id.split('/').at(-1)
  const title = String(displayName || name)
  const parent = dirname(dir)
  mkdirSync(parent, { recursive: true })
  const stage = mkdtempSync(join(parent, '.new-'))
  try {
    const manifest = { name, version: '0.1.0', type: 'module', main: './index.ts',
      aurabot: { api: 2, displayName: title, platforms: ['*'], capabilities: [], reloadOnConfig: true } }
    writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    copyFileSync(join(PKG, TYPES_SRC), join(stage, 'aurabot.d.ts'))
    const entry = [
      "import type { Ctx } from './aurabot.js'",
      '',
      'export const name = ' + JSON.stringify(title),
      "export const config = Schema.object({ greeting: Schema.string().default('你好').description('问候语') })",
      '',
      'export function apply(ctx: Ctx, config: { greeting: string }) {',
      '  ctx.command(' + JSON.stringify(name) + ').action(async ({ session }) => {',
      '    await session.send(config.greeting)',
      '  })',
      '}',
      '',
    ].join('\n')
    writeFileSync(join(stage, 'index.ts'), entry)
    renameSync(stage, dir)
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
  }
  return { ok: true, dir, file: join(dir, 'index.ts'), message: '已创建 TypeScript 插件' }
}
