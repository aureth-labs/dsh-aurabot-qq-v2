import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, statfsSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename, dirname, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

import { run } from './run.ts'

type PathsOfOptions = Partial<Record<'platform' | 'allowLegacy', any>>

export const APPLIO_REPO = 'https://github.com/IAHispano/Applio.git'
export const APPLIO_COMMIT = 'c817f1f83f689ef72e0dfeb1c17ae990b9248506'
export const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
export const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu'
// 国内镜像：PyPI 和 PyTorch 都用阿里云（PyTorch 那边是文件列表，用 --find-links；Applio 固定了 torch 版本，挑得到 cu128 的），Python 本体用 npmmirror
export const CN_PYPI = 'https://mirrors.aliyun.com/pypi/simple'
export const CN_TORCH = 'https://mirrors.aliyun.com/pytorch-wheels/cu128/'
export const CN_PYTHON = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

/** 自动模式下判断要不要用国内镜像：官方源 4 秒内连不上或者很慢就用。 */
export async function shouldUseCnMirror(mode, fetchImpl = fetch) {
  if (mode === 'cn' || mode === 'tuna') return true
  if (mode === 'off') return false
  const probe = async (url) => {
    const t = Date.now()
    try {
      const r = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
      return r.status < 500 ? Date.now() - t : Infinity
    } catch (error) {
      return Infinity
    }
  }
  const times = await Promise.all([probe('https://pypi.org/simple/pip/'), probe(TORCH_INDEX + '/torch/'), probe('https://github.com/')])
  return times.some((t) => t > 2500)
}
const LEGACY_ROOT = 'C:\\Aurabot\\rvc'

// RVC 推理要的预训练文件（Applio 放在 HuggingFace 上）：[远端相对路径, 本地相对 Applio 的路径, sha256]
// 带上校验值：下完核对，镜像给错文件会换源；证书校验失败时也能安全地改用不校验证书的连接重下（#3）
export const PREREQS = [
  ['predictors/rmvpe.pt', 'rvc/models/predictors/rmvpe.pt', '6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193'],
  ['embedders/contentvec/config.json', 'rvc/models/embedders/contentvec/config.json', '2ddde063b795d38d9051a7215a092fecf4cfe148b54251e38de51d88d356898b'],
  ['embedders/contentvec/pytorch_model.bin', 'rvc/models/embedders/contentvec/pytorch_model.bin', 'd8dd400e054ddf4e6be75dab5a2549db748cc99e756a097c496c099f65a4854e'],
]
// 国内直连 HuggingFace 常常很慢：先试镜像，太慢或卡住再换官方
const HF_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']

const FETCH_SCRIPT = fileURLToPath(new URL('./fetch_file.py', import.meta.url))

/**
 * 下载一个预训练文件：已经有了就跳过。用翻唱环境里的 Python 下（会走系统代理），
 * 断了从断点接着下，卡住 30 秒就换下一个源，几轮都不行才算失败。
 */
export async function downloadWithMirror(python, rel, dest, note, log, onProgress, sha256 = '') {
  return fetchFile(python, dest, HF_HOSTS.map((host) => `${host}/IAHispano/Applio/resolve/main/Resources/${rel}`), note, log, onProgress, rel, sha256)
}

// uv 的下载源：PyPI 上的 uv 安装包（固定版本，里面带 uv.exe）走国内镜像，最后才试 GitHub。
const UV_WHEEL = 'packages/32/ea/771744a784b16aa21d195cb5d5d5a2878d72fa00fc26f11ea3f9646994fe/uv-0.13.5-py3-none-win_amd64.whl'
export const UV_SOURCES = [
  { url: `https://mirrors.aliyun.com/pypi/${UV_WHEEL}`, sha256: '1fb29fc46ba12033e2ef95a95ac79d649e71bbb1358419bbbcbd19d86026ef2f' },
  { url: `https://files.pythonhosted.org/${UV_WHEEL}`, sha256: '1fb29fc46ba12033e2ef95a95ac79d649e71bbb1358419bbbcbd19d86026ef2f' },
  { url: 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' },
]

/** 在目录里（含子目录）找一个文件名。 */
export function findFile(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let names
    try { names = readdirSync(d, { withFileTypes: true }) } catch (error) { continue }
    for (const e of names) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name.toLowerCase() === name) return full
    }
  }
  return ''
}

/** 默认分离模型的文件都在不在。 */
export function separatorReady(dir, model) {
  const files = SEPARATOR_FILES[model]
  if (!files) return existsSync(join(dir, model))
  return files.every(([name]) => existsSync(join(dir, name)) && statSync(join(dir, name)).size > 0)
}

/** 下载一个文件：已经有了就跳过；地址按顺序轮流试，断了接着下，走系统代理。 */
export async function fetchFile(python, dest, urls, note, log, onProgress, label = basename(dest), sha256 = '') {
  const rel = label
  if (existsSync(dest) && statSync(dest).size > 0) return
  // 上次没下完的（.download）会接着下
  const part = dest + '.download'
  note?.(existsSync(part) ? `接着下 ${rel}（上次下到 ${Math.round(statSync(part).size / 1048576)} MB）` : `下载 ${rel}`)
  let lastPct = -1
  await run(python, [FETCH_SCRIPT, ...(sha256 ? ['--sha256', sha256] : []), dest, ...urls], {
    log,
    env: { PYTHONIOENCODING: 'utf-8' },
    timeoutMs: 2 * 3600_000,
    onLine: (line) => {
      const m = line.match(/^progress (\d+) (\d+)/)
      if (m && Number(m[2])) {
        onProgress?.(Number(m[1]), Number(m[2]))
        const pct = Math.floor((Number(m[1]) / Number(m[2])) * 10) * 10
        if (pct !== lastPct) { lastPct = pct; note?.(`  ${rel}：${pct}%`) }
      } else if (/^retry /.test(line)) note?.('  ' + line.replace(/^retry /, '断了，换个源接着下：'))
    },
  })
}

/** 模型文件能不能读：刚下完/导入的大文件常被杀毒软件锁住几秒，等一等再试，还不行就报出是哪个文件。 */
export async function ensureReadable(files, tries = 4, waitMs = 3000) {
  for (const f of files) {
    if (!existsSync(f)) continue
    for (let i = 1; ; i++) {
      try {
        const fd = openSync(f, 'r')
        try { readSync(fd, Buffer.alloc(16), 0, 16, 0) } finally { closeSync(fd) }
        break
      } catch (error) {
        if (i >= tries || !/EACCES|EPERM|EBUSY/.test(error.code || '')) throw new Error(`Permission denied: '${f}'（${error.code || error.message}）`)
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }
}

/** 一个目录（含子目录）有多大，字节。目录不存在算 0。 */
export function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let names
    try { names = readdirSync(d, { withFileTypes: true }) } catch (error) { continue }
    for (const e of names) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else try { total += statSync(full).size } catch (error) {}
    }
  }
  return total
}

/** 翻唱环境的根目录：老安装沿用 C:\Aurabot\rvc，新安装放用户目录下。 */
export function defaultRoot(platform = process.platform) {
  return platform === 'win32' && existsSync(LEGACY_ROOT) ? LEGACY_ROOT : join(homedir(), 'Aurabot', 'rvc')
}

/**
 * 检查安装位置：要绝对路径；中文、空格可能让一些工具出问题，提醒一下；顺便看看那个盘还剩多少空间（装完约 8 GB）。
 * @returns {{ok: boolean, path: string, message: string, warn: string, freeGB: number|null}}
 */
/** 把安装时的报错翻译成人话，并告诉用户接下来怎么办。 */
export function explainInstallError(msg) {
  const m = String(msg || '')
  if (/ENOENT/.test(m)) return `找不到需要的程序（${(m.match(/spawn (\S+)/) || [])[1] || '?'}）。点「重新检查 / 修复安装」再试一次；还不行就把报错发给作者`
  if (/ENOSPC|No space|磁盘空间|not enough space/i.test(m)) return '磁盘空间不够了。换一个空间大的盘（上面「装到哪里」），保存后再装'
  if (/timed? ?out|超时|30 秒没进度|operation timed/i.test(m)) return '网络太慢、超时了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  if (/CERTIFICATE_VERIFY_FAILED|unable to get local issuer certificate|self[- ]signed certificate|certificate verify failed/i.test(m)) return 'HTTPS 证书校验没通过（unable to get local issuer certificate）。通常是网络里有代理、加速器或安全软件在中间换了证书：先关掉它们再点安装；还不行就按手册「翻唱 → 手动放置预训练文件」把文件下好放进去，已下好的不会重下'
  if (/connection|connect|reset|TLS|SSL|dns|resolve|Failed to fetch|Failed to download|error sending request|无法连接|网络/i.test(m)) return '网络连接断了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  if (/CUDA|nvidia|GPU/i.test(m)) return '和显卡驱动有关，可能需要更新 NVIDIA 驱动。' + m.slice(0, 160)
  return m.slice(0, 300)
}

/** 安装的几步（面板按这个画步骤条）。 */
export const INSTALL_STEPS = ['创建 Python 环境', '下载 Applio（RVC 推理引擎）', '安装 PyTorch、RVC 和人声分离（最大的一步）', '准备 ffmpeg', '下载 RVC 需要的预训练文件（音高、音色特征）', '下载人声分离模型']

// 默认人声分离模型要的文件：[文件名, 下载地址（按顺序试）, sha256]。提前下好，免得第一次点歌时卡着不动。
// 模型 640 MB，GitHub 在国内经常下不动：先走 HuggingFace 镜像（有人转存了同一个文件，校验值一样），再试官方。
// 下完核对 sha256，哪个源给的文件不对就换下一个；配置文件很小，随插件带着（src/song/separator/）。
const GH_UVR = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models'
const GH_AS = 'https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs'
const HF_SEP = ['Politrees/UVR_resources/resolve/main/models/Roformer/BandSplit', 'datasets/SayanoAI/RVC-Studio/resolve/main/UVR']
const BS_ROFORMER = 'model_bs_roformer_ep_317_sdr_12.9755'
/** 人声分离模型文件：[文件名, 下载地址列表, sha256（可选）]。 */
export const SEPARATOR_FILES: Record<string, Array<[string, string[], string?]>> = {
  [`${BS_ROFORMER}.ckpt`]: [
    [`${BS_ROFORMER}.ckpt`, [
      ...HF_SEP.map((p) => `https://hf-mirror.com/${p}/${BS_ROFORMER}.ckpt`),
      `${GH_UVR}/${BS_ROFORMER}.ckpt`,
      `https://huggingface.co/${HF_SEP[0]}/${BS_ROFORMER}.ckpt`,
      `${GH_AS}/${BS_ROFORMER}.ckpt`,
    ], '5b84f37e8d444c8cb30c79d77f613a41c05868ff9c9ac6c7049c00aefae115aa'],
    [`${BS_ROFORMER}.yaml`, [`${GH_AS}/${BS_ROFORMER}.yaml`], '2bfdd16c656bd9519aba757cc4f8834b7ede675eb1e00ec4772d74ae1c41af7f'],
  ],
}
export const BUNDLED_SEP = fileURLToPath(new URL('../../separator/', import.meta.url))

/** 手动下载用的地址（面板里给用户复制，用浏览器或下载工具下好再拖进来）。 */
export function separatorLinks(model) {
  return (SEPARATOR_FILES[model] || []).slice(0, 1).flatMap(([, urls]) => urls.slice(0, 3))
}

/**
 * 导入手动下好的分离模型：核对 sha256，对得上才放进去。
 * @returns {{ok:boolean, message:string}}
 */
export function importSeparator(dir, filename, buf) {
  const sha = createHash('sha256').update(buf).digest('hex')
  for (const files of Object.values(SEPARATOR_FILES)) {
    const hit = files.find(([, , want]) => want === sha)
    if (hit) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, hit[0]), buf)
      rmSync(join(dir, hit[0] + '.download'), { force: true })
      return { ok: true, message: `人声分离模型导入好了（${hit[0]}）` }
    }
  }
  return { ok: false, message: `「${filename}」不是插件要的人声分离模型（校验对不上），要下 ${BS_ROFORMER}.ckpt` }
}
// 分离工具每次运行都要的模型清单（缺了会去 raw.githubusercontent.com 拉，国内常常连不上）
// raw.githubusercontent.com 和 cdn.jsdelivr.net 在国内常被重置连接（#8），多给几个 jsDelivr 节点和 GitHub 代理
const SEPARATOR_LIST_PATH = 'TRvlvr/application_data/main/filelists/download_checks.json'
export const SEPARATOR_LIST: [string, string[], string?] = ['download_checks.json', [
  `https://fastly.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json`,
  `https://gcore.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json`,
  `https://testingcf.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json`,
  `https://ghfast.top/https://raw.githubusercontent.com/${SEPARATOR_LIST_PATH}`,
  `https://raw.githubusercontent.com/${SEPARATOR_LIST_PATH}`,
  `https://cdn.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json`,
]]

/** 电脑上的盘和剩余空间，给面板「装到哪个盘」用：[{drive, root, freeGB, totalGB}] */
export function listDrives() {
  const out = []
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const d = `${L}:\\`
    try {
      if (!existsSync(d)) continue
      const s = statfsSync(d)
      const gb = (n) => Math.round((Number(n) * Number(s.bsize)) / 1024 ** 3 * 10) / 10
      if (!s.blocks) continue
      out.push({ drive: `${L}:`, root: `${L}:\\Aurabot\\rvc`, freeGB: gb(s.bavail), totalGB: gb(s.blocks) })
    } catch (error) {}
  }
  return out
}

export function checkRoot(path, platform = process.platform) {
  const p = String(path || '').trim()
  if (!p) return { ok: true, path: '', message: '', warn: '', freeGB: null }
  const linux = platform === 'linux'
  const valid = linux ? posix.isAbsolute(p) : win32.isAbsolute(p) && /^[A-Za-z]:\\/.test(p.replace(/\//g, '\\'))
  if (!valid) return { ok: false, path: p, message: linux ? '要写完整路径，比如 /home/ubuntu/Aurabot/rvc' : '要写完整路径，比如 D:\\Aurabot\\rvc', warn: '', freeGB: null }
  const warn = /[^\x21-\x7e]/.test(p) ? '路径里有中文或空格，个别工具可能出问题，最好换成全英文、不带空格的路径' : ''
  let freeGB = null
  try {
    // 往上找到第一个存在的目录来量剩余空间
    let probe = p
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const s = statfsSync(probe)
    freeGB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3 * 10) / 10
  } catch (error) {}
  return { ok: true, path: p, message: '', warn: warn || (freeGB !== null && freeGB < 10 ? `这个盘只剩 ${freeGB} GB，装完要 8 GB 左右，安装时还要临时多占几 GB` : ''), freeGB }
}

export function pathsOf(root, { platform = process.platform, allowLegacy = true } : PathsOfOptions = {}) {
  // 旧 Linux 手工部署可能已有 Scripts/*.exe 转发脚本，原生程序在位时优先用原生路径。
  const binary = (windows, linux) => {
    const legacy = join(root, ...windows)
    if (platform !== 'linux') return legacy
    const native = join(root, ...linux)
    return allowLegacy && !existsSync(native) && existsSync(legacy) ? legacy : native
  }
  return {
    root,
    python: binary(['env', 'Scripts', 'python.exe'], ['env', 'bin', 'python']),
    separatorExe: binary(['env', 'Scripts', 'audio-separator.exe'], ['env', 'bin', 'audio-separator']),
    applio: join(root, 'Applio'),
    models: join(root, 'models'),
    separatorModels: join(root, 'separator-models'),
    bin: join(root, 'bin'),
    ffmpeg: binary(['bin', 'ffmpeg.exe'], ['bin', 'ffmpeg']),
    rmvpe: join(root, 'Applio', 'rvc', 'models', 'predictors', 'rmvpe.pt'),
    contentvec: join(root, 'Applio', 'rvc', 'models', 'embedders', 'contentvec', 'pytorch_model.bin'),
  }
}