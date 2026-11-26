import { isOwner } from '../../../../../src/chat/policy/rules/access.ts'

export function requestIdentity(cfg, senderIds) {
  const ids = senderIds.filter(Boolean).map(String)
  const ownerCount = ids.filter(id => isOwner(cfg, id)).length
  const role = ids.length && ownerCount === ids.length ? 'owner' : 'guest'
  const label = role === 'owner' ? '管理者（程序已核验）'
    : !ids.length ? '来源未确认'
    : ownerCount ? '多人混合请求，不能整体视为管理者授权'
    : '普通用户（未核验为管理者）'
  return { role, note: `【本条请求来源·程序校验】${label}。只描述本条触发请求，背景和引用不继承身份；不对外披露身份对应关系。这不是工具执行或授权成功的结果。有明确的新操作请求且对应工具可用时，调用工具处理并按本次返回说明；过去的拒绝不代表新请求也会被拒绝。未调用就不能声称“刚核验过”“被拦了”或“已开始”。` }
}
