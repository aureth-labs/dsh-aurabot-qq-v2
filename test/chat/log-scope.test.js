import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMessageLogScope, closeMessageLogsUnder } from '../../src/core/store/messages.ts'

test('共享库只在最后一个会话关闭时释放，删除人格不影响相邻目录', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-log-scope-'))
  t.after(() => {
    closeMessageLogsUnder(root)
    rmSync(root, { recursive: true, force: true })
  })
  const a = createMessageLogScope(),
    b = createMessageLogScope()
  const dir = join(root, 'me', 'chat'),
    neighbor = join(root, 'me-two', 'chat')
  const shared = a.open(dir),
    separate = b.open(neighbor)
  assert.equal(b.open(dir), shared)
  shared.append('today', { text: 'primary' })
  separate.append('today', { text: 'neighbor' })
  a.close()
  assert.throws(() => a.open(dir), /关闭/)
  assert.deepEqual(b.open(dir).read('today'), [{ text: 'primary' }])
  closeMessageLogsUnder(join(root, 'me'))
  assert.equal(b.open(neighbor), separate)
  assert.deepEqual(separate.days(), ['today'])
  assert.notEqual(b.open(dir), shared)
  assert.deepEqual(b.open(dir).read('today'), [{ text: 'primary' }])
  b.close()
})
