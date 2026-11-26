import { mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { readZip } from '../../audio/zip.ts'



/** models 目录里的音色：[{id, pth, index}]，同名 .index 可选。 */
export function listVoices(modelsDir) {
  let names = []
  try { names = readdirSync(modelsDir) } catch (error) { return [] }
  return names.filter((n) => n.toLowerCase().endsWith('.pth')).sort().map((n) => {
    const id = n.slice(0, -4)
    const idx = names.find((m) => m.toLowerCase().endsWith('.index') && m.toLowerCase().includes(id.toLowerCase()))
    return { id, pth: join(modelsDir, n), index: idx ? join(modelsDir, idx) : '' }
  })
}

/** 像不像 RVC 模型：PyTorch 存的 .pth 要么是 zip 格式（PK 开头），要么是老的 pickle（0x80 开头）。 */
export function looksLikePth(buf) {
  return buf.length > 1024 * 1024 && ((buf[0] === 0x50 && buf[1] === 0x4b) || buf[0] === 0x80)
}

const safeName = (n) => basename(String(n).replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()

/**
 * 导入音色：.pth / .index，或者装着它们的 zip。存进 models 目录。
 * zip 里只有一个音色时，index 自动改名成「音色名.index」配上。
 * @returns {{ok: boolean, added: string[], indexes: number, message: string}}
 */
export function importModels(modelsDir, filename, buf) {
  const name = safeName(filename)
  const lower = name.toLowerCase()
  let files
  if (lower.endsWith('.zip')) {
    files = readZip(buf, (n) => /\.(pth|index)$/i.test(n) && !n.includes('__MACOSX')).map((f) => ({ name: safeName(f.name), data: f.data }))
  } else if (lower.endsWith('.pth') || lower.endsWith('.index')) {
    files = [{ name, data: buf }]
  } else {
    return { ok: false, added: [], indexes: 0, message: '只支持 .zip、.pth、.index 文件' }
  }
  const pths = files.filter((f) => f.name.toLowerCase().endsWith('.pth'))
  const idxs = files.filter((f) => f.name.toLowerCase().endsWith('.index'))
  if (!pths.length && !idxs.length) return { ok: false, added: [], indexes: 0, message: '里面没找到 .pth 模型' }
  const bad = pths.filter((f) => !looksLikePth(f.data))
  if (bad.length) return { ok: false, added: [], indexes: 0, message: `「${bad[0].name}」看起来不是 RVC 模型` }
  mkdirSync(modelsDir, { recursive: true })
  for (const f of pths) writeFileSync(join(modelsDir, f.name), f.data)
  const solo = pths.length === 1 ? pths[0].name.slice(0, -4) : ''
  for (const f of idxs) writeFileSync(join(modelsDir, solo && idxs.length === 1 ? `${solo}.index` : f.name), f.data)
  const added = pths.map((f) => f.name.slice(0, -4))
  return {
    ok: true,
    added,
    indexes: idxs.length,
    message: added.length ? `导入了 ${added.length} 个音色：${added.join('、')}${idxs.length ? `（带 ${idxs.length} 个 index）` : ''}` : `导入了 ${idxs.length} 个 index`,
  }
}

/** 删掉一个音色（连同配套的 index）。 */
export function deleteVoice(modelsDir, id) {
  const v = listVoices(modelsDir).find((x) => x.id === id)
  if (!v) return { ok: false, message: '没有这个音色' }
  rmSync(v.pth, { force: true })
  if (v.index) rmSync(v.index, { force: true })
  return { ok: true, message: `删掉了「${id}」` }
}

/** 缓存目录只留最新的 keep 个文件。 */
export function pruneCache(dir, keep) {
  let files = []
  // 只按成品 mp3 计数；旁边记变调的 .json 跟着成品一起删（#10）
  try { files = readdirSync(dir).filter((n) => !n.endsWith('.mp3.json')).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })) } catch (error) { return 0 }
  const old = files.sort((a, b) => b.t - a.t).slice(keep)
  for (const f of old) { rmSync(join(dir, f.n), { force: true }); rmSync(join(dir, f.n + '.json'), { force: true }) }
  return old.length
}