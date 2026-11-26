interface Source {
  group_id?: number | string
  user_id?: number | string
  target_id?: number | string
  sender?: { user_id?: number | string }
}

export function messageSource(message: Source | undefined, selfId: string) {
  const group = String(message?.group_id ?? '')
  if (group && group !== '0') return { type: 'group' as const, id: group }
  const from = String(message?.sender?.user_id ?? message?.user_id ?? '')
  return { type: 'private' as const, id: from === selfId ? String(message?.target_id ?? '') : from }
}
