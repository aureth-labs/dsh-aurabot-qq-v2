// 开发期后台编译：只编前端（client -> dist），重复调用不会重复起进程。
//
// 后端不需要编译：dev.mjs 直接 import src/ 里的 .ts，Node 原生剥离类型，
// dsh-hmr 跟的是源码本身，保存即热重载。只有浏览器侧必须有 JS，所以留一条 tsc -w。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 和 host.ts 用同一个位置：插件数据目录，不往仓库根写运行时文件
const DATA_DIR = process.env.AURABOT_DATA_DIR || join(homedir(), '.dsh', 'plugins-data', 'aurabot')
const PID_FILE = join(DATA_DIR, 'dev-build.pid')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

if (existsSync(PID_FILE)) {
  const pids = readFileSync(PID_FILE, 'utf8').trim().split(/\s+/).map(Number).filter(Boolean)
  if (pids.length && pids.every(alive)) {
    console.log(`[dev] 后台编译已在运行 (pid ${pids.join(', ')})`)
    process.exit(0)
  }
}

mkdirSync(DATA_DIR, { recursive: true })

const bin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const children = ['tsconfig.client.json'].map((project) =>
  spawn(process.execPath, [bin, '-w', '-p', project, '--preserveWatchOutput'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  }),
)

for (const child of children) {
  child.unref()
}

writeFileSync(PID_FILE, children.map((child) => child.pid).join(' '), 'utf8')
console.log('[dev] 已启动后台编译：client -> dist（后端走 dev 入口，直接跑 src 里的 TS）')
