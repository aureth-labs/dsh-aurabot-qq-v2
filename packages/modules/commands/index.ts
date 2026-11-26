// 内置模块：QQ 里的主人命令（/silent、/model、/sing……）。
//
// 命令表本身属于这个模块，框架不预设任何指令：关掉它，框架就一条指令都不认，
// 消息全部按普通聊天进管线；插件自己用 api.command() 注册的命令不受影响。

export default {
  id: 'commands',
  name: '主人命令',
  version: '1.0.0',
  description: 'QQ 里的 /silent、/model、/sing 等主人命令；关掉后框架不认任何指令，插件命令仍可用',
  setup() {
    return { enabled: true }
  },
}
