// 内置模块：QQ 里的主人命令（/status、/diary、/remember……），默认关闭。
//
// 命令表本身属于这个模块，框架不预设任何指令：没打开它，框架一条指令都不认，
// 消息全部按普通聊天进管线；插件自己用 ctx.command() 注册的命令不受影响。

export default {
  id: 'commands',
  name: '主人命令',
  version: '1.0.0',
  description: 'QQ 里的 /status、/diary、/remember 等主人命令（默认关闭）；打开前框架不认任何内置指令，插件命令仍可用',
  apply() {
    return { enabled: true }
  },
}
