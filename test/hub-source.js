// hub 已按职责拆成 src/chat/hub/ 下的多个文件：断言源码的测试统一从这里取全文，
// 免得每次拆分都要改一遍路径。
import { readFileSync, readdirSync } from 'node:fs'

const DIR = new URL('../src/chat/hub/', import.meta.url)

export function hubSource() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(new URL(f, DIR), 'utf8'))
    .join('\n')
}
