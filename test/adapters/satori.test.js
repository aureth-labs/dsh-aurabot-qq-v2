// S7：元素树 ⇄ Satori 片段
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '../../src/core/message/element/element.ts'
import { toSatori, fromSatori } from '../../src/core/message/satori/satori.ts'

test('转发保留子消息、布尔属性与实体，协议外壳只拆一层', () => {
  const source = '<message forward><message><author id="A&amp;B"/>&#x732b; &lt;3</message></message>'
  const expected = [h.forward([h('message', {}, [h('author', { id: 'A&B' }), h.text('猫 <3')])])]
  assert.deepEqual(fromSatori(source), expected)
  assert.deepEqual(fromSatori(toSatori(expected)), expected)
})

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

test('fromSatori 容错：未知标签丢内容，未闭合块丢弃，标签外文字保留', () => {
  const tree = fromSatori('<message></ACP>你好啊</message>')
  assert.deepEqual(tree, [{ type: 'text', attrs: { content: '你好啊' } }])
  const broken = fromSatori('<message><text>前</text><b>粗</text>后</message>')
  assert.deepEqual(broken, [h.text('前')])
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
