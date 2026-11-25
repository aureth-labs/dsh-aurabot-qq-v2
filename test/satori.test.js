// S7：元素树 ⇄ Satori 片段
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '../src/core/element.ts'
import { toSatori, fromSatori } from '../src/core/satori.ts'

test('toSatori：文本 / 图片 / @ 都映射成 Satori 标签', () => {
  const xml = toSatori([
    h.text('你好'),
    h.at(123),
    h.image('https://example.com/a.png'),
  ])
  assert.equal(
    xml,
    '<message><text>你好</text><at id="123"/><img src="https://example.com/a.png"/></message>',
  )
})

test('fromSatori：img/audio 换回内部类型，src 改成 url', () => {
  const tree = fromSatori('<message><text>hi</text><img src="https://x/1.png"/></message>')
  assert.deepEqual(tree, [
    { type: 'text', attrs: { content: 'hi' } },
    { type: 'image', attrs: { url: 'https://x/1.png' } },
  ])
})

test('fromSatori 容错：未知标签丢内容，未闭合标签留正文，标签外文字保留', () => {
  const tree = fromSatori('<message></ACP>你好啊</message>')
  assert.deepEqual(tree, [{ type: 'text', attrs: { content: '你好啊' } }])
  const broken = fromSatori('<message><text>前</text><b>粗</text>后</message>')
  assert.deepEqual(broken, [{ type: 'text', attrs: { content: '前粗后' } }])
})

test('往返：toSatori → fromSatori 不丢内容', () => {
  const source = [h.text('a'), h.image('https://x/1.png'), h.text('b')]
  const back = fromSatori(toSatori(source))
  assert.deepEqual(back, [
    { type: 'text', attrs: { content: 'a' } },
    { type: 'image', attrs: { url: 'https://x/1.png' } },
    { type: 'text', attrs: { content: 'b' } },
  ])
})
