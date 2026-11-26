// 构建：src/** -> lib/**（tsc 逐文件），client/** -> dist/client.js（esbuild 单文件 bundle）
// 产物里不留注释，源码里保留。
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleClient } from './bundle-client.mjs'
import { bundleSdk } from './bundle-sdk.mjs'
import { bundleAdapters } from './bundle-adapters.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 运行时资产：编译产物里也要有一份（内置模块模板 .mjs、翻唱下载脚本 .py、类型声明 .d.ts）。
const COPY_EXT = new Set(['.json', '.yml', '.yaml', '.md', '.txt', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.wav', '.mp3', '.py', '.mjs'])
const isDecl = (name) => name.endsWith('.d.ts')

function tsc(project, outDir) {
  const bin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  const result = spawnSync(process.execPath, [bin, '-p', project, '--outDir', outDir], { cwd: ROOT, stdio: 'inherit' })
  // noEmitOnError:false：类型没过也照样出包（插件要能跑），类型门禁交给 `npm run check`。
  if (result.error) {
    console.error('[build] tsc 起不来：', result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) console.warn(`[build] ${project} 有类型错误，产物已生成；跑 npm run check 看明细`)
}

function copyAssets(from, to) {
  if (!existsSync(from)) return
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    const dst = join(to, entry)
    const stat = statSync(src)
    if (stat.isDirectory()) {
      copyAssets(src, dst)
      continue
    }
    if (!isDecl(entry) && !COPY_EXT.has(extname(entry).toLowerCase())) continue
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
  }
}

// 先编到临时目录，成功后再**原地覆盖**旧产物：
// - 编译失败不会把正在跑的 lib 打空
// - 不整目录删除重建：dsh-hmr 只认 chokidar 的 change 事件，删除+新增（unlink/add）它不重载
const STAGE = { lib: join(ROOT, '.build', 'lib'), dist: join(ROOT, '.build', 'dist') }
rmSync(join(ROOT, '.build'), { recursive: true, force: true })
mkdirSync(STAGE.lib, { recursive: true })
mkdirSync(STAGE.dist, { recursive: true })

tsc('tsconfig.json', STAGE.lib)
// 插件作者要的类型声明：只出 src/types 这一层（见 tsconfig.types.json）
tsc('tsconfig.types.json', STAGE.lib)
await bundleClient(join(STAGE.dist, 'client.js'))
await build({
  entryPoints: ['packages/modules/sandbox/web/chat.ts'], outfile: join(STAGE.lib, 'packages/modules/sandbox/web/chat.js'),
  format: 'esm', platform: 'browser', target: 'es2022', bundle: true, charset: 'utf8', legalComments: 'none',
})
await bundleAdapters(ROOT, join(STAGE.dist, 'adapters'))
await bundleSdk(ROOT, join(STAGE.dist, 'sdk'))

copyAssets(join(ROOT, 'src'), join(STAGE.lib, 'src'))
copyAssets(join(ROOT, 'packages'), join(STAGE.lib, 'packages'))
copyAssets(join(ROOT, 'client'), STAGE.dist)

/** 把 stage 里的文件逐个覆盖到 target，再删掉 target 里已经没有的旧文件。 */
function syncDir(stage, target) {
  const keep = new Set()
  const walk = (from, to) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name)
      const dst = join(to, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true })
        walk(src, dst)
        continue
      }
      keep.add(dst)
      // 用 copyFileSync 逐文件覆盖：cpSync 在 Windows 上覆盖已有文件会抛 unlink 错误
      copyFileSync(src, dst)
    }
  }
  if (existsSync(stage)) walk(stage, target)
  // 旧的产物文件（这次没再生成的）删掉，避免残留的模块还在被 import
  const prune = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        prune(path)
        try { if (!readdirSync(path).length) rmSync(path, { recursive: true, force: true }) } catch {}
      } else if (!keep.has(path)) {
        rmSync(path, { force: true })
      }
    }
  }
  mkdirSync(target, { recursive: true })
  prune(target)
}

syncDir(STAGE.lib, join(ROOT, 'lib'))
syncDir(STAGE.dist, join(ROOT, 'dist'))
rmSync(join(ROOT, '.build'), { recursive: true, force: true })

// 让 dsh-hmr 一定会看到一次 change：整目录新增的文件它不重载，入口自己写一遍就行。
// （dev 下 tsc -w 的写盘本来就会触发；这条是给「手动 npm run build」兜底的）
const entry = join(ROOT, 'index.mjs')
try { writeFileSync(entry, readFileSync(entry)) } catch {}

console.log('[build] src -> lib, client -> dist 完成')
