import { accessSync, constants, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export function executable(file: string) {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return statSync(file).isFile()
  } catch { return false }
}

interface SearchOptions {
  platform?: NodeJS.Platform
  pathEnv?: string
  exists?: (file: string) => boolean
}

export function findFfmpeg(configured = '', { platform = process.platform, pathEnv = process.env.PATH || '', exists = executable }: SearchOptions = {}) {
  const path = platform === 'win32' ? win32 : posix
  const name = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1')
  const directories = pathEnv.split(path.delimiter).map(unquote).filter(dir => path.isAbsolute(dir))
  if (platform === 'win32') directories.push('C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin')
  else if (platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
  else directories.push('/usr/local/bin', '/usr/bin')
  const candidates = [unquote(configured), ...directories.map(dir => path.join(dir, name))]
  return candidates.find(file => file && exists(file)) || ''
}
