import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../../src/core/support/log/logger.ts'
import { createArchive } from '../../packages/modules/logger/archive.ts'

test('日志归档在订阅期写入，重启续写且只清理自己的文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aura-logs-'))
  const unrelated = join(directory, 'notes.txt')
  writeFileSync(unrelated, 'keep')
  utimesSync(unrelated, new Date(0), new Date(0))
  const logger = createLogger()
  const archive = () => createArchive(directory, () => 14, 80)
  logger.info('started')
  let sink = archive()
  const off = logger.onEntry(sink.write, { replayStartup: true })
  logger.child('a').warn('first warning')
  logger.debug('hidden')
  off()
  logger.warn('disabled')
  sink = archive()
  const stop = logger.onEntry(sink.write, { replayStartup: true })
  logger.child('a').error('second warning')
  stop()
  const lines = sink.files().flatMap(file => sink.tail(file.name))
  assert.equal(lines.length, 3)
  assert.equal(sink.files().length, 3)
  assert.equal(lines.filter(line => line.includes('started')).length, 1)
  assert.equal(lines.filter(line => /disabled|hidden/.test(line)).length, 0)
  assert.deepEqual(logger.recent(5, { level: 'warn', area: 'a' }).map(row => row.level), ['warn','error'])
  assert(existsSync(unrelated))
})
