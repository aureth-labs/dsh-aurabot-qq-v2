import type { OneBotSegment } from '../cq.ts'

interface Step {
  action: string
  params: Record<string, unknown>
}

export function planPokes(action: string, target: { user_id?: string; group_id?: string }, segments: OneBotSegment[]): Step[] {
  const steps: Step[] = []
  let message: OneBotSegment[] = []
  const flush = () => {
    if (message.length) steps.push({ action, params: { ...target, message } })
    message = []
  }
  for (const segment of segments) {
    if (segment.type !== 'poke') {
      message.push(segment)
      continue
    }
    const id = String(segment.data.id || target.user_id || '')
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error('戳一戳需要有效的 QQ 用户 ID')
    if (target.user_id && target.user_id !== id) throw new Error('私聊只能戳当前接收人')
    flush()
    steps.push({ action: 'send_poke', params: { user_id: Number(id), ...(target.group_id ? { group_id: target.group_id } : {}) } })
  }
  flush()
  return steps
}
