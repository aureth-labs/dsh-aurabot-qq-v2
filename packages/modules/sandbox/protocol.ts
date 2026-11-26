export interface SandboxMessage {
  id: string
  at: number
  channelId: string
  channelName: string
  userId: string
  userName: string
  content: string
  direction: 'in' | 'out'
}

export interface SandboxSnapshot {
  url: string
  user: { id: string; name: string }
  messages: SandboxMessage[]
}
