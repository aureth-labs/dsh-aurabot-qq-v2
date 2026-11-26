// 沙盒网页聊天室：一个页面、零依赖，打开就能发消息看回复。

export const SANDBOX_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>聊天沙盒</title>
<style>
  :root { color-scheme: dark; --fg:#e8e8ee; --dim:#9aa0aa; --bg:#14161a; --card:#1b1e24; --line:#2a2f38; --accent:#6ea8fe; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; gap:8px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line); background:var(--card); }
  header strong { font-weight:600; }
  header .grow { flex:1; }
  header .hint { color:var(--dim); font-size:12px; }
  main { max-width:820px; margin:0 auto; padding:14px; display:flex; flex-direction:column; gap:10px; height:calc(100vh - 52px); }
  #log { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px; }
  .row { display:flex; gap:8px; align-items:flex-start; }
  .row.out { flex-direction:row-reverse; }
  .who { color:var(--dim); font-size:12px; min-width:64px; text-align:right; }
  .bubble { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:7px 10px; max-width:70%; white-space:pre-wrap; word-break:break-word; }
  .row.out .bubble { border-color:#2f4a78; }
  .row.me .bubble { background:#1d3a63; border-color:#2f4a78; }
  form { display:flex; gap:8px; }
  input[type=text], select { background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
  input[type=text] { flex:1; }
  button { background:var(--accent); color:#0b1220; border:0; border-radius:8px; padding:8px 16px; font:inherit; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
</style>
</head>
<body>
<header>
  <strong>聊天沙盒</strong>
  <span class="hint" id="endpoint"></span>
  <span class="grow"></span>
  <span class="hint">断开后刷新页面即可重连</span>
</header>
<main>
  <div id="log"></div>
  <form id="send">
    <select id="kind">
      <option value="group">群聊</option>
      <option value="private">私聊</option>
    </select>
    <input id="name" type="text" value="沙盒用户" style="width:120px" title="昵称">
    <input id="text" type="text" placeholder="说点什么……" autocomplete="off">
    <button type="submit">发送</button>
  </form>
</main>
<script>
const log = document.getElementById('log')
const endpoint = document.getElementById('endpoint')
const form = document.getElementById('send')
const input = document.getElementById('text')
const kind = document.getElementById('kind')
const name = document.getElementById('name')
const esc = (s) => String(s ?? '')
const strip = (content) => String(content ?? '')
  .replace(/<img[^>]*>/gi, '[图片]')
  .replace(/<file[^>]*>[\\s\\S]*?<\\/file>/gi, '[文件]')
  .replace(/<voice[^>]*>[\\s\\S]*?<\\/voice>/gi, '[语音]')
  .replace(/<br\\s*\\/?>/gi, '\\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
function add(message) {
  if (!message) return
  const row = document.createElement('div')
  const out = message.direction === 'out'
  row.dataset.id = message.id
  row.className = 'row ' + (out ? 'out' : 'me')
  const who = document.createElement('div')
  who.className = 'who'
  who.textContent = out ? '机器人' : ''
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = out ? strip(message.content) : esc(message.content)
  row.append(who, bubble)
  log.append(row)
  log.scrollTop = log.scrollHeight
}
async function boot() {
  const state = await fetch('/_sandbox/state').then((r) => r.json()).catch(() => null)
  if (state) {
    endpoint.textContent = state.url || ''
    if (state.user?.name) name.value = state.user.name
    for (const m of state.messages || []) add(m)
  }
  const stream = new EventSource('/_sandbox/stream')
  stream.addEventListener('change', event => {
    const change = JSON.parse(event.data)
    const row = log.querySelector('[data-id="' + CSS.escape(change.id) + '"]')
    if (!row) return
    if (change.deleted) row.remove()
    else row.querySelector('.bubble').textContent = strip(change.content)
  })
  stream.onmessage = (event) => {
    try {
      const m = JSON.parse(event.data)
      add(m)
    } catch {}
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  const body = { text, kind: kind.value, userName: name.value.trim() || undefined }
  await fetch('/_sandbox/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
})
boot()
</script>
</body>
</html>`
