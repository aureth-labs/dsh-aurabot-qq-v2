// 聊天沙盒的配置：面板按这份声明直接渲染，不用另写前端组件。
export const config = {
  defaults: {
    host: '127.0.0.1',
    port: 5140,
    token: '',
    selfId: 'sandbox-bot',
    selfName: '沙盒机器人',
    platform: 'sandbox',
    defaultUserId: '',
    defaultUserName: '',
    autoConnect: true,
  },
  settings: [
    { key: 'host', type: 'string', label: '监听地址（默认只监听本机）' },
    { key: 'port', type: 'number', label: '端口' },
    { key: 'token', type: 'password', label: '访问令牌（留空则不校验）' },
    { key: 'selfName', type: 'string', label: '机器人昵称' },
    { key: 'platform', type: 'string', label: '平台名（进 Target.platform）' },
    { key: 'defaultUserName', type: 'string', label: '网页里默认的昵称（留空用主人名）' },
    { key: 'autoConnect', type: 'boolean', label: '自动用 Satori 适配器连上自己' },
  ],
}
