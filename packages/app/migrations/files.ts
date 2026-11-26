import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'

export type Values = Record<string, unknown>
export function object(value: unknown): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {}
}
export function read(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}
export function backup(path: string, suffix: string) {
  try {
    copyFileSync(path, path + suffix, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
export function createFile(path: string, value: unknown) {
  if (existsSync(path)) return
  const tmp = path + '.' + randomUUID()
  writeFileSync(tmp, Buffer.isBuffer(value) ? value : JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  try {
    linkSync(tmp, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    unlinkSync(tmp)
  }
}
