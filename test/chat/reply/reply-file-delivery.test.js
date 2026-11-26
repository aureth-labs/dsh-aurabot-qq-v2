// <file> 条目要真的落到发文件链路（deliver → sendFile），而不是当文字发出去。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeliver } from '../../../src/chat/hub/delivery/deliver.ts'
import { parseReply, itemsToLine, tidyPunctuation, cleanOutboundText, cleanOutboundSegments, bubbleDelay } from '../../../src/chat/reply/index.ts'
import { guardOutgoing } from '../../../src/chat/inbound/hooks/guard.ts'
import { hasSuspectTagShape } from '../../../src/chat/reply/index.ts'
import { normalize } from '../../../src/core/config/index.ts'

function harness() {
  const calls = []
  const sent = { sent: 0, sentTypes: new Set(), queuedTypes: new Set(), blocked: false, allowPromptEcho: false }
  const scope = { run: (_store, fn) => fn(), getStore: () => sent }
  const deliver = createDeliver({
    getConfig: () => ({ ...normalize({}), enabled: true, dryRun: false, files: { enabled: true, maxMB: 50, dirs: [] } }),
    log: { info() {}, warn() {}, debug() {}, error() {} },
    hooks: null,
    stickers: { pickForReply: () => null, match: () => null },
    groupRefs: new Map(),
    groupSaid: new Map(),
    groupEngaged: new Map(),
    ENGAGE_MS: 1000,
    saidElsewhere: new Map(),
    askModel: null,
    outputScope: scope,
    outputSources: { get: () => null },
    currentPromptSources: () => null,
    groupChatAllowed: () => true,
    cleaningFor: () => ({}),
    random: () => 1,
    mood: () => ({ delay: 0, sticker: 0, voice: 0 }),
    silenceTurn: () => {},
    guardOutgoing,
    parseReply,
    hasSuspectTagShape,
    tidyPunctuation,
    cleanOutboundSegments,
    itemsToLine,
    bubbleDelay,
    pause: async () => {},
    sendText: async (_chatId, value) => { calls.push(['text', value]); sent.sent++; sent.sentTypes.add('text') },
    sendVoice: async () => { sent.sent++; sent.sentTypes.add('voice') },
    sendSticker: async () => { sent.sent++; sent.sentTypes.add('sticker') },
    pokeBack: async () => { sent.sent++ },
    localImageBlocked: () => false,
    sendImage: async () => { sent.sent++; sent.sentTypes.add('image') },
    sendFile: async (chatId, file, name) => { calls.push(['file', chatId, file, name]); sent.sent++; sent.sentTypes.add('file') },
    logChat: () => {},
    onActivity: () => {},
    noteTurnActivity: () => {},
    isDisposed: () => false,
  })
  return { deliver: deliver.deliver, calls }
}

test('<file> 走 sendFile，不混进文字', async () => {
  const h = harness()
  await h.deliver('private:1', '<text>文件给你递过来啦</text>\n<file name="LICENSE">file:///D:/demo/LICENSE</file>')
  assert.deepEqual(h.calls, [
    ['text', '文件给你递过来啦'],
    ['file', 'private:1', 'file:///D:/demo/LICENSE', 'LICENSE'],
  ])
})

test('没有 name 的文件条目只传路径', async () => {
  const h = harness()
  await h.deliver('private:1', '<file>https://example.com/a.zip</file>')
  assert.deepEqual(h.calls, [['file', 'private:1', 'https://example.com/a.zip', '']])
})
