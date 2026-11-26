// 把 client/**/*.ts 打成 dist/client.js 这一个文件。
//
// 为什么必须打成一个文件：宿主的前端是「一个包一个 bundle」的懒 CJS 模块表
// （@deepseek-ai/dsh-client-modules）。浏览器执行到的只是 __ModuleLoader__.load({id, factory})，
// 拆分后的模块靠 bundle 内部的 require 解析，宿主不需要也不可能去 fetch 兄弟文件。
//
// 产物形状和拆分前手写的完全一致，宿主读到的仍是 apply / inject：
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
import { build, buildSync, context } from 'esbuild'
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
  // 默认 charset 是 ascii：中文会被逐字转成 \uXXXX，产物大一截、也没法直接搜。
  // 宿主按 UTF-8 读这个文件，保持原样即可。
  charset: 'utf8',
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

/**
 * 同步版：只返回包装好的文本，不落盘。
 *
 * 给测试用——`node --test` 的用例大量是同步写法，为了读产物把它们全改成 async
 * 只会让断言更难读。esbuild 的 buildSync 开销和异步版一样。
 */
export function bundleClientSync() {
  const result = buildSync({ ...baseOptions, write: false })
  return wrap(result.outputFiles[0].text)
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
