// 面板源码文本：把 client/**/*.ts 按路径顺序拼成一份，给「接线还在不在」这类契约断言用。
//
// 以前这些测试读的是单文件 client/client.js。面板拆成 TS 之后那份巨无霸不再更新，
// 断言就变成在测一份过期副本（改坏了也是绿的）。这里统一指向真源码。
//
// 要跑行为（渲染、纯函数）不要用这份文本，用 ./client-bundle.js 加载真产物。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_DIR = fileURLToPath(new URL('../../client', import.meta.url))

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

let cached = null

/** 全部前端 TS 源码拼成的文本（同一进程内只读一次盘）。 */
export function readClientSource() {
  if (cached === null) {
    cached = walk(CLIENT_DIR)
      .sort()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
  }
  return cached
}

/** 单个前端源文件，给需要精确切片的用例用。 */
export function readClientFile(relativePath) {
  return readFileSync(join(CLIENT_DIR, relativePath), 'utf8')
}
