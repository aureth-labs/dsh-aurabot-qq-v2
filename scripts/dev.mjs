// 开发期后台编译：只编前端（client/**/*.ts -> dist/client.js），用 esbuild 增量 watch。
//
// 后端不需要编译：dev 入口直接 import src/ 里的 .ts，Node 原生剥离类型，
// dsh-hmr 跟的是源码本身，保存即热重载。只有浏览器侧必须是 JS，所以这里守一条 esbuild watch。
//
// 以前这里是 `tsc -w -p tsconfig.client.json`，而那份配置是 noEmit: true——
// 于是编译链空转：文件不产出，面板改动永远看不到。前端真正的打包器是
// scripts/bundle-client.mjs（esbuild 单文件 bundle），dev 期必须跟它用同一条链。
//
// 并发保护：host.ts 的目录监听一次保存会触发好几次 startCompiler，测试并发 import 更凶。
// 没有锁的时候每触发一次就起一个编译器，孤儿进程攒到几十个，机器直接被拖垮。
// 现在用独占锁文件，抢不到就说明别人正在起，直接退出。
import { closeSync, openSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 和 host.ts 用同一个位置：插件数据目录，不往仓库根写运行时文件
const DATA_DIR = process.env.AURABOT_DATA_DIR || join(homedir(), '.dsh', 'plugins-data', 'aurabot')
const PID_FILE = join(DATA_DIR, 'dev-build.pid')
const LOCK_FILE = join(DATA_DIR, 'dev-build.lock')
const OUT_FILE = join(ROOT, 'dist', 'client.js')

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
    return readFileSync(PID_FILE, 'utf8')
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter(Boolean)
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

function writePidFile(pids) {
  try {
    if (pids.length) writeFileSync(PID_FILE, pids.join(' '), 'utf8')
    else rmSync(PID_FILE, { force: true })
  } catch {
    // 写不进去不致命：下次启动会先清掉旧 PID 文件
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
rmSync(PID_FILE, { force: true })

// 打成插件市场包时没有 node_modules：拿不到 esbuild 就安静退出，不影响插件运行
let watchClient
try {
  ;({ watchClient } = await import('./bundle-client.mjs'))
} catch (error) {
  releaseLock()
  console.error('[dev] 前端打包器加载失败：' + error.message)
  process.exit(1)
}

let context
try {
  context = await watchClient(OUT_FILE, (size) => {
    console.log(`[dev] dist/client.js 已更新（${size} 字节）`)
  })
} catch (error) {
  releaseLock()
  console.error('[dev] 前端 watch 没起来：' + error.message)
  process.exit(1)
}

writePidFile([process.pid])
releaseLock()
console.log('[dev] 已启动后台编译：client -> dist（后端走 dev 入口，直接跑 src 里的 TS）')

async function stop() {
  try {
    await context.dispose()
  } catch {
    // 已经关掉就算了
  }
  writePidFile([])
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
