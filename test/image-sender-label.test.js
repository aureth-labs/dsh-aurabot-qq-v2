// #84：群聊图片块前必须带发送者，避免多人发图时人物串掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hubSource } from './hub-source.js'

const src = hubSource()

test('群聊图片内容带发送者昵称和 QQ', () => {
  assert.match(src, /发送者 \$\{msg\.nickname\}\(\$\{msg\.userId\}\)/)
  assert.match(src, /qq-\$\{msg\.userId\}-\$\{msg\.messageId\}/)
})
