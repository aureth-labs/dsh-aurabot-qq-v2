import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandMentions, hasMention } from '../../packages/modules/chat-bridge/qq/format/mentions.ts'

const members = [
  { user: { id: '10001', name: 'zyb' }, nick: '张小明（摸鱼仔）' },
  { user: { id: '10002', name: '小饭团' }, nick: '' },
  { user: { id: '10003', name: 'a' }, nick: '小王' },
  { user: { id: '10004', name: 'b' }, nick: '小王' },
]
const text = (t) => [{ type: 'text', attrs: { content: t } }]

test('顺手打的 @名字 对上群名片（括号备注去掉也认）就变成真 @', () => {
  assert.deepEqual(expandMentions(text('@张小明 刚爬完楼'), members), [
    { type: 'at', attrs: { id: '10001' } },
    { type: 'text', attrs: { content: ' 刚爬完楼' } },
  ])
  assert.deepEqual(expandMentions(text('嘿@小饭团别跑'), members), [
    { type: 'text', attrs: { content: '嘿' } },
    { type: 'at', attrs: { id: '10002' } },
    { type: 'text', attrs: { content: ' 别跑' } },
  ], '不带空格也能认，@ 后补个空格')
})

test('<at:QQ号> 和 <at:名字> 都行；数字号直接信任，重名/不认识的名字原样留成文字', () => {
  assert.deepEqual(expandMentions(text('<at:10002> 在吗'), members)[0], { type: 'at', attrs: { id: '10002' } })
  assert.deepEqual(expandMentions(text('<at:小饭团>'), members), [{ type: 'at', attrs: { id: '10002' } }])
  assert.deepEqual(expandMentions(text('<at:99999> 在吗'), members), [{ type: 'at', attrs: { id: '99999' } }, { type: 'text', attrs: { content: ' 在吗' } }], '数字 QQ 直接信任：群成员列表拉不到/不全时也不能降级成文字（#77）')
  assert.deepEqual(expandMentions(text('@小王 在吗'), members), text('@小王 在吗'), '两个小王，不猜')
  assert.deepEqual(expandMentions(text('@路人甲 在吗'), members), text('@路人甲 在吗'))
})

test('别的段（表情、引用）原样保留；没有 @ 就不用拉群成员', () => {
  const segs = [{ type: 'quote', attrs: { id: '1' } }, ...text('@小饭团 '), { type: 'face', attrs: { id: '178' } }]
  assert.deepEqual(expandMentions(segs, members), [{ type: 'quote', attrs: { id: '1' } }, { type: 'at', attrs: { id: '10002' } }, { type: 'text', attrs: { content: ' ' } }, { type: 'face', attrs: { id: '178' } }])
  assert.equal(hasMention('普通的话'), false)
  assert.equal(hasMention('<at:1>'), true)
})

test('没对上的 @ 记下来（让发消息的工具如实告诉她）', () => {
  const missed = []
  expandMentions(text('@张小明 别闷着 <at:99999> @小饭团'), members.slice(1), missed)
  assert.deepEqual(missed, ['张小明'], '数字 QQ 直接信任，不再记进没对上的列表（#77）')
})

test('名字带标点也能 @（「。Luna」），名字后面紧跟的标点不算进名字', () => {
  const ms = [{ user: { id: '10005', name: '。Luna' }, nick: '' }]
  assert.deepEqual(expandMentions(text('@。Luna，在吗'), ms), [{ type: 'at', attrs: { id: '10005' } }, { type: 'text', attrs: { content: ' ，在吗' } }])
})
