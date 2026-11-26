import { modelReasoning, modelVision } from './index.ts'

export async function listHostModels(dsh) {
  const llm = dsh.llm ?? dsh.get('llm')
  const rows = []
  for (const entry of llm?.listProviders() ?? []) {
    const provider = typeof entry === 'string' ? entry : entry.provider || entry.id || entry.name
    if (!provider) continue
    try {
      for (const item of await llm.listModels(provider) || []) {
        const model = item.id || item.model
        if (model) rows.push({ provider, model, name: item.name || model, reasoning: await modelReasoning(dsh, provider, model), vision: await modelVision(dsh, provider, model) })
      }
    } catch { /* 其他供应商仍可用于对话。 */ }
  }
  return rows
}
