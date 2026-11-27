import net from 'node:net'

interface Logger { info(...args: unknown[]): void; debug(...args: unknown[]): void }

function portOpen(port: number, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise<boolean>(resolve => {
    const socket = new net.Socket()
    const finish = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

export function createWarmup(wsUrl: () => string, log: Logger) {
  let since = 0
  let lastLogAt = 0
  let probing = false
  let state = ''
  let current = { phase: '', label: '' }

  function setPhase(phase: string, label: string) {
    if (current.phase === phase) return
    current = { phase, label }
    if (since) log.info(`网关预热：${label}`)
  }

  return {
    state(next: string, detail?: string) {
      state = next
      const settled = next === 'connected' || next === 'stopped' || next === 'unconfigured'
      if (settled) {
        since = 0
        current = { phase: '', label: '' }
      } else if (!since) since = Date.now()
      const line = `QQ 网关：${next}${detail ? '（' + detail + '）' : ''}`
      const now = Date.now()
      if (settled || now - lastLogAt > 20_000) {
        log.info(line)
        lastLogAt = now
      } else log.debug(line)
    },
    async probe() {
      if (probing || !since || state === 'connected' || Date.now() - since > 300_000) return
      probing = true
      try {
        let port = 0
        try { port = Number(new URL(wsUrl()).port) || 0 } catch {}
        if (port && await portOpen(port)) setPhase('onebot-ready', `OneBot 已经在 ${port} 端口监听，正在握手`)
        else setPhase('onebot-wait', '正在等 OneBot 协议端监听')
      } catch (error) {
        setPhase('unknown', '正在等网关（' + (error as Error).message + '）')
      } finally {
        probing = false
      }
    },
    snapshot: () => ({ since, ...current }),
  }
}
