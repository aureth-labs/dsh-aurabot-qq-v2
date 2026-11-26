// 开发期后台编译：只编前端（client -> dist），重复调用不会重复起进程。
//
// 后端不需要编译：dev.mjs 直接 import src/ 里的 .ts，Node 原生剥离类型，
// dsh-hmr 跟的是源码本身，保存即热重载。只有浏览器侧必须有 JS，所以留一条 tsc -w。
// 并发保护：host.ts 的目录监听一次保存会触发好几次 startCompiler，测试并发 import 更凶。
// 没有锁的时候每触发一次就起一个 tsc -w，孤儿进程攒到几十个，机器直接被拖垮。
// 现在用独占锁文件，抢不到就说明别人正在起，直接退出。
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 和 host.ts 用同一个位置：插件数据目录，不往仓库根写运行时文件
const DATA_DIR = process.env.AURABOT_DATA_DIR || join(homedir(), '.dsh', 'plugins-data', 'aurabot')
const PID_FILE = join(DATA_DIR, 'dev-build.pid')
const LOCK_FILE = join(DATA_DIR, 'dev-build.lock')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runningPids() {
  try {
    return readFileSync(PID_FILE, 'utf8').trim().split(/\s+/).map(Number).filter(Boolean)
  } catch {
    return []
  }
}

/** 锁文件里记的是「正在启动的那个 dev.mjs」的 pid；它死了就当锁是残留，可以抢。 */
function lockHeldByOther() {
  try {
    const pid = Number(readFileSync(LOCK_FILE, 'utf8').trim())
    return pid > 0 && pid !== process.pid && alive(pid)
  } catch {
    return false
  }
}

mkdirSync(DATA_DIR, { recursive: true })

// 1) 已经在跑：什么都不做
const existing = runningPids()
if (existing.length && existing.every(alive)) {
  console.log(`[dev] 后台编译已在运行 (pid ${existing.join(', ')})`)
  process.exit(0)
}

// 2) 别人正在启动：交给它，别抢
if (lockHeldByOther()) {
  console.log('[dev] 另一个实例正在启动后台编译，交给它')
  process.exit(0)
}

// 3) 抢锁（O_EXCL）。抢不到就是真并发，退出即可
let lockFd
try {
  rmSync(LOCK_FILE, { force: true })
  lockFd = openSync(LOCK_FILE, 'wx')
  writeFileSync(lockFd, String(process.pid))
} catch {
  console.log('[dev] 抢锁失败，另一个实例已经在起了')
  process.exit(0)
}

function releaseLock() {
  try {
    closeSync(lockFd)
  } catch {
    // 已经关了就算了
  }
  try {
    rmSync(LOCK_FILE, { force: true })
  } catch {
    // 删不掉也不致命：下次启动会按 pid 判残留
  }
}

// 旧 PID 文件先清掉：里面记的可能是已经死掉的编译器，留着会误判「还活着」
try {
  rmSync(PID_FILE, { force: true })
} catch {
  // 没有就算了
}

const bin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const children = ['tsconfig.client.json'].map((project) =>
  spawn(process.execPath, [bin, '-w', '-p', project, '--preserveWatchOutput'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  }),
)

const started = []
for (const child of children) {
  child.on('error', (error) => console.error('[dev] 后台编译没起来：' + error.message))
  // 编译器自己退了就把它从 PID 文件里划掉，免得下次误判「还活着」
  child.on('exit', () => {
    const rest = runningPids().filter((pid) => pid !== child.pid)
    try {
      if (rest.length) writeFileSync(PID_FILE, rest.join(' '), 'utf8')
      else rmSync(PID_FILE, { force: true })
    } catch {
      // 写不进去也不影响下一次启动（它会清掉旧 PID 文件）
    }
  })
  child.unref()
  if (child.pid) started.push(child.pid)
}

if (started.length) writeFileSync(PID_FILE, started.join(' '), 'utf8')
releaseLock()
console.log('[dev] 已启动后台编译：client -> dist（后端走 dev 入口，直接跑 src 里的 TS）')
