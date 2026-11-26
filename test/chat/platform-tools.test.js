import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { roomMemory } from '../../packages/modules/memory/rooms.ts'
import { createDialogue, sessionOwner } from '../../src/core/llm/session-turn.ts'
import { runToolTurn } from '../../src/core/llm/tool-turn.ts'
import { cleanupDir } from '../helpers/cleanup.js'

test('平台记忆重启后保留，读取和遗忘均按会话、人格和发言人隔离', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rooms-'))
  const open = () =>
    roomMemory(
      () => join(root, 'rooms.sqlite'),
      () => true,
    )
  let service = open()
  t.after(() => {
    service.close()
    cleanupDir(root)
  })
  const w = { room: '["matrix","work","group","88"]', persona: '雪', user: '42' }
  const tool = (w, name) => service.tools(w).find((t) => t.name === 'memory_' + name)
  const { id } = tool(w, 'remember').execute({ text: '我喜欢山城的雾' })
  service.close()
  service = open()
  for (const other of [
    { ...w, persona: '晴' },
    { ...w, user: '77' },
    { ...w, room: '["discord","work","group","88"]' },
  ]) {
    assert.deepEqual(service.recall(other, '山城', 3), [])
    assert.equal(tool(other, 'forget').execute({ id }).removed, false)
  }
  assert.equal(service.recall(w, '山城', 3)[0].id, id)
  assert.equal(tool(w, 'forget').execute({ id }).removed, true)
})

test('模型请求在执行前重验主人与可用工具，重复编号只执行一次', async () => {
  for (const revoke of [false, true]) {
    let owner = true,
      calls = 0,
      claims = 0
    const session = {
      target: { platform: 'matrix', botId: 'home', type: 'private', id: '42' },
      isPrivate: true,
      type: 'private',
      userId: '42',
      channelId: 'dm',
    }
    const tool = {
      name: 'change',
      description: 'test',
      parameters: { type: 'object' },
      execute() {
        assert(sessionOwner('actual'))
        calls++
        return { ok: true }
      },
    }
    const model = {
      async *stream(request) {
        if (request.messages.length === 0) {
          assert.deepEqual(
            request.tools.map((t) => t.name),
            ['change'],
          )
          if (revoke) owner = false
          const block = { type: 'tool-call', id: 'c', name: 'change', arguments: '{}' }
          yield { type: 'block-end', index: 0, block }
          yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { test: true } }
        } else if (request.messages.length === 2 && !revoke) {
          assert.deepEqual(request.messages[0].source.replayState, { test: true })
          yield { type: 'block-end', index: 0, block: request.messages[0].content[0] }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else {
          assert.equal(request.messages.at(-1).isError, revoke)
          yield { type: 'text-delta', text: '完成' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      },
    }
    const dialogue = createDialogue({
      isOwner: () => owner,
      tools: (where) => (where.level === 'full' ? [tool] : []),
      generate: (_, turn) =>
        runToolTurn(model, { model: 'stub', provider: 'stub', messages: [] }, turn, () => {}),
    })
    assert.equal(
      await dialogue.respond(
        session,
        { sessionId: 'actual' },
        () => true,
        () => [],
        () => {
          claims++
          return true
        },
      ),
      '完成',
    )
    assert.equal(calls, revoke ? 0 : 1)
    assert.equal(claims, calls)
    assert.equal(sessionOwner('actual'), undefined)
  }
})
