// 跨平台对话：非 OneBot 平台的消息走到管线末端后，由这里问一次模型并回发。
export const config = {
  defaults: {
    enabled: true,
    mentionOnly: true,
    history: 12,
    systemPrompt: '',
  },
  settings: [
    { key: 'enabled', type: 'boolean', label: '启用跨平台对话' },
    { key: 'mentionOnly', type: 'boolean', label: '只回被 @ 的消息（沙盒不受限）' },
    { key: 'history', type: 'number', label: '每个会话保留多少条上下文' },
    { key: 'systemPrompt', type: 'textarea', label: '附加系统提示（留空用默认）' },
  ],
}
