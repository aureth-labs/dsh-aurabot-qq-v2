import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { messageLogOf } from '../../src/core/store/messages.ts'

/** 根目录下的聊天流水库：`chatlog/` 与 `persona-data/<id>/chatlog/`。 */
function dirsOf(root) {
  const dirs = []
  const add = (dir) => {
    if (existsSync(dir)) dirs.push(dir)
  }
  add(join(root, 'chatlog'))
  const personas = join(root, 'persona-data')
  if (existsSync(personas)) {
    for (const name of readdirSync(personas)) add(join(personas, name, 'chatlog'))
  }
  return dirs
}

export function rowsOf(root) {
  const rows = []
  for (const dir of dirsOf(root)) {
    const store = messageLogOf(dir)
    for (const day of store.days()) rows.push(...store.read(day))
  }
  return rows
}

/** 只读根目录（`chatlog/`）的流水，不含任何人格子目录。 */
export function rowsOfRoot(root) {
  const dir = join(root, 'chatlog')
  if (!existsSync(dir)) return []
  const store = messageLogOf(dir)
  return store.days().flatMap((day) => store.read(day))
}

export function storeOf(root, persona) {
  const dir = persona ? join(root, 'persona-data', persona, 'chatlog') : join(root, 'chatlog')
  return messageLogOf(dir)
}
