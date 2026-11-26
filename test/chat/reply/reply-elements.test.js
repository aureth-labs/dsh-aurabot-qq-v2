// Satori 风格的元素标签：<text> 只是显式文字，<file> 落到发文件链路。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReply, itemsToLine } from '../../../src/chat/reply/index.ts'

const kinds = (r) => r.items.map((i) => [i.kind, i.value])

test('<text> 里面的内容当普通文字，标签本身不外泄', () => {
  const r = parseReply('<text>好哦，文件给你递过来啦</text>', {})
  assert.equal(r.silent, false)
  assert.deepEqual(kinds(r), [['text', '好哦，文件给你递过来啦']])
})

test('缺省的 text 与显式 <text> 混排时顺序不变', () => {
  const r = parseReply('先说一句\n<text>再说一句</text>', {})
  assert.deepEqual(kinds(r), [['text', '先说一句'], ['text', '再说一句']])
})

test('落单的 <text> / </text> 也当噪声去掉', () => {
  assert.deepEqual(kinds(parseReply('</text>你好<text>', {})), [['text', '你好']])
})

test('<file> 解析成文件条目，name 可选', () => {
  const r = parseReply('<text>给你</text>\n<file>file:///D:/x/report.pdf</file>', {})
  assert.deepEqual(kinds(r), [['text', '给你'], ['file', 'file:///D:/x/report.pdf']])
  assert.equal(r.items[1].name, '')

  const named = parseReply('<file name="报表.pdf">file:///D:/x/report.pdf</file>', {})
  assert.deepEqual(kinds(named), [['file', 'file:///D:/x/report.pdf']])
  assert.equal(named.items[0].name, '报表.pdf')
})

test('只有 <file> 的回复不算沉默', () => {
  assert.equal(parseReply('<file>https://example.com/a.zip</file>', {}).silent, false)
})

test('itemsToLine 把文件条目写成可读文本', () => {
  assert.equal(itemsToLine([{ kind: 'file', value: '/tmp/a.zip', name: 'a.zip' }]), '[文件] a.zip')
})
