import { spawn, execFileSync } from 'node:child_process'
import { autoShift, medianF0, pcm16ToFloat, voiceKind } from '../audio/pitch.ts'
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync, copyFileSync, renameSync } from 'node:fs'
import { join, basename, dirname, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../../core/store/index.ts'
import { searchSongs, songUrl, account } from '../source/netease.ts'
import { installLinuxUv } from '../source/linux-uv.ts'
import { SongClipError, validateSongClip, clipCacheParts, clipLabel, clipFade } from '../audio/segment.ts'

import { APPLIO_COMMIT, TORCH_INDEX, TORCH_CPU_INDEX, CN_PYPI, CN_TORCH, CN_PYTHON, shouldUseCnMirror, PREREQS, downloadWithMirror, UV_SOURCES, separatorReady, fetchFile, findFile, ensureReadable, dirSize, defaultRoot, explainInstallError, INSTALL_STEPS, SEPARATOR_FILES, BUNDLED_SEP, separatorLinks, importSeparator, SEPARATOR_LIST, checkRoot, pathsOf } from './install.ts'
import { listVoices, importModels, deleteVoice, pruneCache } from './voice.ts'
import { VOCAL_MIN_DB, mixArgs, rankCandidates, explainSongError, SongDeliveryError, songFailureReason, cutFirstWith } from './audio.ts'
import { run } from './run.ts'

type CreateSongStudioOptions = Partial<Record<'getConfig' | 'log' | 'sendVoiceFile' | 'sendText' | 'say' | 'onSung' | 'local' | 'readPcm' | 'platform' | 'runInstallCommand', any>>
type ConvertSpeechOptions = Partial<Record<'voice' | 'pitch' | 'outDir', any>>

export function createSongStudio({ getConfig, log, sendVoiceFile, sendText, say, onSung, local, readPcm: readPcmInjected, platform = process.platform, runInstallCommand = run } : CreateSongStudioOptions = {}) {
  const cfg = () => getConfig().song
  const linux = platform === 'linux'
  const P = () => pathsOf(cfg().root || defaultRoot(platform), { platform })
  const work = () => dataDir('songs')
  // 确认过没有人声的歌（网易云 id），下次直接跳过，不用再花几分钟分离一遍
  const noVocalFile = () => join(work(), 'no-vocals.json')
  const noVocals = () => readJson(noVocalFile(), () => [])
  const markNoVocals = (id) => { if (id && !noVocals().includes(String(id))) writeJson(noVocalFile(), [...noVocals(), String(id)].slice(-500)) }
  const queue = []
  let current = null // 正在做的翻唱
  let history = [] // 最近做过的 [{at, title, voice, ok, message, file}]
  let install: Record<string, any> = { running: false, step: '', log: [], ok: null, message: '' }
  // 失败提示的节流：同一个聊天 60 秒内只提示一次——连着点几首、同一原因反复失败时不刷屏
  const failNoticed = new Map() // chatId → { at, why }
  const FAIL_NOTICE_GAP = 60_000

  // 光看 shim 文件在不在会骗人：env/Scripts/*.exe 在 Linux 上只是一行「转给真解释器」的脚本，
  // 真解释器（venv）被删了文件还在，一跑就 127。所以真跑一次探针。
  // status 是面板轮询接口，结果缓存 10 秒，免得每个请求都起进程。
  let probe = { at: 0, root: '', python: false, separator: false }
  function probeEnv(p) {
    if (probe.root === p.root && Date.now() - probe.at < 10_000) return probe
    let python = false
    let separator = false
    if (existsSync(p.python)) {
      try {
        // find_spec 只查包在不在，不真 import（audio_separator 会拖 torch，几秒）
        const out = execFileSync(p.python, ['-c', 'import importlib.util as u;print(1 if u.find_spec("audio_separator") else 0)'], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        python = true
        separator = String(out).trim().endsWith('1') && existsSync(p.separatorExe)
      } catch (error) {}
    }
    probe = { at: Date.now(), root: p.root, python, separator }
    return probe
  }

  function status() {
    const p = P()
    const env = probeEnv(p)
    const voices = listVoices(p.models)
    const parts = {
      python: env.python,
      applio: existsSync(join(p.applio, 'core.py')),
      separator: env.separator,
      ffmpeg: existsSync(p.ffmpeg),
      weights: existsSync(p.rmvpe) && existsSync(p.contentvec),
      separatorModel: separatorReady(p.separatorModels, cfg().separatorModel),
    }
    // 换声交给本地脚本时，不需要内置的 Applio / 预训练文件 / 音色模型（下载、分离、混音还是插件做）
    const localSong = Boolean(local?.active('song'))
    const ready = localSong ? ['python', 'separator', 'ffmpeg', 'separatorModel'].every((k) => parts[k]) : Object.values(parts).every(Boolean) && voices.length > 0
    return {
      enabled: cfg().enabled,
      ready,
      root: p.root,
      defaultRoot: defaultRoot(platform),
      rootCheck: checkRoot(p.root, platform),
      pypiMirror: cfg().pypiMirror || 'auto',
      parts,
      voices: voices.map((v) => ({ id: v.id, hasIndex: Boolean(v.index) })),
      separatorLinks: parts.separatorModel ? [] : separatorLinks(cfg().separatorModel),
      voice: cfg().voice,
      install: { ...install, log: install.log.slice(-30) },
      current: current ? { ...current } : null,
      queue: queue.map((q) => ({ query: q.query, chatId: q.chatId, ...(q.clip ? { clip: q.clip } : {}) })),
      history: history.slice(0, 10),
      message: !voices.length ? '还没有音色：在下面「音色模型」里导入你有权使用的 RVC 模型（.pth 或 zip）' : ready ? (cfg().enabled ? '可以点歌了' : '准备好了，打开开关就能用') : '还差一些组件，点「一键安装」',
    }
  }

  // ---------- 一键安装（几个 GB，要十几分钟）----------
  async function runInstall() {
    if (install.running) return { ok: false, message: '已经在装了' }
    let p = P()
    install = { running: true, step: '', stepIndex: -1, steps: INSTALL_STEPS, stepHint: '', stepAt: 0, startedAt: Date.now(), progress: null, log: [], ok: null, message: '' }
    const note = (s) => { install.log.push(s); if (install.log.length > 200) install.log.shift() }
    const step = async (name, hint, fn) => {
      Object.assign(install, { step: name, stepIndex: INSTALL_STEPS.indexOf(name), stepHint: hint, stepAt: Date.now(), progress: null })
      note('▶ ' + name)
      log.info('翻唱安装：' + name)
      await fn()
    }
    // 这次安装的下载缓存放在安装目录里：一来能统计下载了多少（给面板看进度），二来装完删掉不占地方
    const cacheDir = join(p.root, 'uv-cache')
    const cn = await shouldUseCnMirror(cfg().pypiMirror)
    if (cn) note(cfg().pypiMirror === 'cn' ? '用国内镜像下载' : '官方源连得慢，自动改用国内镜像下载')
    const uvEnv = {
      UV_CACHE_DIR: cacheDir,
      UV_HTTP_TIMEOUT: '300',
      UV_HTTP_RETRIES: '6',
      UV_PYTHON_INSTALL_DIR: join(p.root, 'python'), // Python 也装在选的位置里，不偷偷占 C 盘
      ...(cn ? { UV_PYTHON_INSTALL_MIRROR: CN_PYTHON } : {}),
    }
    const mirror = cn ? ['--default-index', CN_PYPI] : []
    let uv = 'uv'
    try {
      mkdirSync(p.root, { recursive: true })
      mkdirSync(p.models, { recursive: true })
      await step('创建 Python 环境', '第一次要下载 Python 3.12（约 30 MB）和安装工具，一般 1~3 分钟', async () => {
        uv = await ensureUv(p, note)
        if (linux ? probeEnv(p).python : existsSync(p.python)) return note('  已经有了，跳过')
        if (linux) p = pathsOf(p.root, { platform, allowLegacy: false })
        const stop = watchDownload(join(p.root, 'python'))
        try {
          const keepExisting = linux ? ['--allow-existing'] : []
          await runInstallCommand(uv, ['venv', '-q', ...keepExisting, join(p.root, 'env'), '--python', '3.12'], { log, onLine: note, env: uvEnv, timeoutMs: 30 * 60_000 })
        } finally {
          stop()
        }
      })
      await step('下载 Applio（RVC 推理引擎）', '要下载几十 MB，一般 1~3 分钟', async () => {
        if (existsSync(join(p.applio, 'core.py'))) return note('  已经有了，跳过')
        // 直接下代码压缩包（固定版本），不需要电脑上装 git
        const zip = join(p.root, 'downloads', 'applio.zip')
        const tmp = join(p.root, 'downloads', 'applio-src')
        const urls = [`https://github.com/IAHispano/Applio/archive/${APPLIO_COMMIT}.zip`, `https://codeload.github.com/IAHispano/Applio/zip/${APPLIO_COMMIT}`]
        const downloadApplio = async () => {
          // 以前中断留下的同名 zip 可能能过 existsSync，但内容不完整；先按 zip 头判断，坏包直接丢掉。
          try {
            if (existsSync(zip) && (!statSync(zip).size || readFileSync(zip).subarray(0, 2).toString() !== 'PK')) rmSync(zip, { force: true })
          } catch { try { rmSync(zip, { force: true }) } catch {} }
          try {
            await fetchFile(p.python, zip, urls, note, log, (done, total) => {
              install.progress = { kind: 'file', name: 'Applio', done, total }
            })
          } catch (error) {
            if (linux) throw error
            note('  换个方式再下一次')
            await fetchWithProgress(urls[0], zip)
          }
        }
        await downloadApplio()
        rmSync(tmp, { recursive: true, force: true })
        try {
          await expandZip(p.python, zip, tmp)
        } catch (error) {
          // 解压失败通常是下载不完整或镜像返回了 HTML，清掉坏包重下一次。
          rmSync(tmp, { recursive: true, force: true })
          rmSync(zip, { force: true })
          note('  压缩包不完整，已清理并重新下载')
          await downloadApplio()
          await expandZip(p.python, zip, tmp)
        }
        const inner = readdirSync(tmp).find((n) => existsSync(join(tmp, n, 'core.py')))
        if (!inner) throw new Error('下载的 Applio 压缩包不完整')
        rmSync(p.applio, { recursive: true, force: true })
        renameSync(join(tmp, inner), p.applio)
        rmSync(join(p.root, 'downloads'), { recursive: true, force: true })
      })
      await step('安装 PyTorch、RVC 和人声分离（最大的一步）', '要下载约 3~4 GB，看网速一般 10~40 分钟；下面的「已下载」在涨就说明没卡住', async () => {
        const stop = watchDownload(cacheDir)
        try {
          const separator = linux ? 'audio-separator[cpu]' : 'audio-separator[gpu]'
          const torch = linux ? ['--extra-index-url', TORCH_CPU_INDEX] : cn ? ['--find-links', CN_TORCH] : ['--extra-index-url', TORCH_INDEX]
          await runInstallCommand(uv, ['pip', 'install', '--python', p.python, '-r', join(p.applio, 'requirements-engine.txt'), separator, 'imageio-ffmpeg',
            ...mirror, ...torch, '--index-strategy', 'unsafe-best-match'], { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
        } finally {
          stop()
        }
      })
      await step('准备 ffmpeg', '几秒钟', async () => setupFfmpeg(p))
      await step('下载 RVC 需要的预训练文件（音高、音色特征）', '约 560 MB，看网速几分钟', async () => {
        for (const [rel, dest, sha] of PREREQS) {
          await downloadWithMirror(p.python, rel, join(p.applio, dest), note, log, (done, total) => {
            install.progress = { kind: 'file', name: rel.split('/').pop(), done, total }
          }, sha)
        }
      })
      await step('下载人声分离模型', '约 640 MB，看网速几分钟；下好以后第一次点歌就不用再等', async () => {
        // 配置文件插件自带，先放进去
        mkdirSync(p.separatorModels, { recursive: true })
        for (const n of readdirSync(BUNDLED_SEP)) if (!existsSync(join(p.separatorModels, n))) copyFileSync(join(BUNDLED_SEP, n), join(p.separatorModels, n))
        const files: Array<[string, string[], string?]> = [...(SEPARATOR_FILES[cfg().separatorModel] || []), SEPARATOR_LIST]
        for (const [name, urls, sha] of files) {
          await fetchFile(p.python, join(p.separatorModels, name), urls, note, log, (done, total) => {
            install.progress = { kind: 'file', name, done, total }
          }, name, sha || '')
        }
      })
      // 下载缓存用完删掉（几个 GB）；环境里的文件是硬链接 / 复制过去的，删缓存不影响
      try { rmSync(cacheDir, { recursive: true, force: true }) } catch (error) {}
      install = { ...install, running: false, ok: true, step: '', progress: null, message: `装好了，用时 ${Math.round((Date.now() - install.startedAt) / 60000)} 分钟` }
      log.info('翻唱环境装好了')
    } catch (error) {
      install = { ...install, running: false, ok: false, progress: null, message: `「${install.step}」这步失败了：${explainInstallError(error.message)}`, error: String(error.message).slice(0, 2000) }
      log.warn('翻唱安装失败：', install.message)
    }
    probe.at = 0
    return { ok: install.ok, message: install.message }
  }

  /**
   * 用 PowerShell 下载一个文件（会走系统代理，不依赖电脑上装了别的工具），下载中显示已下载多少、网速。
   */
  async function fetchWithProgress(url, dest, timeoutSec = 600) {
    mkdirSync(dirname(dest), { recursive: true })
    rmSync(dest, { force: true })
    const stop = watchDownload(dirname(dest))
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $env:AB_URL -OutFile $env:AB_OUT -UseBasicParsing -TimeoutSec $env:AB_TIMEOUT"],
      { log, env: { AB_URL: url, AB_OUT: dest, AB_TIMEOUT: String(timeoutSec) }, timeoutMs: (timeoutSec + 60) * 1000 })
    } finally {
      stop()
    }
    if (!existsSync(dest) || !statSync(dest).size) throw new Error('下载失败：' + url)
  }

  /** Linux 用翻唱环境的 zipfile，Windows 沿用 Expand-Archive。 */
  async function expandZip(python, zip, dir) {
    mkdirSync(dir, { recursive: true })
    if (linux) return runInstallCommand(python, ['-m', 'zipfile', '-e', zip, dir], { log, timeoutMs: 10 * 60_000 })
    await runInstallCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:AB_ZIP -DestinationPath $env:AB_DIR -Force'],
      { log, env: { AB_ZIP: zip, AB_DIR: dir }, timeoutMs: 10 * 60_000 })
  }

  /** 准备 uv（装 Python 和各种包的工具）：电脑上有就用，没有就下一个放进安装目录。 */
  async function ensureUv(p, note) {
    if (process.env.AURABOT_UV) return process.env.AURABOT_UV
    const local = join(p.bin, linux ? 'uv' : 'uv.exe')
    if (existsSync(local)) return local
    try {
      await runInstallCommand('uv', ['--version'], { log, timeoutMs: 15_000 })
      return 'uv'
    } catch (error) {}
    if (linux) {
      const installed = [join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv')].find(existsSync)
      if (installed) return installed
      note('  电脑上没有 uv，下载一个放进安装目录')
      return installLinuxUv(local, { note })
    }
    note('  电脑上没有 uv，下载一个放进安装目录')
    const zip = join(p.root, 'downloads', 'uv.zip')
    const tmp = join(p.root, 'downloads', 'uv')
    let lastError = null
    for (const src of UV_SOURCES) {
      try {
        await fetchWithProgress(src.url, zip, 5 * 60)
        if (src.sha256 && createHash('sha256').update(readFileSync(zip)).digest('hex') !== src.sha256) throw new Error('下载的文件校验对不上')
        rmSync(tmp, { recursive: true, force: true })
        await expandZip(p.python, zip, tmp)
        const exe = findFile(tmp, 'uv.exe')
        if (!exe) throw new Error('里面没找到 uv.exe')
        mkdirSync(p.bin, { recursive: true })
        copyFileSync(exe, local)
        rmSync(join(p.root, 'downloads'), { recursive: true, force: true })
        return local
      } catch (error) {
        lastError = error
        note(`  从 ${new URL(src.url).host} 下 uv 没成功（${error.message.slice(0, 80)}），换一个源`)
      }
    }
    throw new Error('uv 下载失败：' + (lastError?.message || ''))
  }

  /** 每 4 秒统计一次下载缓存有多大，算出已下载多少、网速多少，给面板看。返回停止函数。 */
  function watchDownload(dir) {
    let last = { at: Date.now(), bytes: dirSize(dir) }
    const base = last.bytes
    const t = setInterval(() => {
      const bytes = dirSize(dir)
      const now = Date.now()
      const speed = Math.max(0, (bytes - last.bytes) / ((now - last.at) / 1000))
      install.progress = { kind: 'download', done: bytes - base, speed }
      last = { at: now, bytes }
    }, 4000)
    t.unref?.()
    return () => clearInterval(t)
  }

  /** 把 imageio-ffmpeg 带的程序放到翻唱目录的 bin，供人声分离使用。 */
  async function setupFfmpeg(p) {
    if (existsSync(p.ffmpeg)) return
    const out = await runInstallCommand(p.python, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { log })
    const src = out.trim().split(/\r?\n/).pop()
    mkdirSync(p.bin, { recursive: true })
    copyFileSync(src, p.ffmpeg)
    if (linux) chmodSync(p.ffmpeg, 0o755)
  }

  // ---------- 做一首 ----------
  const pyEnv = () => {
    const p = P()
    return { PATH: p.bin + delimiter + process.env.PATH, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  }

  async function ffprobeDuration(file) {
    // ffmpeg -i 会把时长打在 stderr 里，退出码是 1，这里自己接
    return new Promise((resolve) => {
      const c = spawn(P().ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true })
      let s = ''
      c.stderr.on('data', (b) => { s += b })
      c.on('exit', () => {
        const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
      })
      c.on('error', () => resolve(0))
    })
  }

  /** 用 ffmpeg 离线读整首歌的单声道 PCM（8kHz s16le），给副歌定位用；失败返回 null。 */
  async function readPcm(file, sampleRate = 8000) {
    return new Promise((resolve) => {
      const chunks = []
      let total = 0
      let stderr = ''
      const c = spawn(P().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { windowsHide: true })
      // 分析只是锦上添花：ffmpeg 卡住 30 秒就放弃，按失败回退 30%
      const timer = setTimeout(() => { try { c.kill() } catch (error) {}; resolve(null) }, 30_000)
      c.stdout.on('data', (buf) => {
        // 正常一首歌几分钟也就几 MB；超过 64MB 不收了，避免异常文件把内存吃满
        if (total < 64 * 1024 * 1024) { chunks.push(buf); total += buf.length }
      })
      // 必须消费 stderr：-loglevel error 也可能有输出，不读会把子进程管道塞满卡死
      c.stderr.on('data', (buf) => { stderr = (stderr + buf.toString()).slice(-2000) })
      c.on('error', () => { clearTimeout(timer); resolve(null) })
      c.on('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0 && stderr) log?.debug?.('副歌定位读 PCM 失败：', stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' | '))
        resolve(code === 0 && total ? Buffer.concat(chunks) : null)
      })
    })
  }

  /** 人声轨的平均音量（dB）；纯音乐分出来的人声几乎是静音。 */
  /** 原唱人声的中位基频（#10）：最多分析 90 秒，转成 8 kHz 单声道裸数据交给 YIN；失败返回 null。 */
  async function probeF0(file) {
    return new Promise<number | null>((resolve) => {
      const c = spawn(P().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', '90', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { windowsHide: true })
      const chunks = []
      c.stdout.on('data', (b) => chunks.push(b))
      c.on('exit', (code) => {
        if (code !== 0) return resolve(null)
        try { resolve(medianF0(pcm16ToFloat(Buffer.concat(chunks)), 8000)) } catch (error) { resolve(null) }
      })
      c.on('error', () => resolve(null))
    })
  }

  async function meanVolume(file) {
    return new Promise<number>((resolve) => {
      const c = spawn(P().ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true })
      let s = ''
      c.stderr.on('data', (b) => { s += b })
      c.on('exit', () => { const m = s.match(/mean_volume:\s*(-?[\d.]+|-inf)/); resolve(m ? (m[1] === '-inf' ? -200 : Number(m[1])) : 0) })
      c.on('error', () => resolve(0))
    })
  }

  async function download(job, dir) {
    const c = cfg()
    if (job.songId && noVocals().includes(String(job.songId))) throw new Error('这首没有人声（像是纯音乐或伴奏版），换一首吧')
    let pick: Record<string, any> | null = job.songId ? { id: job.songId, name: job.query, artists: '' } : null
    if (!pick) {
      const found = await searchSongs(job.query, { cookie: c.neteaseCookie, limit: 10 })
      if (!found.length) throw new Error(`网易云上没搜到「${job.query}」`)
      // 试过、确认没人声的跳过；看着像纯音乐的排到最后
      const known = noVocals()
      const list = rankCandidates(found, job.query).filter((s) => !(job.skip || []).includes(String(s.id)) && !known.includes(String(s.id)))
      if (!list.length) throw new Error(`搜到的「${job.query}」都是没有人声的版本`)
      // 按顺序找第一首拿得到完整音频的
      for (const s of list) {
        const u = await songUrl(s.id, { cookie: c.neteaseCookie })
        if (u.url && !u.trial) { pick = { ...s, url: u.url }; break }
      }
      if (!pick) throw new Error(`「${job.query}」要会员或者有版权限制，下载不了${c.neteaseCookie ? '' : '（在面板里填网易云 Cookie 后可以下会员歌）'}`)
    } else {
      const u = await songUrl(pick.id, { cookie: c.neteaseCookie })
      if (!u.url || u.trial) throw new Error('这首歌下载不了（要会员或者有版权限制）')
      pick.url = u.url
    }
    job.title = pick.artists ? `${pick.name} - ${pick.artists}` : pick.name
    job.songKey = String(pick.id)
    const r = await fetch(pick.url, { signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`下载失败（HTTP ${r.status}）`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 60 * 1024 * 1024) throw new Error('歌太大了')
    const file = join(dir, 'song.mp3')
    writeFileSync(file, buf)
    return file
  }

  async function separate(input, dir) {
    const p = P()
    mkdirSync(p.separatorModels, { recursive: true })
    const model = cfg().separatorModel
    await ensureReadable(((SEPARATOR_FILES[model] || [[model, [], '']] as Array<[string, string[], string?]>)).map(([n]) => join(p.separatorModels, n)))
    await run(p.separatorExe, [input, '--model_filename', model, '--model_file_dir', p.separatorModels, '--output_dir', dir, '--output_format', 'WAV'], { log, env: pyEnv(), timeoutMs: 20 * 60_000 })
    const files = readdirSync(dir)
    const vocals = files.find((f) => /\(vocals\)/i.test(f))
    const inst = files.find((f) => /\(instrumental\)/i.test(f) || /\(other\)/i.test(f))
    if (!vocals || !inst) throw new Error('人声分离没产出文件')
    return { vocals: join(dir, vocals), inst: join(dir, inst) }
  }

  async function convert(vocals, dir, voice, pitch) {
    const p = P()
    const out = join(dir, 'vocals_rvc.wav')
    if (local?.active('song')) {
      const { fileOf } = await import('../../local/index.ts')
      const r = await local.call('song', { input: vocals, output: out, pitch, voice: voice?.id || '', voiceFile: voice?.pth || '', indexFile: voice?.index || '' })
      const file = fileOf(r) || out
      if (!existsSync(file)) throw new Error('本地换声脚本没写出文件：' + file)
      return file
    }
    await run(p.python, ['core.py', 'infer', '--input-path', vocals, '--output-path', out, '--pth-path', voice.pth, '--index-path', voice.index || '',
      '--pitch', String(pitch), '--index-rate', voice.index ? '0.5' : '0', '--protect', '0.33', '--f0-method', 'rmvpe', '--export-format', 'WAV'],
    { cwd: p.applio, log, env: pyEnv(), timeoutMs: 20 * 60_000 })
    if (!existsSync(out)) throw new Error('变声没产出文件')
    return out
  }

  /**
   * 语音条变声（给「语音」模块用）：把一段 TTS 音频用翻唱里导入的 RVC 音色模型换成她的声音。
   * 内置 RVC 模式会先用 ffmpeg 把 TTS 输出（常见是 mp3）转成 44.1k 单声道 wav 再换声。
   * @param {string} input 输入音频文件
   * @param {{voice?: string, pitch?: number, outDir?: string}} [opts] voice = models 里的音色 id；pitch = 变调半音
   * @returns {Promise<string>} 变声后的 wav 文件
   */
  async function convertSpeech(input, { voice = '', pitch = 0, outDir = '' } : ConvertSpeechOptions = {}) {
    if (!existsSync(input)) throw new Error('要变声的音频不存在')
    const p = P()
    const voices = listVoices(p.models)
    if (!voices.length) throw new Error('翻唱里还没有导入音色模型：面板「翻唱」页导入 .pth / zip')
    const v = (voice ? voices.find((x) => x.id === voice) : voices.find((x) => x.id === cfg().voice)) || voices[0]
    const dir = outDir || join(work(), 'speech-rvc')
    mkdirSync(dir, { recursive: true })
    let source = input
    if (!local?.active('song')) {
      if (!existsSync(p.python) || !existsSync(join(p.applio, 'core.py')) || !existsSync(p.rmvpe) || !existsSync(p.contentvec)) {
        throw new Error('翻唱环境还没装好：面板「翻唱」页点「一键安装」，装好后再给语音条变声')
      }
      if (existsSync(p.ffmpeg)) {
        const wav = join(dir, 'speech-in.wav')
        await run(p.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-ar', '44100', '-ac', '1', wav], { log })
        if (existsSync(wav)) source = wav
      }
    }
    const n = Math.max(-24, Math.min(24, Math.round(Number(pitch) || 0)))
    return convert(source, dir, v, n)
  }

  async function mix(vocals, inst, dir) {
    const c = cfg()
    const full = join(dir, 'cover.mp3')
    const vol = Math.max(0.2, Math.min(2, Number(c.vocalVolume) || 1))
    const iv = Math.max(0.1, Math.min(2, Number(c.instVolume) || 0.8))
    await run(P().ffmpeg, mixArgs({ vocals, inst, vol, iv, out: full }), { log })
    return full
  }

  /** 先截出要发的那一段再处理：分离和换声都只算这一段，快一倍多。返回 {file, cut, length}。 */
  async function cutFirst(song, dir, clip) {
    const c = cfg()
    const readPcmForAnalysis = typeof readPcmInjected === 'function' ? readPcmInjected : readPcm
    return cutFirstWith({
      song, dir, clip,
      maxSec: Number(c.maxVoiceSec) || 120,
      clipStart: c.clipStart,
      probeDuration: ffprobeDuration,
      readPcm: readPcmForAnalysis,
      run,
      ffmpegPath: P().ffmpeg,
      log,
    })
  }

  /** 截过的段落首尾加淡入淡出，听起来不突兀。 */
  async function fade(mixed, dir, length) {
    const out = join(dir, 'voice.mp3')
    await run(P().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mixed,
      '-af', clipFade(length), '-b:a', '128k', out], { log })
    return out
  }

  async function process1(job) {
    const c = cfg()
    const voice = listVoices(P().models).find((v) => v.id === (job.voice || c.voice)) || listVoices(P().models)[0]
    if (!voice && !local?.active('song')) throw new Error('还没有可用的音色模型')
    // 没指定变调、开着自动定变调时（默认），分离出人声后按原唱男声 / 女声和她的声线定 0 / +12 / -12（#10）
    const manual = Number.isFinite(Number(job.pitch))
    const auto = !manual && c.autoPitch !== false
    let pitch = manual ? Math.max(-24, Math.min(24, Math.round(Number(job.pitch)))) : Number(c.pitch) || 0
    const dir = join(work(), Date.now().toString(36))
    mkdirSync(dir, { recursive: true })
    job.workDir = dir
    current.stage = '下载歌曲'
    const song = job.file || (await download(job, dir))
    current.title = job.title || job.query
    // 同一首歌、同一个音色、音高和截取方式做过的，直接复用
    // v3：副歌定位从固定 30% 改成音频分析，旧缓存（可能截在非副歌处）一律不用
    // v2：0.6.2 起才检查有没有人声，之前缓存的可能是只有伴奏的成品，一律不用
    const key = createHash('md5').update(['v3', job.songKey || song, local?.active('song') ? 'local:' + (voice?.id || '') : voice.id, auto ? `auto:${c.selfVoice === 'male' ? 'male' : 'female'}` : pitch, ...clipCacheParts(job.clip, c), ...(job.acapella ? ['acapella'] : [])].join('|')).digest('hex').slice(0, 16)
    const cached = join(work(), 'cache', key + '.mp3')
    if (existsSync(cached)) {
      log.info(`翻唱：「${job.title}」做过了，直接用缓存`)
      // 自动定的变调记在旁边，复用缓存时照实报出来
      try { const meta = JSON.parse(readFileSync(cached + '.json', 'utf8')); if (Number.isFinite(meta.pitch)) pitch = meta.pitch } catch (error) {}
      return { file: cached, voice: voice?.id, pitch, dir }
    }
    current.stage = '截取要唱的那一段'
    const part = await cutFirst(song, dir, job.clip)
    current.stage = '分离人声和伴奏'
    const { vocals, inst } = await separate(part.file, dir)
    // 纯音乐 / 伴奏版分不出人声：换下一首候选重做，不然发出去只有伴奏
    const vol = await meanVolume(vocals)
    if (vol < VOCAL_MIN_DB) {
      log.info(`翻唱：「${job.title}」几乎没有人声（${vol.toFixed(0)} dB），像是纯音乐`)
      if (!c.keepWork) try { rmSync(dir, { recursive: true, force: true }) } catch (error) {}
      if (job.clip) throw new SongClipError('这段没有检测到人声，可能是前奏或间奏；请换个开始位置或增加时长。')
      // 仅凭一个片段不能认定整首歌没有人声。
      if (!job.file && !part.cut) markNoVocals(job.songKey)
      if (job.file || job.songId) throw new Error('这首没有人声（像是纯音乐或伴奏版），换一首吧')
      job.skip = [...(job.skip || []), job.songKey]
      if (job.skip.length >= 3) throw new Error(`搜到的几版「${job.query}」都没有人声，换个说法试试（比如带上歌手名）`)
      current.stage = '换一版重下'
      return process1(job)
    }
    if (auto) {
      current.stage = '听原唱定变调'
      const f0 = await probeF0(vocals)
      const shift = autoShift(f0, c.selfVoice === 'male' ? 'male' : 'female')
      if (shift !== null) pitch = shift
      log.info(`翻唱：原唱人声中位音高 ${f0 ? Math.round(f0) + ' Hz（' + (voiceKind(f0) === 'male' ? '男声' : '女声') + '）' : '测不出来'}，变调 ${pitch > 0 ? '+' : ''}${pitch}`)
    }
    current.stage = '换成她的声音'
    const converted = await convert(vocals, dir, voice, pitch)
    current.stage = '混音'
    const mixed = await mix(converted, job.acapella ? null : inst, dir)
    const out = part.cut ? await fade(mixed, dir, part.length) : mixed
    mkdirSync(join(work(), 'cache'), { recursive: true })
    copyFileSync(out, cached)
    try { writeFileSync(cached + '.json', JSON.stringify({ pitch, auto })) } catch (error) {}
    pruneCache(join(work(), 'cache'), 40)
    return { file: cached, voice: voice?.id, pitch, dir }
  }

  /** 翻唱失败：让她自己说一句（say 由模块层接模型生成），同一聊天 60 秒内只提示一次。 */
  function noticeFail(job, error, why) {
    const title = job.title || job.query
    const now = Date.now()
    for (const [id, item] of failNoticed) if (now - item.at >= FAIL_NOTICE_GAP) failNoticed.delete(id)
    const last = failNoticed.get(job.chatId)
    if (last && now - last.at < FAIL_NOTICE_GAP) {
      log.info(`翻唱失败提示刚发过（${Math.round((now - last.at) / 1000)} 秒前），这次不重复：「${title}」`)
      return
    }
    failNoticed.set(job.chatId, { at: now, why })
    // 模型那边彻底挂了也得让人听到一句，不能一声不吭；这句只是兜底，不是原来的模板
    const plain = `「${title}」：${songFailureReason(error)}`
    if (!say || error instanceof SongClipError || error instanceof SongDeliveryError) {
      Promise.resolve(sendText?.(job.chatId, plain)).catch(() => {})
      return
    }
    Promise.resolve()
      .then(() => say({ chatId: job.chatId, title, query: job.query, why: songFailureReason(error), error: songFailureReason(error) }))
      .catch((e) => {
        log.warn('翻唱失败提示没说出来，退回一句短的：', e?.message || e)
        Promise.resolve(sendText?.(job.chatId, plain)).catch(() => {})
      })
  }

  async function pump() {
    if (current || !queue.length) return
    const job = queue.shift()
    current = { query: job.query, title: job.query, chatId: job.chatId, stage: '排队', startedAt: Date.now(), ...(job.clip ? { clip: job.clip } : {}) }
    log.info(`翻唱开始：「${job.query}」→ ${job.chatId}`)
    try {
      const r = await process1(job)
      current.stage = '发送'
      const delivery = await sendVoiceFile(job.chatId, r.file, `[${job.acapella ? '清唱' : '翻唱'}] ${job.title || job.query}`)
      // 老的自定义发送回调可不返回值；显式未发出和等待补发不能记成已送达。
      if (delivery === null || delivery === false) throw new SongDeliveryError('翻唱已制作，但语音发送未确认，请先查看目标聊天，避免重复点歌。')
      const queued = delivery?.queued === true
      history.unshift({ at: Date.now(), title: job.title || job.query, voice: r.voice, pitch: r.pitch, ...(job.clip ? { clip: job.clip } : {}), ok: true, ...(queued ? { queued: true } : {}), message: queued ? '已制作并交给补发队列；请在目标聊天确认送达' : `用时 ${Math.round((Date.now() - current.startedAt) / 1000)} 秒` })
      log.info(`翻唱${queued ? '等待补发' : '完成'}：「${job.title || job.query}」`)
      if (!queued) onSung?.(job.title || job.query, job.chatId)
    } catch (error) {
      const why = explainSongError(error.message)
      history.unshift({ at: Date.now(), title: job.title || job.query, ...(job.clip ? { clip: job.clip } : {}), ok: false, message: why })
      log.warn(`翻唱失败：「${job.query}」：`, error.message)
      // 说什么由她自己定：原来那句固定文案对谁、什么原因都一样，听着不像她说的
      noticeFail(job, error, why)
    } finally {
      // 下载、分离、换声或发送失败也释放本次工作文件；不碰原文件和成品缓存。
      try { if (job.workDir && !cfg().keepWork) rmSync(job.workDir, { recursive: true, force: true }) } catch (error) { log.warn('翻唱临时文件未清理：', error.message) }
      history = history.slice(0, 20)
      current = null
      pump()
    }
  }

  /** 点一首：马上返回，做好了自己发到聊天里。 */
  function request(options) {
    try { return enqueue(options) }
    catch (error) {
      log.warn('翻唱点歌未完成：', error?.message || error)
      return { ok: false, message: '点歌未完成，请先查看翻唱面板的任务状态再重试；详细原因已记录在本机日志。' }
    }
  }

  function enqueue({ song, songId, file, pitch, voice, chatId, acapella, startSec, durationSec }) {
    const c = cfg()
    if (!c.enabled) return { ok: false, message: '翻唱还没打开（面板「翻唱」标签里开）' }
    const selection = validateSongClip({ startSec, durationSec }, c.maxVoiceSec)
    if (!selection.ok) return selection
    const st = status()
    if (!st.ready) return { ok: false, message: '翻唱环境还没装好：' + st.message }
    if (!song && !songId && !file) return { ok: false, message: '要说唱哪首歌' }
    if (queue.length >= 5) return { ok: false, message: '排队的歌太多了，等会儿再点' }
    queue.push({ query: song || basename(file || ''), songId, file, pitch, voice, chatId, acapella: Boolean(acapella), clip: selection.clip })
    const ahead = queue.length - 1 + (current ? 1 : 0)
    pump()
    return { ok: true, message: `已接下「${song || basename(file || '')}」${selection.clip ? `（${clipLabel(selection.clip)}）` : ''}${ahead ? `，前面还有 ${ahead} 首` : ''}。制作时间取决于片段长度和电脑性能，做好会发语音。` }
  }

  return {
    status,
    convertSpeech,
    install: () => { runInstall(); return { ok: true, message: '开始安装，要下载好几个 GB，可能要十几分钟' } },
    request,
    search: (q) => searchSongs(q, { cookie: cfg().neteaseCookie, limit: 8 }),
    account: () => account(cfg().neteaseCookie),
    voices: () => listVoices(P().models).map((v) => v.id),
    // .ckpt 是手动下好的人声分离模型，其余是音色
    importModels: (filename, buf) => (/\.ckpt$/i.test(filename) ? importSeparator(P().separatorModels, filename, buf) : importModels(P().models, filename, buf)),
    separatorLinks: () => separatorLinks(cfg().separatorModel),
    deleteVoice: (id) => deleteVoice(P().models, id),
  }
}
