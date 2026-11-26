import { ID_RE } from '../loader.ts'

export const REGISTRY_URL = 'https://raw.githubusercontent.com/aureth-labs/dsh-aurabot-qq-market-dev/market/market.json'
export const PAGES_URL = 'https://aureth-labs.github.io/dsh-aurabot-qq-market-dev/market.json'
export const MAX_ZIP_BYTES = 25 * 1024 * 1024

export interface CommunityModuleEntry {
  id: string
  owner: string
  name: string
  version: string
  displayName?: string
  source: string
  minPluginVersion: string
  api: number
  requires?: string[]
  artifact: { url: string; size: number; sha256: string; mirror?: string }
}

export interface CommunityIndex {
  schema: 2
  generatedAt: string
  entries: CommunityModuleEntry[]
  revoked?: { id: string; versions: string[]; reason: string }[]
}

export function parseCatalog(value: unknown): CommunityIndex {
  const index = value as CommunityIndex
  if (index?.schema !== 2 || !Array.isArray(index.entries)) throw new Error('请选择 schema 2 的 V2 插件市场索引')
  const ids = new Set<string>()
  for (const entry of index.entries) {
    if (!entry || !ID_RE.test(entry.id) || !entry.id.startsWith(entry.owner + '/') || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.name)
      || typeof entry.version !== 'string' || typeof entry.minPluginVersion !== 'string' || !Number.isInteger(entry.api)
      || (entry.requires !== undefined && (!Array.isArray(entry.requires) || !entry.requires.every(id => typeof id === 'string')))) {
      throw new Error('市场条目的包名、依赖或版本不完整')
    }
    if (ids.has(entry.id)) throw new Error('市场包含重复包名 ' + entry.id)
    ids.add(entry.id)
    const artifact = entry.artifact
    if (!artifact || !/^https:\/\//i.test(artifact.url) || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || (artifact.mirror !== undefined && artifact.mirror !== 'artifacts/' + artifact.sha256 + '.zip')
      || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ZIP_BYTES) {
      throw new Error(entry.id + ' 的发行包信息无效')
    }
  }
  return index
}
