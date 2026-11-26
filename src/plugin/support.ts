// 宿主层的模块级辅助：开发期后台编译、更新命令执行、端口探测。
// 这些不碰插件闭包，所以从入口文件里拆出来，入口只管装配。

import { existsSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { ROOT } from '../core/support/root.ts'
import { dataDir, ensureDir } from '../core/store/index.ts'

/** 是不是跑在 `node --test` 里（Node 会给子进程设 NODE_TEST_CONTEXT）。 */
export function underTest() {
  if (process.env.NODE_TEST_CONTEXT) return true
  return process.argv.some((arg) => arg === '--test')
}

/**
 * 开发期自动编译：只编前端。
 *
 * 后端（src/**）在 dev 入口下由 Node 直接剥离类型运行，改 .ts 就是改被 import 的文件本身，
 * dsh-hmr 直接热重载，没有任何编译产物参与——所以这里不需要管后端。
 * 前端（client/**）要交给浏览器，只能是 JS，所以后台挂一个 esbuild watch 守着 dist/client.js。
 *
 * - 重复调用无副作用：scripts/dev.mjs 会按 PID 文件判断已在跑就直接退出
 * - 装到插件市场里的包没有 scripts/ 和 node_modules/esbuild，自动跳过
 * - 不想要它：AURABOT_DEV_WATCH=0
 */
export function ensureDevBuild(log) {
  if (process.env.AURABOT_DEV_WATCH === '0') return
  // 测试会并行 import 本模块：每个进程都去起一个编译器，跑一轮就攒下几十个常驻进程。
  // 后台编译只服务于「真在开面板写前端」，测试里一律不起。
  if (underTest()) return
  try {
    const devScript = join(ROOT, 'scripts', 'dev.mjs')
    const esbuildPkg = join(ROOT, 'node_modules', 'esbuild', 'package.json')
    if (!existsSync(devScript) || !existsSync(esbuildPkg)) return
    // 放插件数据目录，不放仓库根：仓库里不该出现运行时留下的垃圾文件
    ensureDir(dataDir())
    const pidFile = dataDir('dev-build.pid')
    const compilerAlive = () => {
      try {
        const pids = readFileSync(pidFile, 'utf8').trim().split(/\s+/).filter(Boolean)
        if (!pids.length) return false
        return pids.every((pid) => { try { process.kill(Number(pid), 0); return true } catch { return false } })
      } catch { return false }
    }
    const startCompiler = () => {
      if (compilerAlive()) return
      try {
        const child = spawn(process.execPath, [devScript], {
          cwd: ROOT,
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
        })
        child.on('error', (error) => log.warn('后台编译没起来：', error.message))
        child.unref()
      } catch (error) {
        log.warn('后台编译没起来：', error.message)
      }
    }
    startCompiler()
    // 编译器被关掉 / 崩了以后没人重启它，前端就静默不更新了。
    // 所以盯着 client/：一改就确认编译器还活着，不在就拉起来（watch 启动时会先全量打一次）。
    if (!globalThis.__aurabotDevWatch) {
      try {
        globalThis.__aurabotDevWatch = watch(join(ROOT, 'client'), { recursive: true, persistent: false }, () => startCompiler())
        globalThis.__aurabotDevWatch.on?.('error', () => { globalThis.__aurabotDevWatch = null })
      } catch (error) {
        log.warn('前端目录监听没起来：', error.message)
      }
    }
  } catch (error) {
    log.warn('后台编译没起来：', error.message)
  }
}

/**
 * 自动更新要在宿主上跑 `dsh plugin add`：
 * - 桌面版：用 DSH 自带的 Electron 可执行文件 + app.asar 里的 cli.js（等价于 dsh.cmd / dsh 脚本）；
 * - 网页版：PATH 里的 dsh（Windows 上 .cmd 要过 shell）。
 */
export function updateExec(env, args) {
  if (env.mode === 'desktop' && env.resourcesPath) {
    const cliJs = join(env.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
    if (existsSync(cliJs)) {
      return { cmd: process.execPath, cmdArgs: [cliJs, ...args], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, shell: false }
    }
  }
  return { cmd: env.cli, cmdArgs: args, env: process.env, shell: process.platform === 'win32' }
}

/** 本机端口有没有人在听（诊断用，别拿它当业务判断）。 */
export function tcpOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      try { socket.destroy() } catch (error) {}
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/** 跑更新命令，收集输出；3 分钟没结束就杀掉。 */
export function runUpdate(cmd, args, env, shell = false) {
  return new Promise<{ ok: boolean; message?: string; output?: string }>((resolve) => {
    let out = ''
    let done = false
    const finish = (value) => { if (!done) { done = true; resolve(value) } }
    let child
    try {
      child = spawn(cmd, args, { env, shell, windowsHide: true })
    } catch (error) {
      return finish({ ok: false, message: '启动更新命令失败：' + error.message })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch (error) {}
      finish({ ok: false, message: '更新超时（3 分钟），可能网络不通', output: out.slice(-4000) })
    }, 180000)
    child.stdout?.on('data', (b) => { out += String(b) })
    child.stderr?.on('data', (b) => { out += String(b) })
    child.on('error', (error) => { clearTimeout(timer); finish({ ok: false, message: '更新失败：' + error.message }) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      finish(code === 0
        ? { ok: true, message: '更新命令跑完了，重启 DSH 生效', output: out.slice(-4000) }
        : { ok: false, message: '更新命令退出码 ' + code, output: out.slice(-4000) })
    })
  })
}

