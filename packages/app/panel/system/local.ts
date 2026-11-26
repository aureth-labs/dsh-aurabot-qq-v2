import { fileOf, toImageBuffer } from '../../../../src/local/index.ts'
import { existsSync } from 'node:fs'

export function registerLocalRoutes({ http, local, openFolder, getConfig }) {
  const { route, readBody } = http

  route('/local/status', async () => ({ ok: true, dir: local.dir(), list: local.status() }))
  route('/local/template', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    if (!local.pathOf || !['tts', 'image', 'song', 'asr'].includes(slot))
      return { ok: false, message: '没有这一项' }
    return local.template(slot)
  })
  route('/local/open', async () => openFolder(local.dir()))
  route('/local/test', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    try {
      if (slot === 'tts') {
        const file = fileOf(await local.call('tts', { text: '你好呀，我是大肥鱼，这是本地语音测试。' }))
        if (!file || !existsSync(file)) return { ok: false, message: '脚本没返回音频文件' }
        return { ok: true, message: `念好了：${file}` }
      }
      if (slot === 'image') {
        const buf = await toImageBuffer(
          await local.call('image', {
            prompt: '一条胖乎乎的蓝色小鱼，可爱，插画',
            size: getConfig().imageGen.size || '1024x1024',
          }),
        )
        return {
          ok: true,
          message: `画好了（${Math.round(buf.length / 1024)} KB）`,
          image: buf.toString('base64'),
        }
      }
      return { ok: false, message: '这一项没法单独试：翻唱换声去 QQ 里点首歌，语音识别发条语音条试试' }
    } catch (error) {
      return { ok: false, message: '出错了：' + error.message }
    }
  })
}
