import { maskPools, restorePoolKeys } from '../../voice/tts/key-pool.ts'
import type { RawPools } from '../../voice/tts/key-pool.ts'
import { normalize } from './state/normalize.ts'
import { allSecrets, getAt, HINTED, parentOf } from './state/secrets.ts'
import { deepMerge, isObj } from './state/shared.ts'
import type { AurabotConfig, ImageFallback } from './shape/defaults.ts'
import type { RawConfig } from './state/shared.ts'

/** 给面板看的版本：密码 / token 不回传原文，只告诉有没有填。 */
export function publicConfig(cfg) {
  const c = structuredClone(cfg)
  maskPools(c.voice?.keyPools)
  // vector.mode 回传面板（#520）：面板切到「在线服务」后重载又回退「本地模型」。
  // 现在 mode 是 normalize 里直接赋值的常规字段，structuredClone 已能带上；这行留着兜住
  // 旧配置里从派生值过来的情形，不额外造字段。
  if (c.memory?.vector && cfg?.memory?.vector?.mode) c.memory.vector.mode = cfg.memory.vector.mode
  delete c.ownerAuthorization
  // 面板要能显示/修改「单个聊天的思考档位」（chatEfforts），所以回传这份配置；
  // 它本来就不含敏感内容，只是「聊天 → 模型 → 档位」的映射。
  for (const [g, k] of HINTED) c[g][`${k}Hint`] = c[g][k] ? '…' + String(c[g][k]).slice(-4) : ''
  for (const path of allSecrets()) {
    const p = parentOf(c, path, false)
    if (!p) continue
    const k = path.at(-1)
    p[`${k}Set`] = Boolean(p[k])
    p[k] = ''
  }
  for (const e of c.imageGen.fallbacks || []) { e.apiKeySet = Boolean(e.apiKey); e.apiKey = '' }
  return c
}

/** 面板保存时：没改的密码字段（空串）保留原值。 */
export function mergeFromPanel (current: AurabotConfig, incoming: RawConfig | null | undefined): AurabotConfig {
  const next = deepMerge<AurabotConfig>(current, incoming || {})
  const incomingVoice = isObj(incoming?.voice) ? incoming.voice : {} as RawConfig
  if (incomingVoice.keyPools) {
    next.voice.keyPools = { ...next.voice.keyPools }
    restorePoolKeys(next.voice.keyPools, current.voice?.keyPools, incomingVoice.keyPools as RawPools)
  }
  // 面板局部保存不带 vector 时用上一份 mode 补回，否则 baseUrl 会把用户选中的 local
  // 在 normalize 里重新推成 remote（#520）。
  const incomingVector = isObj(incoming?.memory) && isObj(incoming.memory.vector) ? incoming.memory.vector : {} as RawConfig
  const incomingMode = incomingVector.mode
  const keepMode = incomingMode === 'local' || incomingMode === 'remote'
    ? incomingMode
    : (current?.memory?.vector?.modeExplicit === true ? current.memory.vector.mode : '')
  if (next.memory?.vector && keepMode) next.memory.vector.mode = keepMode
  // 面板明确带了非空 chatEfforts（面板上改过单个聊天的档位）就以面板为准；
  // 没带或带的是空对象（旧版面板 / 面板没动过）时保留当前值——QQ 里 /effort 设过的不被清掉。
  const incomingEfforts = incoming?.chatEfforts
  next.chatEfforts = incomingEfforts && typeof incomingEfforts === 'object' && Object.keys(incomingEfforts).length
    ? incomingEfforts as AurabotConfig['chatEfforts']
    : current.chatEfforts
  for (const path of allSecrets()) {
    const v = getAt(incoming || {}, path)
    const p = parentOf(next, path, v !== undefined)
    if (!p) continue
    const k = path.at(-1)
    if (v === null) p[k] = '' // 明确传 null = 清空
    else if (v === undefined || v === '') p[k] = getAt(current, path) ?? ''
    delete p[`${k}Set`]
    delete p[`${k}Hint`]
  }
  if (isObj(incoming?.imageGen) && Array.isArray(incoming.imageGen.fallbacks)) {
    const old = new Map((current.imageGen?.fallbacks || []).map(e => [e.id, e]))
    next.imageGen.fallbacks = (incoming.imageGen.fallbacks as Array<Partial<ImageFallback> | null>).map(e => ({
      id: e?.id ?? '',
      provider: e?.provider ?? '',
      baseUrl: e?.baseUrl ?? '',
      model: e?.model ?? '',
      apiKey: e?.apiKey === null ? '' : (e?.apiKey || old.get(e?.id ?? '')?.apiKey || ''),
    }))
  }
  // 主人的抖音 secUid / uid / 昵称只能由「核对」写入，面板存配置时保留原值
  next.douyin.owner = { ...next.douyin.owner, ...Object.fromEntries(['secUid', 'uid', 'nickname', 'confirmedInput'].map((k) => [k, current.douyin?.owner?.[k] ?? ''])) }
  // 联动密钥只由插件生成，面板不能改
  next.bridge.token = current.bridge?.token || ''
  // B 站：只改了其中一个值时，另一个保留；整串粘进来的会在 normalize 里拆开
  const incomingBili = isObj(incoming?.bili) ? incoming.bili : {} as RawConfig
  if (incomingBili.sessdata || incomingBili.biliJct) next.bili.cookie = ''
  const incomingGroup = isObj(incoming?.group) ? incoming.group : {} as RawConfig
  if (incomingGroup.overrides) next.group.overrides = incomingGroup.overrides as AurabotConfig['group']['overrides']
  // 按聊天选模型：两张表整张替换（deepMerge 会让删掉的条目又回来）
  const incomingChatModels = isObj(incoming?.chatModels) ? incoming.chatModels : {} as RawConfig
  if (incomingChatModels.privates) next.chatModels.privates = incomingChatModels.privates as AurabotConfig['chatModels']['privates']
  if (incomingChatModels.groups) next.chatModels.groups = incomingChatModels.groups as AurabotConfig['chatModels']['groups']
  if (isObj(incoming?.allow)) next.allow = { ...current.allow, ...incoming.allow }
  return normalize(next)
}
