import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fetchImage } from '../../../src/core/net/index.ts'
import { findFfmpeg } from '../../../src/core/message/media/img.ts'
import { toMono16k } from '../../../src/core/message/media/wav.ts'

export const maxBytes = 30 * 1024 * 1024

export async function readAudio(url: string, media: string) {
  if (isAbsolute(url) || url.startsWith('file:')) {
    const file = await realpath(isAbsolute(url) ? url : fileURLToPath(url))
    const path = relative(await realpath(media), file)
    if (!path || path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) throw Error('语音文件超出媒体目录')
    const info = await stat(file)
    if (!info.isFile() || info.size > maxBytes) throw Error('语音文件无效或过大')
    return readFile(file)
  }
  return fetchImage(url.replace(/^data:audio\/[\w.+-]+;base64,/i, 'base64://'), { maxBytes, allowLocal: false })
}

function audioFormat(bytes: Buffer) {
  const magic = bytes.toString('latin1', 0, 16)
  if (magic.startsWith('RIFF') && magic.slice(8, 12) === 'WAVE') return 'wav'
  if (magic.startsWith('OggS')) return 'ogg'
  if (magic.startsWith('fLaC')) return 'flac'
  if (magic.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'mp3'
  if (magic.slice(4, 8) === 'ftyp') return 'm4a'
  if (bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm'
  if (magic.startsWith('#!AMR')) return 'amr'
  if (magic.includes('#!SILK_V3')) return 'silk'
  throw Error('无法识别语音文件格式')
}

export async function archiveAudio(bytes: Buffer, media: string) {
  if (bytes.length < 8 || bytes.length > maxBytes) throw Error('语音文件无效或过大')
  const format = audioFormat(bytes)
  const dir = join(media, 'voice')
  await mkdir(dir, { recursive: true })
  const file = join(dir, createHash('sha256').update(bytes).digest('hex') + '.' + format)
  try { if ((await stat(file)).size === bytes.length) return pathToFileURL(file).href } catch (err) { if (err.code !== 'ENOENT') throw err }
  const tmp = file + '.' + randomUUID()
  try {
    await writeFile(tmp, bytes, { flag: 'wx' })
    await rename(tmp, file)
  } finally { await rm(tmp, { force: true }) }
  return pathToFileURL(file).href
}

export async function pcmAudio(bytes: Buffer, configured: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  if (bytes.length > maxBytes) throw Error('语音文件过大')
  if (bytes.toString('ascii', 0, 4) === 'RIFF') {
    try { return toMono16k(bytes) } catch {}
  }
  const ffmpeg = findFfmpeg(configured)
  if (!ffmpeg) throw Error('该音频需要安装 FFmpeg 或配置可执行文件路径')
  return new Promise((resolve, reject) => {
    const proc = execFile(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe',
      '-i', 'pipe:0', '-vn', '-t', '600', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
    { windowsHide: true, timeout: 45000, encoding: 'buffer', maxBuffer: maxBytes, signal },
    (err, wav) => {
      if (err) return reject(Error('无法解码该音频'))
      try { resolve(toMono16k(wav)) } catch (error) { reject(error) }
    })
    proc.stdin.on('error', () => {})
    proc.stdin.end(bytes)
  })
}
