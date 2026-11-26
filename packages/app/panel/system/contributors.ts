export function registerContributors({ http, log }) {
  const { route } = http

  // 「关于」页的贡献者名单：GitHub contributors（有 token 就用，1 小时缓存）；读不到就让前端回退到内置名单
  let aboutContribAt = 0
  let aboutContribValue = null
  route('/about/contributors', async () => {
    if (aboutContribValue && Date.now() - aboutContribAt < 3600_000) return { ok: true, ...aboutContribValue }
    try {
      const token = String(process.env.AURABOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim()
      const r = await fetch(
        'https://api.github.com/repos/aureth-labs/dsh-aurabot-qq/contributors?per_page=100&anon=0',
        {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'aurabot-qq-panel',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(8000),
        },
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const list = ((await r.json()) as any[])
        .filter((x) => x && x.login)
        .map((x) => ({ login: x.login, contributions: Number(x.contributions) || 0 }))
      aboutContribValue = { list, source: 'github', repo: 'aureth-labs/dsh-aurabot-qq', at: Date.now() }
      aboutContribAt = Date.now()
      return { ok: true, ...aboutContribValue }
    } catch (error) {
      log.debug?.('读不到贡献者名单：', error.message)
      return { ok: false, message: error.message, list: [] }
    }
  })
}
