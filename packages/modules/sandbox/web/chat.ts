import type { SandboxMessage, SandboxSnapshot } from '../protocol.ts'

const log = document.querySelector<HTMLElement>('#log')!
const form = document.querySelector<HTMLFormElement>('#send')!
const input = form.querySelector<HTMLInputElement>('#text')!
const kind = form.querySelector<HTMLSelectElement>('#kind')!
const nick = form.querySelector<HTMLInputElement>('#name')!
const button = form.querySelector<HTMLButtonElement>('button')!
const status = document.querySelector<HTMLElement>('#status')!
const endpoint = document.querySelector<HTMLElement>('#endpoint')!
const rows = new Map<string, HTMLElement>()

function messageText(message: SandboxMessage) {
  if (message.direction === 'in') return message.content
  const xml = new DOMParser().parseFromString('<message>' + message.content + '</message>', 'application/xml')
  if (xml.querySelector('parsererror')) return message.content
  for (const node of xml.querySelectorAll('img,image,file,voice,audio,video,br')) {
    const labels: Record<string, string> = { img: '[图片]', image: '[图片]', file: '[文件]', voice: '[语音]', audio: '[音频]', video: '[视频]', br: '\n' }
    node.replaceWith(labels[node.tagName])
  }
  for (const text of xml.querySelectorAll('text[content]')) text.replaceWith(text.getAttribute('content') ?? '')
  return xml.documentElement.textContent || ''
}

function append(message: SandboxMessage) {
  const row = document.createElement('div')
  row.className = 'row ' + (message.direction === 'out' ? 'out' : 'me')
  const who = document.createElement('span')
  who.className = 'who'
  who.textContent = message.userName
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = messageText(message)
  row.append(who, bubble)
  const previous = rows.get(message.id)
  if (previous) previous.replaceWith(row)
  else log.append(row)
  rows.set(message.id, row)
}

const stream = new EventSource('/_sandbox/stream')
stream.addEventListener('snapshot', event => {
  const state: SandboxSnapshot = JSON.parse(event.data)
  log.replaceChildren()
  rows.clear()
  endpoint.textContent = state.url
  if (!nick.value) nick.value = state.user.name
  for (const message of state.messages) append(message)
  log.scrollTop = log.scrollHeight
})
stream.onopen = () => { status.textContent = '已连接' }
stream.onerror = () => { status.textContent = '连接中断，正在重连' }
stream.onmessage = event => {
  append(JSON.parse(event.data))
  log.scrollTop = log.scrollHeight
}
stream.addEventListener('change', event => {
  const change: { message: SandboxMessage; deleted: boolean } = JSON.parse(event.data)
  if (!change.deleted) return append(change.message)
  rows.get(change.message.id)?.remove()
  rows.delete(change.message.id)
})

form.addEventListener('submit', async event => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text || button.disabled) return
  button.disabled = true
  try {
    const response = await fetch('/_sandbox/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, kind: kind.value, userName: nick.value.trim() || undefined }) })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    if (input.value.trim() === text) input.value = ''
    status.textContent = '已发送'
  } catch {
    status.textContent = '发送失败，请重试'
  } finally {
    button.disabled = false
    input.focus()
  }
})
