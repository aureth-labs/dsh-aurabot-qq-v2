// 启动 DeepSeek Harness，并决定插件用哪种形态跑。
//
//   pnpm run dev    开发模式：AURABOT_DEV=1 → 插件入口换成 dev.mjs（直接跑 src/**/*.ts），
//                   同时起前端 esbuild watch。改 .ts 保存即热重载，没有 lib/ 参与。
//   pnpm run start  生产模式：AURABOT_DEV=0 → index.mjs → lib/（编译产物），和用户装的包一样。
//
// DSH 可执行文件按这个顺序找：DSH_BIN → 环境变量 DSH_HOME 下的 @deepseek-ai/dsh → PATH 里的 dsh。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const mode = process.argv[2] === 'start' ? 'start' : 'dev'
const port = process.env.DSH_PORT || '8787'
const dev = mode === 'dev'

function resolveBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const homes = [process.env.DSH_HOME, join(homedir(), 'AppData', 'Local', 'Programs'), 'D:/software_apps/DeepSeekharness/dsh'].filter(Boolean)
  for (const home of homes) {
    const hit = join(home, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(hit)) return hit
  }
  throw new Error('找不到 DSH：设置 DSH_BIN=<.../@deepseek-ai/dsh/lib/bin.js>，或把 dsh 加进 PATH')
}

const bin = resolveBin()
const env = { ...process.env, AURABOT_DEV: dev ? '1' : '0' }

const children = []
const run = (args) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env })
  children.push(child)
  return child
}

if (dev) run([join(import.meta.dirname, 'dev.mjs')]) // 前端增量编译
const args = [bin, '--profile', 'web']
if (dev) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-hmr-'))
  const patch = join(dir, 'hmr.yml')
  const base = pathToFileURL(join(import.meta.dirname, '..') + '/').href
  writeFileSync(patch, JSON.stringify([{ id: 'hmr', disabled: false, config: { base, root: ['src', 'packages', 'dev.mjs'] } }]))
  args.push('--patch', patch)
  process.once('exit', () => { try { unlinkSync(patch); rmdirSync(dir) } catch {} })
}
const dsh = run([...args, '--no-open', '--port', port])

console.log(`[dsh] ${dev ? '开发' : '生产'}模式 → 插件入口 ${dev ? 'packages/app/index.ts' : 'lib/'} ，端口 ${port}`)

const stop = () => children.forEach((c) => { try { c.kill() } catch {} })
process.on('SIGINT', () => { stop(); process.exit(0) })
process.on('SIGTERM', () => { stop(); process.exit(0) })
dsh.on('exit', (code) => { stop(); process.exit(code ?? 0) })
