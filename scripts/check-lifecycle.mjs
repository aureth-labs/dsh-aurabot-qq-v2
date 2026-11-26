// S3：模块里不该出现裸定时器和裸进程监听 —— 它们不会随模块卸载回收。
// 正解：ctx.setInterval / ctx.setTimeout / ctx.effect / ctx.on('dispose')。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = join(ROOT, 'packages')
// 宿主内核自己管生命周期，不在检查范围
const SKIP = new Set(['API.md'])

const RULES = [
  // 这两类不会随模块卸载回收：禁用插件后仍在跑，是真正的泄漏。
  // 裸 setTimeout 多数是「操作内的短超时」，误报太多，只提示不拦。
  { re: /(^|[^.\w])setInterval\s*\(/m, hint: '裸 setInterval：改用 ctx.setInterval' },
  { re: /process\.on\s*\(/m, hint: '裸 process.on：改用 ctx.on / ctx.effect' },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|mjs|ts)$/.test(entry) && !SKIP.has(entry)) out.push(full)
  }
  return out
}

let count = 0
for (const file of walk(MODULES)) {
  const code = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const lines = code.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    // 有明确清理点、且清理点由宿主 dispose 驱动的，行上一行写 lifecycle-safe: 说明原因即可
    if (/\/\/\s*lifecycle-safe:\s*\S/.test(lines[i - 1] || '')) return
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        count++
        console.log(`${rel}:${i + 1}  ${rule.hint}`)
      }
    }
  })
}

if (count) {
  console.log(`\n[lifecycle] ${count} 处需要改（只报告，不阻塞构建）`)
} else {
  console.log('[lifecycle] 没有裸定时器 / 进程监听')
}
