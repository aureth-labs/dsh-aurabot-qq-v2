import { OneBotBot } from './bot.ts'
import { createOneBotClient } from './client.ts'
import type { VoiceResolver } from '../../../../../src/core/message/element/voice-element.ts'

interface ConnectionOptions {
  id?: string
  expandForwards?: boolean
  endpoint(): { httpUrl: string; wsUrl: string; httpToken: string; wsToken: string }
  expectedAccount(): string | undefined
  enabled(): boolean
  speak?: VoiceResolver
  log: { info(message: string): void; warn(message: string, detail?: unknown): void; debug(message: string): void }
  onState(state: string, detail?: string): void
  onOnline(bot: OneBotBot): void
  onOffline(bot: OneBotBot, reason: string): void
  onEvent(event: unknown): void
  onReady?(): Promise<void>
}

export function createOneBotConnection(options: ConnectionOptions) {
  let generation = 0
  let boundAccount: string | undefined
  let verified = false
  let wrongAccount = ''
  let login = { uin: '', nickname: '', at: 0 }
  let pending: unknown[] = []

  const client = createOneBotClient({
    endpoint: options.endpoint,
    log: options.log,
    onEvent(event) {
      if (verified) return options.onEvent(event)
      if (client.state !== 'connected') return
      if (pending.length === 200) pending.shift()
      pending.push(event)
    },
    onState(state, detail) {
      const current = ++generation
      pending = []
      if (state === 'connected') {
        void verify(current).catch(error => options.log.warn('处理登录事件失败', error))
      } else {
        const wasVerified = verified
        verified = false
        login = { uin: '', nickname: '', at: login.at }
        bot.markOffline(state)
        if (wasVerified) options.onOffline(bot, state)
      }
      options.onState(state, detail)
    },
  })
  const bot = new OneBotBot({
    id: options.id,
    expandForwards: options.expandForwards,
    isConnected: () => client.isConnected(),
    speak: options.speak,
    log: options.log,
    call: (action, params, opts) => options.enabled()
      ? client.call(action, params, opts)
      : Promise.resolve({ ok: false, simulated: true }),
  })

  async function verify(current: number) {
    let info: { user_id?: string | number; nickname?: string }
    try {
      info = await client.call('get_login_info', {}, { timeoutMs: 10_000 })
    } catch (error) {
      if (current === generation) {
        options.log.warn('核对登录账号失败', error)
        client.stop()
      }
      return
    }
    if (current !== generation) return
    const uin = String(info?.user_id ?? '')
    const expected = options.expectedAccount() ?? boundAccount
    if (!uin || (expected !== undefined && uin !== expected)) {
      wrongAccount = uin
      client.stop()
      return
    }
    boundAccount = uin
    login = { uin, nickname: info.nickname || '', at: Date.now() }
    wrongAccount = ''
    verified = true
    bot.setSelfId(uin)
    bot.markOnline()
    options.onOnline(bot)
    for (const event of pending.splice(0)) {
      if (current !== generation) return
      options.onEvent(event)
    }
    if (current === generation) await options.onReady?.()
  }

  return {
    client, bot,
    get verified() { return verified },
    get login() { return login },
    get wrongAccount() { return wrongAccount },
    clearMismatch() { wrongAccount = '' },
  }
}
