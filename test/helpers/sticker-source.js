import { stickerSource } from '../../packages/adapters/qq/onebot-v11/src/stickers.ts'

export function mockStickerSource(client) {
  return stickerSource({ verified: true, login: { uin: '20000002' }, bot: { selfId: '20000002', status: 'online' }, client }).capture
}
