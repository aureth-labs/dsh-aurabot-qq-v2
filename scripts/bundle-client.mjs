// 把 client/**/*.ts 打成 dist/client.js 这一个文件。
//
// 为什么必须打成一个文件：宿主的前端是「一个包一个 bundle」的懒 CJS 模块表
// （@deepseek-ai/dsh-client-modules）。浏览器执行到的只是 __ModuleLoader__.load({id, factory})，
// 拆分后的模块靠 bundle 内部的 require 解析，宿主不需要也不可能去 fetch 兄弟文件。
//
// 产物形状和拆分前手写的完全一致，宿主读到的仍是 apply / inject：
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
import { build, context } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PANEL_ID = 'dsh-aurabot-qq'

function wrap(code) {
  return `window.__ModuleLoader__.load({
  id: '${PANEL_ID}',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
${code}
    return module.exports
  },
})
`
}

const baseOptions = {
  entryPoints: [join(ROOT, 'client', 'index.ts')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // 宿主把 react 注入成外部依赖（package.json 的 dsh.client.external）
  external: ['react'],
  // 产物里不留注释；源码里该说的都说过了
  minify: false,
  legalComments: 'none',
  logLevel: 'silent',
}

export async function bundleClient(outFile) {
  const result = await build({ ...baseOptions, outfile: outFile })
  const text = result.outputFiles[0].text
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, wrap(text), 'utf8')
  return text.length
}

/** 开发期用：只监听、不阻塞，保存 client 下的 .ts 就重打 dist/client.js。 */
export async function watchClient(outFile, onBuild) {
  const ctx = await context({
    ...baseOptions,
    outfile: outFile,
    plugins: [
      {
        name: 'wrap-module-loader',
        setup(pluginBuild) {
          pluginBuild.onEnd(async (result) => {
            if (result.errors.length) return
            const text = result.outputFiles?.[0]?.text
            if (!text) return
            const { writeFile, mkdir } = await import('node:fs/promises')
            await mkdir(dirname(outFile), { recursive: true })
            await writeFile(outFile, wrap(text), 'utf8')
            onBuild?.(text.length)
          })
        },
      },
    ],
  })
  await ctx.watch()
  return ctx
}
