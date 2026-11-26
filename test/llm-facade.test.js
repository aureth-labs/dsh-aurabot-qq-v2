// ctx.llm：润色 / 改写 / 摘要的契约（失败退回原文、摘要不超字数上限）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLlmFacade } from '../src/core/llm/facade.ts'

test('polish 把 system 与原文一起交给模型，返回模型输出', async () => {
  const calls = []
  const llm = createLlmFacade({
    ask: async (options) => {
      calls.push(options)
      return '  改好的句子。  '
    },
  })

  assert.equal(await llm.polish('改好的句子'), '改好的句子。')
  assert.equal(calls.length, 1)
  assert.match(calls[0].system, /校对/)
  assert.equal(calls[0].text, '改好的句子')
})

test('rewrite 带 instruction 时把要求放在正文前面', async () => {
  const calls = []
  const llm = createLlmFacade({
    ask: async (options) => {
      calls.push(options)
      return '更口语的说法'
    },
  })

  assert.equal(await llm.rewrite('原文', { instruction: '说得口语一点' }), '更口语的说法')
  assert.match(calls[0].text, /^说得口语一点\n\n---\n原文$/)
})

test('模型报错时退回原文，不把消息卡死', async () => {
  const warnings = []
  const llm = createLlmFacade({
    ask: async () => {
      throw new Error('上游 500')
    },
    log: { warn: (...args) => warnings.push(args.join(' ')) },
  })

  assert.equal(await llm.polish('原样发出去'), '原样发出去')
  assert.equal(await llm.rewrite('原样发出去'), '原样发出去')
  assert.equal(await llm.summarize('很短'), '很短')
  assert.equal(warnings.length, 2)
})

test('summarize 不超过字数上限，且短文本不调模型', async () => {
  let calls = 0
  const llm = createLlmFacade({
    ask: async () => {
      calls++
      return '这是一段明显超过上限的摘要内容'
    },
  })

  assert.equal(await llm.summarize('短'), '短')
  assert.equal(calls, 0)

  const long = '长'.repeat(500)
  const result = await llm.summarize(long, { maxLength: 8 })
  assert.equal([...result].length, 8)
  assert.equal(calls, 1)
})

test('空输入直接返回空串，不打模型', async () => {
  let calls = 0
  const llm = createLlmFacade({
    ask: async () => {
      calls++
      return '不该被用到'
    },
  })

  assert.equal(await llm.polish('   '), '')
  assert.equal(await llm.rewrite(''), '')
  assert.equal(await llm.summarize('  '), '')
  assert.equal(calls, 0)
})
