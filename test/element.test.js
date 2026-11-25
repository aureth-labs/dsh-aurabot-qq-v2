// S4 契约：默认写法是 h('text', { content })，坏 XML 只丢标签、不吞正文。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h, parse, stringify, select, normalize, toText, fromOneBot, toOneBot } from '../src/core/element.ts'

test('默认写法：h(text, { content })', () => {
  const el = h('text', { content: '你好' })
  assert.deepEqual(el, { type: 'text', attrs: { content: '你好' } })
})

test('快捷构造：at / image / voice / forward', () => {
  assert.deepEqual(h.at('123'), { type: 'at', attrs: { id: '123' } })
  assert.deepEqual(h.image('http://a/b.png'), { type: 'image', attrs: { url: 'http://a/b.png' } })
  assert.deepEqual(h.voice('http://a/b.mp3'), { type: 'voice', attrs: { url: 'http://a/b.mp3' } })
  const fwd = h.forward([h.text('一'), h.text('二')])
  assert.equal(fwd.type, 'forward')
  assert.equal(fwd.children.length, 2)
})

test('解析：标签、属性、自闭合', () => {
  const tree = parse('<at id="123"/> 你好 <image url="http://x/y.png"/>')
  assert.deepEqual(tree.map((e) => e.type), ['at', 'text', 'image'])
  assert.equal(tree[0].attrs.id, '123')
  assert.equal(tree[1].attrs.content, ' 你好 ')
  assert.equal(tree[2].attrs.url, 'http://x/y.png')
})

test('解析：未知标签整体丢掉，正文保留（模型吐半截 ACP 的场景）', () => {
  const tree = parse('</ACP>\n你好啊 很高兴第二次遇到你')
  assert.deepEqual(tree, [{ type: 'text', attrs: { content: '\n你好啊 很高兴第二次遇到你' } }])
  assert.equal(toText(tree), '\n你好啊 很高兴第二次遇到你')
})

test('解析：未闭合标签丢标签本体、保留内容', () => {
  const tree = parse('<ACP>你好</ACP>之后')
  assert.equal(toText(tree), '你好之后')
  assert.equal(select(tree, 'ACP').length, 0, '未声明的大写标签不进树')
})

test('序列化往返', () => {
  const src = '<at id="123"/>你好'
  const back = stringify(parse(src))
  assert.equal(back, '<at id="123"/>你好')
  assert.deepEqual(parse(back), parse(src))
})

test('normalize：相邻文本合并、空文本丢弃', () => {
  const merged = normalize([h.text('a'), h.text(''), h.text('b')])
  assert.deepEqual(merged, [h.text('ab')])
})

test('select 递归取元素，支持断言', () => {
  const tree = parse('<forward><text>一</text><image url="x"/></forward>')
  assert.equal(select(tree, 'image').length, 1)
  assert.equal(select(tree, (e) => e.type === 'text')[0].attrs.content, '一')
})

test('OneBot 互转：文本 / at / 图片 / 语音 / 引用', () => {
  const segments = [
    { type: 'at', data: { qq: '123' } },
    { type: 'text', data: { text: ' 你好' } },
    { type: 'image', data: { file: 'a.png', url: 'http://x/a.png' } },
    { type: 'record', data: { file: 'b.mp3' } },
    { type: 'reply', data: { id: '99' } },
  ]
  const tree = fromOneBot(segments)
  assert.deepEqual(tree.map((e) => e.type), ['at', 'text', 'image', 'voice', 'quote'])
  const back = toOneBot(tree)
  assert.equal(back[0].data.qq, '123')
  assert.equal(back[1].data.text, ' 你好')
  assert.equal(back[2].type, 'image')
  assert.equal(back[3].type, 'record')
  assert.equal(back[4].type, 'reply')
})

test('字符串也能直接当元素源', () => {
  assert.equal(stringify('你好'), '你好')
  assert.equal(toText('**加粗**'), '**加粗**')
})
