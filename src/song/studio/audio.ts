import { join } from 'node:path'
import { SongClipError, selectedWindow } from '../audio/segment.ts'


type EstimateChorusStartOptions = Partial<Record<'sampleRate' | 'maxSec' | 'frameSec', any>>

/** 截一段：歌比上限长时从「大约副歌」的位置开始（全曲 30% 处），否则从头。 */
/** 分出来的人声轨平均音量低于这个就当没有人声。正常人声在 -15 ~ -30 dB，纯音乐分出来是 -80 以下。 */
export const VOCAL_MIN_DB = -50

/** 混音的 ffmpeg 参数。没有 inst 就是清唱，只留她的人声。 */
export function mixArgs({ vocals, inst, vol, iv, out }) {
  const head = ['-y', '-hide_banner', '-loglevel', 'error', '-i', vocals]
  const tail = ['-ac', '2', '-ar', '44100', '-b:a', '192k', out]
  if (!inst) return [...head, '-af', `volume=${vol},alimiter=limit=0.95`, ...tail]
  return [...head, '-i', inst, '-filter_complex', `[0:a]volume=${vol}[v];[1:a]volume=${iv}[i];[v][i]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95`, ...tail]
}

const INSTRUMENTAL = /纯音乐|伴奏|钢琴|吉他|八音盒|音乐盒|古筝|琵琶|二胡|笛子|葫芦丝|小提琴|大提琴|口琴|萨克斯|instrumental|off ?vocal|karaoke|\binst\b|\bbgm\b|music box|piano/i

/** 搜索结果排序：标题像纯音乐（钢琴版、伴奏……）的放到最后，除非点歌时本来就这么说。其余保持网易云的顺序。 */
export function rankCandidates(list, query = '') {
  const want = INSTRUMENTAL.test(query)
  const bad = (s) => !want && INSTRUMENTAL.test(`${s.name} ${s.alias || ''}`)
  return [...list.filter((s) => !bad(s)), ...list.filter(bad)]
}

/** 截一段：歌比上限长时从自动定位的副歌入口开始（分析不出来回退全曲 30%），否则从头；head 从头。 */
export function clipWindow(durationSec, maxSec, start = 'auto', chorusStart = null) {
  if (!(durationSec > maxSec)) return { start: 0, length: durationSec }
  if (start === 'head') return { start: 0, length: maxSec }
  const latest = Math.max(0, Math.floor(durationSec - maxSec))
  if (Number.isFinite(chorusStart) && chorusStart >= 0) return { start: Math.min(Math.round(chorusStart), latest), length: maxSec }
  const s = Math.max(0, Math.min(Math.round(durationSec * 0.3), latest))
  return { start: s, length: maxSec }
}

/** 每 frameSec 秒一帧的 RMS 音量包络（0~1）。纯函数：pcm 是 16-bit 单声道小端 PCM。 */
export function pcmEnergyEnvelope(pcm, sampleRate = 8000, frameSec = 0.25) {
  if (!pcm || !pcm.length || !(sampleRate > 0) || !(frameSec > 0)) return []
  const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
  const frameSamples = Math.max(1, Math.round(sampleRate * frameSec))
  const totalSamples = Math.floor(bytes.length / 2)
  const out = []
  for (let start = 0; start + frameSamples <= totalSamples; start += frameSamples) {
    let sum = 0
    for (let i = 0; i < frameSamples; i++) {
      const v = bytes.readInt16LE((start + i) * 2) / 32768
      sum += v * v
    }
    out.push(Math.sqrt(sum / frameSamples))
  }
  return out
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 4) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb
    num += x * y; da += x * x; db += y * y
  }
  return da > n * 1e-8 && db > n * 1e-8 ? num / Math.sqrt(da * db) : 0
}

/**
 * 从 16-bit 单声道 PCM 估算副歌入口（秒）。
 *
 * 思路（离线、零依赖）：
 *   1. 每 0.25 秒算 RMS 音量；按秒平均并做 3 秒平滑；
 *   2. 找出持续高于「中位数~90 分位」阈值的响段（前奏/间奏通常太短会被滤掉）；
 *   3. 对每个响段，用音量曲线和其他同时长片段做相关，重复度高的段落更像副歌；
 *   4. 综合「平均能量 × (0.5 + 0.5 × 重复度)」挑第一段最强的副歌。
 * 分析不出来（静音、太短、没有明显响段）返回 null，由 clipWindow 回退 30%。
 */
export function estimateChorusStart(pcm, { sampleRate = 8000, maxSec = 120, frameSec = 0.25 } : EstimateChorusStartOptions = {}) {
  const envelope = pcmEnergyEnvelope(pcm, sampleRate, frameSec)
  const totalSec = envelope.length * frameSec
  if (!(maxSec > 0) || !(totalSec > maxSec)) return null
  const secCount = Math.floor(totalSec)
  const energy = []
  for (let s = 0; s < secCount; s++) {
    const a = Math.floor(s / frameSec)
    const b = Math.min(envelope.length, Math.floor((s + 1) / frameSec))
    let sum = 0, n = 0
    for (let i = a; i < b; i++) { sum += envelope[i]; n++ }
    energy.push(n ? sum / n : 0)
  }
  if (energy.length < 8) return null
  const smooth = energy.map((_, i) => {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - 1); j <= Math.min(energy.length - 1, i + 1); j++) { sum += energy[j]; n++ }
    return n ? sum / n : 0
  })
  const sorted = [...smooth].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]
  const med = at(0.5), p90 = at(0.9), maxEnergy = sorted[sorted.length - 1]
  if (!(maxEnergy > 0.005)) return null // 整首几乎是静音
  const threshold = med + (p90 - med) * 0.4
  const minRun = Math.max(3, Math.min(12, Math.round(maxSec * 0.2)))
  const runs = []
  let runStart = -1, lastLoud = -1
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] >= threshold) {
      if (runStart < 0) runStart = i
      else if (i - runStart >= minRun && energy[i] > energy[i - 1] * 1.35) {
        // 音量突然抬一大截（副歌接桥段之类）就在跳变处切开，别把两段合成一段
        runs.push({ start: runStart, end: i - 1 })
        runStart = i
      }
      lastLoud = i
    } else if (runStart >= 0 && i - lastLoud > 2) {
      // 允许中间有 1~2 秒的短暂回落，别把一个副歌切碎
      if (lastLoud - runStart + 1 >= minRun) runs.push({ start: runStart, end: lastLoud })
      runStart = -1
    }
  }
  if (runStart >= 0 && lastLoud - runStart + 1 >= minRun) runs.push({ start: runStart, end: lastLoud })
  if (!runs.length) return null
  let best = null
  for (const run of runs) {
    let sum = 0
    for (let i = run.start; i <= run.end; i++) sum += smooth[i]
    const avg = sum / (run.end - run.start + 1)
    // 用响段内部（去掉两端淡入淡出）的音量曲线做重复度，避免边界过渡造成假相似
    const margin = run.end - run.start >= 8 ? 2 : 0
    const len = Math.min(16, run.end - run.start + 1 - margin * 2)
    const patternStart = run.start + margin
    const pattern = energy.slice(patternStart, patternStart + len)
    let repeat = 0
    for (let t = 0; t + len <= smooth.length; t += 2) {
      if (t + len > run.start - 2 && t < run.end + 3) continue // 跳过和自己重叠的片段
      const c = correlation(pattern, energy.slice(t, t + len))
      if (c > repeat) repeat = c
    }
    const score = avg * (0.5 + 0.5 * Math.max(0, repeat)) - run.start * 1e-6 // 同分时优先靠前的副歌
    if (!best || score > best.score) best = { ...run, score }
  }
  const latest = Math.max(0, Math.floor(totalSec - maxSec))
  return Math.max(0, Math.min(best.start, latest))
}

/** 翻唱出错翻译成人话（给点歌的人看）。 */
export function explainSongError(message) {
  const m = String(message || '')
  if (/size mismatch|Error\(s\) in loading state_dict|unexpected key|Missing key|KeyError: '(weight|config|params)'/i.test(m)) return '这个音色模型和内置的 RVC 不兼容（可能是 so-vits-svc 之类训练的，或者不是完整的模型文件）。可以在面板「本地接口」里接你自己的推理'
  if (/CUDA out of memory|OutOfMemoryError|not enough memory/i.test(m)) return '显卡显存不够，关掉别的占显存的程序（游戏、别的 AI）再试'
  if (/No module named|ModuleNotFoundError/i.test(m)) return '翻唱环境不完整，在面板「翻唱」页点「重新检查 / 修复安装」'
  if (/Permission denied|Errno 13|EACCES|EPERM|EBUSY/i.test(m)) {
    const file = (m.match(/'([^']+\.(?:ckpt|pth|onnx|yaml|json))'/i) || [])[1]?.replace(/\\\\/g, '\\')
    return `${file ? `读不了「${file}」` : '有个模型文件读不了'}：多半是杀毒软件（360、火绒、Defender）正在扫描或拦住了它，或者文件是用管理员身份放进去的。把翻唱目录加进杀毒软件的信任区再试；还不行就删掉这个文件，在面板「翻唱」页重新下载`
  }
  return m
}

export class SongDeliveryError extends Error {}

/** 对聊天和模型只给固定的人话；报错原文留在日志和本机翻唱面板。 */
export function songFailureReason(error) {
  if (error instanceof SongClipError || error instanceof SongDeliveryError) return error.message
  const m = String(error?.message || '')
  if (/没有人声|都没有人声/.test(m)) return '这次没有检测到人声，请换个片段或歌曲版本。'
  if (/网易云上没搜到/.test(m)) return '没搜到这首歌，请检查歌名或补上歌手。'
  if (/会员|版权限制/.test(m)) return '这个歌曲版本暂时下载不了，请换一个版本，或请主人检查音乐账号设置。'
  if (/没有可用的音色|没有导入音色/.test(m)) return '还没有可用音色，请主人在翻唱面板选择或导入音色。'
  if (/No module named|ModuleNotFoundError|翻唱环境不完整|环境还没装好/.test(m)) return '翻唱环境不完整，请主人在翻唱面板检查安装。'
  if (/out of memory|OutOfMemoryError|not enough memory/i.test(m)) return '处理这段歌的内存不够，请缩短片段或关闭占用较大的程序。'
  if (/timeout|timed? out|超时|处理时间太长/i.test(m)) return '这次处理超时了，请缩短片段后再试。'
  return '这次翻唱没完成，详细原因请主人查看翻唱面板。'
}

/**
 * 截出要发的那一段（依赖可注入，测试不用真 ffmpeg/真音频）。
 * auto 模式下先让 readPcm 读整首歌 PCM、分析副歌入口；分析失败/不可用回退全曲 30%。
 * @returns {Promise<{file:string, cut:boolean, length:number}>}
 */
export async function cutFirstWith({
  song, dir, clip = null, maxSec = 120, clipStart = 'auto',
  probeDuration, readPcm, run, ffmpegPath, log,
}) {
  const dur = await probeDuration(song)
  let chorusStart = null
  if (!clip && clipStart !== 'head' && dur > maxSec) {
    try {
      const pcm = readPcm ? await readPcm(song) : null
      chorusStart = pcm ? estimateChorusStart(pcm, { sampleRate: 8000, maxSec }) : null
      if (Number.isFinite(chorusStart)) log?.info?.(`副歌定位：从第 ${chorusStart} 秒开始截（歌长 ${Math.round(dur)} 秒）`)
    } catch (error) {
      log?.debug?.('副歌定位分析失败：', error.message)
      chorusStart = null
    }
  }
  const w = clip ? selectedWindow(dur, clip) : clipWindow(dur, maxSec, clipStart, chorusStart)
  if (!dur || (w.start === 0 && w.length >= dur)) return { file: song, cut: false, length: dur }
  const out = join(dir, 'part.wav')
  await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(w.start), '-t', String(w.length), '-i', song, '-ar', '44100', out], { log })
  return { file: out, cut: true, length: w.length }
}