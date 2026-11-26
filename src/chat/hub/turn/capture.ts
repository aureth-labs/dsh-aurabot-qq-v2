// 模拟测试：跑一段 fn，把期间发出去的消息都记下来不真发，返回 { result, sent }。
// 结束后给 sent 打上 closed 标记，防止后续异步链继续往已结束的采集里塞。

export interface CaptureDeps {
  captureStore: { run: (sent: any[], fn: () => any) => any }
  simulationStore: { run: (flag: boolean, fn: () => any) => any }
  turnState: any
  sessionKey: (id: string) => string
}

export function createCapture({ captureStore, simulationStore, turnState, sessionKey }: CaptureDeps) {
  async function capture(fn: () => any, { simulate = false }: { simulate?: boolean } = {}) {
    const sent: any[] = []
    const run = () => captureStore.run(sent, fn)
    try {
      const result = simulate ? await simulationStore.run(true, run) : await run()
      return { result, sent }
    } finally {
      Object.defineProperty(sent, 'closed', { value: true, enumerable: false })
    }
  }

  /** 假装这个会话这一轮是谁在说话（工具里的「主人才能用」靠它判断）。 */
  function simulateTurn(sessionId: string, senders: string[]) {
    turnState.set(sessionKey(sessionId), { lastTurn: -1, text: '', senders: new Set(senders.map(String)) })
  }

  return { capture, simulateTurn }
}
