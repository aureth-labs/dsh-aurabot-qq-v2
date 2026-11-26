import { Schema, SchemaNode } from '../../../src/core/config/shape/schema.ts'

export const config = Schema.object({
  enabled: Schema.boolean().default(false).title('启用自驱引擎（实验性）')
    .description('按醒着时段回顾经历，决定是否行动。'),
  awakeFrom: Schema.natural().max(24).default(8).title('醒着窗口 从（点）')
    .description('回味只排在醒着窗口内；安静时段连点火都只攒不触发'),
  awakeTo: Schema.natural().max(24).default(23).title('醒着窗口 到（点）'),
  minIntervalMinutes: Schema.natural().min(5).max(2880).default(90).title('回味间隔下限（分钟）'),
  maxIntervalMinutes: Schema.natural().min(5).max(2880).default(240).title('回味间隔上限（分钟）')
    .description('间隔在区间内随机，并向主人更常回话的小时轻推'),
  maxPerDay: Schema.natural().max(20).default(3).title('单日回味上限')
    .description('填 0 表示不限次数。'),
  igniteCooldownMinutes: Schema.natural().min(1).max(720).default(45).title('心念点火冷却（分钟）')
    .description('技能沉淀/重要事件点燃回味的冷却，防事件风暴'),
  constraintRules: Schema.string().role('textarea').default('').title('强制约束规则（主人制定）')
    .description('每行一条。规划和执行行动时都要满足这些规则。'),
  autoConfirmOwner: Schema.boolean().default(false).title('发言类行动免确认')
    .description('关闭时，向主人发言的行动需要手动确认。'),
  confirmWindowMinutes: Schema.natural().min(5).max(10080).default(720).title('确认等待时长（分钟）'),
  responseWindowHours: Schema.natural().min(1).max(168).default(48).title('回应观察窗（小时）')
    .description('主动投递后这么多小时内主人没回应 = ignored（最响亮的负反馈）'),
  chillHalfLifeDays: Schema.natural().min(1).max(90).default(14).title('冷度半衰（天）'),
  chillParkThreshold: Schema.natural().min(1).max(10).default(3).title('自动 park 冷度阈值')
    .description('某个方向连续被冷落到这个冷度，90 天内不再主动触发（可恢复）'),
  chatMaxInputTokens: Schema.natural().min(512).max(65536).default(4096).title('对话轮输入预算（token）')
    .description('组织对话上下文时的输入上限。'),
  chatMaxOutputTokens: Schema.natural().min(128).max(8192).default(1024).title('对话轮输出预算（token）'),
  intentMaxInputTokens: Schema.natural().min(512).max(65536).default(8192).title('意图生成输入预算（token）'),
  intentMaxOutputTokens: Schema.natural().min(128).max(8192).default(1024).title('意图生成输出预算（token）'),
  gateMaxInputTokens: Schema.natural().min(512).max(65536).default(4096).title('自我把关输入预算（token）'),
  gateMaxOutputTokens: Schema.natural().min(128).max(8192).default(512).title('自我把关输出预算（token）'),
  reviewMaxInputTokens: Schema.natural().min(512).max(65536).default(4096).title('复盘输入预算（token）'),
  reviewMaxOutputTokens: Schema.natural().min(128).max(8192).default(512).title('复盘输出预算（token）'),
  maxSteps: Schema.natural().min(1).max(32).default(8).title('单行动单步数上限'),
  maxTasksActive: Schema.natural().min(1).max(16).default(8).title('同时进行的行动单数'),
  budgetActionsPerHour: Schema.natural().min(1).max(120).default(12).title('动作数 / 小时'),
  allowUserModules: Schema.boolean().default(true).title('允许写用户模块')
    .description('模块在宿主进程内运行，可以访问当前系统账户能够读取的文件。'),
  allowPython: Schema.boolean().default(true).title('允许跑 Python 脚本')
    .description('子进程执行、超时击杀、不继承插件的敏感环境变量（白名单 env）'),
  pythonBin: Schema.string().default('').title('Python 解释器路径')
    .description('留空 = 自动探测（会滤掉商店占位别名）；探测不到时填全路径'),
  scriptTimeoutMs: Schema.natural().min(1000).max(600000).default(120000).title('脚本超时（毫秒）'),
  takeover: Schema.boolean().default(false).title('接管浏览模块')
    .description('手动接管已启用的浏览模块，关闭时恢复接管前的配置。'),
  takenOver: new SchemaNode<Record<string, unknown>>('object').default({}).hidden(),
  presetIdOverride: Schema.boolean().default(false).hidden(),
  takeoverExtra: Schema.array(Schema.object({ id: Schema.string(), key: Schema.string(), scope: Schema.string() })).hidden(),
})
