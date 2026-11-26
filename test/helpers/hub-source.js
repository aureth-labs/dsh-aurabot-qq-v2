// hub 已按职责拆成 packages/modules/chat-bridge/qq/ 下的多个文件：断言源码的测试统一从这里取全文，
// 免得每次拆分都要改一遍路径。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../../packages/modules/chat-bridge/qq', import.meta.url))

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

export function hubSource() {
  return walk(DIR).map((file) => readFileSync(file, 'utf8')).join('\n')
}
