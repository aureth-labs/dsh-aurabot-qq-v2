// S4 契约：默认写法是 h('text', { content })，坏 XML 只丢标签、不吞正文。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h, parse, stringify, select, normalize, toText, degrade, fromOneBot, toOneBot } from '../../../src/core/message/element/element.ts'

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

test('解析：孤立闭标签直接丢，正常回复一个字都不能少', () => {
  const tree = parse('</ACP>\n你好啊 很高兴第二次遇到你')
  assert.deepEqual(tree, [{ type: 'text', attrs: { content: '\n你好啊 很高兴第二次遇到你' } }])
  assert.equal(toText(tree), '\n你好啊 很高兴第二次遇到你')
})

test('解析：不认识的标签整块丢掉（连正文），后面的文字照常保留', () => {
  const tree = parse('<acp>这是别的框架的内部块</acp>之后')
  assert.equal(toText(tree), '之后')
  assert.equal(select(tree, 'acp').length, 0)
})

test('解析：不认识的标签没闭合，丢标签、把正文退回来', () => {
  // 未闭合时拿不准边界：误吞用户的正常回复比漏出一点内部块更糟
  const tree = parse('你好<acp>没收口的内容')
  assert.equal(toText(tree), '你好没收口的内容')
  assert.equal(select(tree, 'acp').length, 0)
})

test('解析：认识的标签没闭合，丢标签本体、保留正文', () => {
  const tree = parse('<voice>念这句话')
  assert.equal(toText(tree), '念这句话')
})

test('解析：<file>路径</file> 的正文就是 url', () => {
  const tree = parse('<file>file:///D:/demo/LICENSE</file>')
  assert.deepEqual(tree, [{ type: 'file', attrs: { url: 'file:///D:/demo/LICENSE' } }])
})

test('解析：<file url="…"/> 自闭合照旧', () => {
  const tree = parse('<file url="file:///x"/>')
  assert.deepEqual(tree, [{ type: 'file', attrs: { url: 'file:///x' } }])
})

test('解析：文字 + 文件混排（用户给的那个例子）', () => {
  const tree = parse('<text>好哦，文件给你递过来啦</text><file>file:///D:/demo/LICENSE</file>')
  assert.deepEqual(tree.map((e) => e.type), ['text', 'file'])
  assert.equal(toText(tree), '好哦，文件给你递过来啦')
  assert.equal(tree[1].attrs.url, 'file:///D:/demo/LICENSE')
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

test('降级：平台不支持 file 时换成一句人话，正文照常发', () => {
  const tree = [h.text('文件给你'), h.file('file:///D:/demo/LICENSE', 'LICENSE')]
  const out = degrade(tree, (capability) => capability !== 'file')

  assert.equal(toText(out), '文件给你[文件] LICENSE')
  assert.equal(select(out, 'file').length, 0)
})

test('降级：全支持时原样返回', () => {
  const tree = [h.text('a'), h.image('http://x/1.png')]
  assert.deepEqual(degrade(tree, () => true), normalize(tree))
})

test('降级：不支持的引用直接丢掉，不塞占位符', () => {
  const out = degrade([h.quote('42'), h.text('嗯')], (capability) => capability !== 'quote')

  assert.deepEqual(out.map((element) => element.type), ['text'])
  assert.equal(toText(out), '嗯')
})

test('降级：at 在纯文本平台变成 @名字', () => {
  const out = degrade([h.at('123', '小明')], () => false)
  assert.equal(toText(out), '@小明')
})

test('降级：图片 / 语音 / 视频 / 转发各有一句话', () => {
  const tree = [h.image('http://x/1.png'), h.voice('http://x/2.mp3'), h.video('http://x/3.mp4'), h.forward([h.text('一')])]
  const out = degrade(tree, () => false)
  assert.equal(toText(out), '[图片][语音][视频][合并转发]')
})
