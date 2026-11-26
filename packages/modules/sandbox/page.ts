import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'

const source = import.meta.url.endsWith('.ts')
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/chat.css', ['chat.css', 'text/css']],
  ['/chat.js', [source ? 'chat.ts' : 'chat.js', 'text/javascript']],
])

export async function servePage(path: string, response: ServerResponse) {
  const asset = assets.get(path)
  if (!asset) return false
  const [file, type] = asset
  const data = await readFile(new URL('./web/' + file, import.meta.url), 'utf8')
  response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' })
  response.end(file.endsWith('.ts') ? stripTypeScriptTypes(data) : data)
  return true
}
