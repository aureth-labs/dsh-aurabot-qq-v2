import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 插件根目录：向上找到最近的 package.json。
 *
 * 开发态是 `<root>/src/core/support/root.ts`，发布态是 `<root>/lib/src/core/support/root.js`，
 * 层级不同，所以不能写死 `..` 的层数。
 */
function findRoot(from: string): string {
  let current = from
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current || current === parse(current).root) return from
    current = parent
  }
}

export const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)))
