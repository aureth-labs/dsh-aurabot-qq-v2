// 让「按 NodeNext 写的 .js 后缀」能落到源码里的 .ts 文件上。
// 用途：开发期直接把 src 当模块加载（不产出 JS），以及测试直接 import 源码。
// 只在目标 .js 不存在、同名 .ts 存在时才重写，不会影响正常发布包。
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let installed = false

export function install() {
  if (installed) return
  installed = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.startsWith('file:') &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js')
      ) {
        try {
          const url = new URL(specifier, context.parentURL)
          const tsUrl = new URL(url.href.slice(0, -'.js'.length) + '.ts')
          if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(tsUrl))) {
            return nextResolve(tsUrl.href, context)
          }
        } catch {
          // 解析失败就交回默认逻辑
        }
      }
      return nextResolve(specifier, context)
    },
  })
}

install()
