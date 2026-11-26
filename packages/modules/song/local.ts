import { fileURLToPath } from 'node:url'

export const songSlot = { file: 'song-convert.mjs', source: fileURLToPath(new URL('./templates/song-convert.mjs', import.meta.url)), title: '翻唱换声', timeoutMs: 20 * 60_000, example: '我自己训练的 so-vits-svc 模型（项目在 D:/so-vits-svc，模型 logs/44k/G_10000.pth）' }
