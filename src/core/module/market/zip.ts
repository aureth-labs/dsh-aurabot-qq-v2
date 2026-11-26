import { inflateRawSync, crc32 } from 'node:zlib'

const MAX_FILE_BYTES = 64 * 1024 * 1024

export function readZip(buf: Buffer): Map<string, Buffer> {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('不是有效的 zip')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const packed = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (flags & 1) throw new Error('zip 不能加密')
    if (name.endsWith('/')) continue
    if (!safeName(name)) throw new Error(`zip 里有不安全的路径：${name}`)
    if (method !== 0 && method !== 8) throw new Error(`zip 用了不支持的压缩方式：${name}`)
    total += size
    if (total > MAX_FILE_BYTES) throw new Error('解压后太大')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip 文件头损坏')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + packed)
    const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_FILE_BYTES }) : Buffer.from(raw)
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip 校验失败：${name}`)
    files.set(name, data)
  }
  return files
}

function safeName(name: string) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return name.split('/').every((seg) => seg.length > 0 && !/[. ]$|[:<>"|?*\u0000-\u001f]/.test(seg) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(seg))
}
