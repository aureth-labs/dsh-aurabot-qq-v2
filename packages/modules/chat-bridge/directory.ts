import type { BotLike, GuildMember } from '../../../src/types/adapter/bot.ts'
import type { AreaLogger } from '../../../src/core/support/log/logger.ts'

type CacheEntry<T> = { expires: number; result: Promise<T> }
interface Account {
  guilds: Map<string, CacheEntry<GuildMember[]>>
  friends?: CacheEntry<Set<string>>
  friendIds: Set<string>
}

export function createDirectory(botOf: () => BotLike | undefined, log: Pick<AreaLogger, 'debug'>) {
  const accounts = new WeakMap<BotLike, Account>()
  function account(bot: BotLike) {
    let state = accounts.get(bot)
    if (!state) {
      state = { guilds: new Map(), friendIds: new Set() }
      accounts.set(bot, state)
    }
    return state
  }

  async function membersOf(guildId: string | number): Promise<GuildMember[]> {
    const bot = botOf()
    if (!bot) return []
    const guild = String(guildId)
    const cache = account(bot).guilds
    const old = cache.get(guild)
    if (old && old.expires > Date.now()) {
      const members = await old.result
      return bot === botOf() ? members : []
    }
    const result = bot.getUserList(guild).catch(error => {
      log.debug('获取成员列表失败', String(error))
      return old?.result ?? []
    })
    cache.set(guild, { expires: Date.now() + 600_000, result })
    const members = await result
    return bot === botOf() ? members : []
  }

  async function userName(userId: string, guildId?: string) {
    const bot = botOf()
    if (!bot) return ''
    if (guildId) {
      const member = (await membersOf(guildId)).find(m => m.user.id === userId)
      if (member) return member.nick || member.user.name || member.user.nick || ''
    }
    const user = await bot.getUser(userId)
    return bot === botOf() ? user.name || user.nick || '' : ''
  }

  async function refreshFriends() {
    const bot = botOf()
    if (!bot) return
    const state = account(bot)
    if (!state.friends || state.friends.expires <= Date.now()) {
      const result = bot.getFriendList().then(friends => new Set(friends.map(friend => friend.id))).catch(error => {
        log.debug('获取好友列表失败', String(error))
        return state.friendIds
      })
      state.friends = { expires: Date.now() + 300_000, result }
    }
    state.friendIds = await state.friends.result
  }

  return {
    membersOf, userName, refreshFriends,
    isFriend(id: string) {
      const bot = botOf()
      return Boolean(bot && accounts.get(bot)?.friendIds.has(id))
    },
  }
}
