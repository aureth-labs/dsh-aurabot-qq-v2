// 配置的唯一形状来源：默认值 + 由它派生的类型。
// 这里只放数据与类型，不放读写与归一化（那些在 ./index.ts）。

import type { KeyPools } from '../../../voice/tts/key-pool.ts'
import { DEFAULT_GROUP_POLICY } from '../../../chat/policy/rules/group.ts'
import { DEFAULT_TIER_DAYS } from '../../../features/memory/query/rules.ts'
import { defaultEmotions } from '../../../features/mood/emotions.ts'
import { DELEGATED_COMMANDS } from '../../../chat/commands/delegated-commands.ts'
import type { MemberFilterRule } from '../../../chat/inbound/filter/member-filter.ts'

/** 面板「服务地址」下拉里用户自添的一项。 */
export interface BaseUrlOption { name: string; url: string }
/** 生图兜底渠道（面板可增删）。 */
export interface ImageFallback { id: string; provider: string; baseUrl: string; apiKey: string; apiKeySet?: boolean; model: string }
/** 生图自定义接法的参数项：值里能用 {prompt} {model} {size} 等占位符。 */
export interface ImageCustomParam { key: string; value: string }
/** 小黑盒「每天每篇」的排期项：空字段 = 这一篇走全局设置。 */
export interface HeyboxDailyPost { style: string; topic: string; hashtags: string[]; hashtagsText: string; wordsMin: number; wordsMax: number; hint: string }
/** 面板记住的小偏好（键由面板自己决定）。 */
export type TabPrefs = Record<string, unknown>
/** 单个模块的开关项。 */
export interface ModuleSwitch {
  enabled?: boolean
  useBuiltin?: boolean
  /** 替换内置模块时记下的内置版本：内置更新了就提醒一声。 */
  forkedFrom?: string
}
/** 模块开关表：{ 模块id: {...} }，没写的算开着。 */
export type ModuleSwitchTable = Record<string, ModuleSwitch>
/** 自己写的模块的设置：{ 模块id: {...} }。 */
export type ModuleSettings = Record<string, Record<string, unknown>>
/** 自定义渠道费率：{ 渠道: { 完整模型名: 费率 } }。 */
export type UsagePricing = Record<string, Record<string, number>>
/** 按工作区单独覆盖的上报开关。 */
export interface NoticeWorkspace { approval?: boolean; question?: boolean }

export const DEFAULTS = {
  enabled: false, // 总开关：关着一句都不发
  dryRun: true, // 试运行：只记日志不真发
  debug: false, // 调试：不真发 + 不写记忆/流水，只在日志里看（和试运行互斥）
  // 入站管线（开发中配置项）：指令前缀 null = 无前缀；中间件默认排在指令之后、模型之前
  commandPrefixes: [null, '/'],
  middlewareAfterCommand: false, // 指令消费后要不要继续走中间件（默认 false，和 Koishi 一致）
  setupDone: false, // 首次使用向导走完了没有
  communityMigrated: {} as Record<string, string>, // 搬到社区库的模块处理过没有（id → installed / skipped / kept），只处理一次
  botQQ: '', // 机器人 QQ 号（向导里填）
  ownerQQ: '', // 主人 QQ 号（向导里填）
  ownerName: '主人',
  ownerLevel: 'full', // full | social | chat
  approvalNotify: true, // DSH 要授权时把请求发到主人私聊
  // 什么情况往主人 QQ 上报：enabled 是总开关，approval = 工具要授权，question = 她要向人提问选选项。
  // workspaces 按工作区单独覆盖：{ "<工作区路径>": { approval?: bool, question?: bool } }，没写的项跟随总开关。
  notice: { enabled: true, approval: true, question: true, windowSec: 8, workspaces: {} as Record<string, NoticeWorkspace> },
  qqApi: { enabled: true }, // 她能用 qq_api_call 调 QQ 接口：别人只能查当前群，写操作只听主人
  approvalViaQQ: true, // 主人私聊会话要授权时，在 QQ 回复「确认」直接批准这一次
  approvalTimeoutSec: 300, // 等主人回复「确认」多久（秒）：默认 300，范围 30 ~ 1800
  profilePerms: { qqNickname: 'owner', qqSignature: 'owner', qqAvatar: 'owner', biliSign: 'owner', biliAvatar: 'owner', biliComment: 'owner', qqFriendRequest: 'owner', whitelist: 'owner', douyinBrowse: 'owner', douyinLike: 'owner', douyinComment: 'owner', douyinShareOwner: 'owner', douyinDm: 'owner' }, // 改资料类操作（含抖音浏览 / 点赞 / 评论 / 分享）的权限：off 关 / owner 仅主人私聊 / all 所有人。抖音项默认仅主人，总开关默认关
  capabilityAllow: { image: [] as string[], song: [] as string[], video: [] as string[] },
  commandAllow: Object.fromEntries(DELEGATED_COMMANDS.map((name) => [name, [] as string[]])) as Record<string, string[]>,
  longTasks: true, // 长任务模式：主人私聊（完整权限）额外挂 dsh-tool-jobs + dsh-tool-schedule，会多一点工具定义、稍慢
  // 后台子智能体委派（默认关）：模块用 hub.runSubagentTurn 派子智能体时，正常要求「主人开口」的来源；
  // 定时任务这类没人应答的场合，只有打开这个开关才允许派活。关着 = 一律拒绝（一审 #177 的审批策略）。
  subagentBackground: false,
  allow: { private: [] as string[], groups: [] as string[] }, // 主人永远能私聊，不用写进白名单
  // OneBot v11 连接：NapCat、LLOneBot、Lagrange、Docker 里的协议端都行，插件只连接。
  onebot: { httpUrl: '', wsUrl: '', httpToken: '', wsToken: '' },
  workspaceDir: '', // QQ 会话放在哪个文件夹（DSH 里的「Aurabot · QQ」工作区）；留空 = 默认（用户目录下 Aurabot\\qq-chats）
  // 发文件（#52）：默认开但限制很多——她只能把 QQ 工作区（workspaceDir）和 dirs 里列的目录中的文件当文件发出去；
  // 单个文件有大小上限；主人私聊里能触发，群里只在主人开口那一轮能触发（可以发给白名单里的人和群）。日志里会记下发了什么。
  // imageByPath（#169）：本地图片先按路径直发，被网关明确拒绝才改用 base64；网关和 NapCat 没共享挂载时会自动回退。
  files: { enabled: true, maxMB: 50, imageByPath: true, dirs: [] as string[] },
  // 危险命令确认（默认开）：她在私聊里执行删根目录/格式化/关机/下载后直接执行等
  // 终端命令前，先发 QQ 私聊问主人，回复「确认」才执行；超时或「取消」就拦下。
  // panelRemoteAccess：允许远端（非回环）访问管理接口；默认 false = 只有本机能管。
  // trustedProxy：可信反向代理地址（逗号分隔）；只有请求确实从这些地址进来，才采信
  //   X-Forwarded-For 的最后一跳作为真实来源。留空 = 从不相信任何转发头（最安全）。
  // publicHostname：面板经反代对外时的域名（如 panel.example.com），可填多个、逗号分隔；CSRF 同源校验把
  //   这个域名的 Origin 也算同源。留空 = 只有回环 Origin 算同源。
  security: { dangerConfirm: true, ssrfMode: 'strict', panelRemoteAccess: false, trustedProxy: '', publicHostname: '' },
  // 浏览器（全局）：useDshSidebar = 需要浏览器的模块（逛网页 / 刷抖音 / 小红书 / 小黑盒验证）
  // 连 DSH 侧边浏览器的共享实例（ego，画面在 DSH 右侧实时可见），不为每个模块各开一个独立窗口。
  browser: { useDshSidebar: false },
  // DeepSeek 峰谷省钱模式（默认关，现有行为不变）：打开后只把「不着急的后台模型调用」尽量挪到谷时，
  // 聊天回复/工具/审批/定时任务本身不变。offPeakHolidays 是中国法定节假日（北京时间日期 'YYYY-MM-DD'）。
  cost: { offPeak: false, offPeakHolidays: [] as string[] },
  update: { unstable: null as string | null }, // 订阅不稳定版本（beta、rc）；null = 没选过，按正在用的版本定
  model: { provider: '', model: '', reasoningEffort: 'low', vision: 'auto' }, // 留空 = 跟随 DSH 默认；vision: auto/on/off
  // 按聊天选模型（主人在面板「模型」页设）：私聊 QQ 号 > 群号 > 所有私聊 / 所有群默认 > 上面的全局模型；没写的一级退到下一级
  chatEfforts: {}, // QQ 聊天单独选择的思考档位
  chatModels: { privateDefault: { provider: '', model: '', reasoningEffort: '' }, groupDefault: { provider: '', model: '', reasoningEffort: '' }, privates: {}, groups: {} },
  merge: { enabled: true, waitSec: 2.5, maxSec: 8, groupWaitSec: 5, groupMaxSec: 15 }, // 连发合并：对方停顿 waitSec 秒再一起回，最多等 maxSec 秒；群里等得久一点，把一段话攒齐
  forward: { expandEarly: false, expandHistory: false }, // 合并转发：expandEarly=消息一进来就展开成文字存进上下文（哪怕这条不交给她，代价是每条转发多调一次 get_forward_msg）；expandHistory=交给她之前把缓冲里还没展开过的转发补展开（每条只拉一次）
  imageGen: {
    enabled: false,
    provider: 'openai', // openai / custom / minimax；codex = 实验性订阅接法（需单独登录）
    baseUrl: '',
    baseUrlOptions: [] as BaseUrlOption[], // 面板「服务地址」下拉里用户自己添加的常用地址（官方推荐的赞助商地址固定第一项，不存这里）
    apiKey: '',
    model: '',
    fallbackEnabled: false,
    fallbacks: [] as ImageFallback[],
    size: '1024x1024',
    shape: 'her', // 工具可选构图；her 时未指定就沿用 size
    stylePrompt: '', // 每次生图自动加在前面的风格描述
    ownerOnly: true, // 只有主人能让她画
    seeOwn: true, // 「让她画完自己看一眼」：开着才把画好的图交给她看
    img2img: true, // 允许参考聊天图片 / 自己的画作来改画
    allowGif: false, // 明确请求动图时才允许 format=gif，普通画图仍沿用静态路径
    galleryShown: 20, // 面板「她的画作」显示最近几张（1~50；只影响显示，不删文件）
    // 自定义接法：url 里可以用 {prompt} {model} {size} {width} {height} {image}（参考图 base64）；params 是参数名/值（值里也能用这些占位符）
    custom: { method: 'GET', url: '', bodyType: 'json', responsePath: '', params: [] as ImageCustomParam[] },
    // 实验性订阅接法；登录令牌独立保存在数据目录，不进入配置。
    codex: { model: 'gpt-image-2', quality: 'auto', background: 'auto' },
    // MiniMax H3 Image：/v1/images/generations（文生图）、/v1/images/edits（1~16 张参考图改画）；
    // apiKey 留空 = 复用 voice.minimax.apiKey（同一个开放平台 Key）。n 一次生成几张，area 是 1K/2K/4K。
    minimax: { apiKey: '', baseUrl: 'https://api.minimax.cn', model: 'MiniMax-H3-Image', n: 1, area: '2K', enhance: true },
  },
  // 生视频：local（本地接口 video.mjs，默认）/ minimax（MiniMax H3 云端）/ custom（自定义异步任务接口）
  video: {
    provider: 'local',
    confirm: true, // 生成前先让主人确认
    enhance: true, // 先把一句话场景扩写成分镜提示词
    selfView: true, // 生成后抽 4 帧交给视觉模型，写进她的上下文
    // MiniMax H3：/v2/video_generation 创建任务 → /v2/query/video_generation/{id} 轮询 → 下载
    minimax: { apiKey: '', baseUrl: 'https://api.minimax.cn', model: 'MiniMax-H3', resolution: '768P', duration: 5, ratio: '16:9', pollMs: 5000 },
    // 自定义异步任务：创建 → 轮询 → 下载；占位符 {prompt} {seconds} {image} {reqid} {taskId}
    custom: { createUrl: '', createMethod: 'POST', headers: '', body: '{"prompt":"{prompt}","duration":{seconds}}', taskIdPath: 'task_id', queryUrl: '', statusPath: 'status', successValue: 'succeeded', failValue: 'failed,cancelled', urlPath: 'content.url', pollMs: 5000 },
  },
  persona: { current: 'dafeiyu' },
  personaLook: { visionModel: { provider: '', model: '' } }, // 留空跟随聊天模型
  // 主人私聊里问起群里的事：把最近 24 小时的群聊流水补进这一轮（默认关，开启前先把群加进白名单）
  group: { ...DEFAULT_GROUP_POLICY, privateCommandsEnabled: true, overrides: {} as Record<string, unknown>, ownerTools: 'off', ownerToolsGroups: [] as string[], ownerBrief: { enabled: true, lines: 24, groups: [] as string[] } },
  memberFilter: { enabled: true, rules: [] as MemberFilterRule[] }, // 不回应的人：明确选择所有群或指定群；不影响私聊
  // 按群头衔不回：勾选的群里，专属头衔正好是 title 的成员（一般是别的机器人）说话、戳她都不理。没勾群就不起作用
  titleFilter: { enabled: true, groups: [] as string[], title: '大肥鱼' },
  voice: {
    enabled: true,
    // auto = 先 edge-tts，不行用 Windows 语音；edge / windows / cosyvoice / gptsovits / volcano / breeze / minimax / http = 指定引擎（失败都会退回 Windows 语音）
    engine: 'auto',
    fishApiKey: '',
    fishReferenceId: '',
    cosyvoice: { url: 'http://127.0.0.1:50000', mode: 'sft', spkId: '中文女', instruct: '', sampleRate: 22050 },
    gptsovits: { url: 'http://127.0.0.1:9880', refAudio: '', promptText: '', promptLang: 'zh', textLang: 'zh' },
    // 通用 HTTP 引擎：GET 时地址里带 {text}；POST 时填接口地址，请求头一行一个，请求体里 {text} 自动替换（已做 JSON 转义）
    http: { urlTemplate: '', method: 'GET', headers: '', body: '', sampleRate: 24000, fallback: 'windows' },
    // 豆包语音（火山引擎）预设：地址、请求头、请求体全内置，只留 API Key + 音色给人填
    // resourceId 留空 = 按音色自动配（1.0 音色配 seed-tts-1.0，2.0 音色配 seed-tts-2.0）
    volcano: { apiKey: '', resourceId: '', voiceType: 'zh_female_vv_uranus_bigtts', speedRatio: 1 },
    // Breeze 语音：cloud 走 BreezeBlue（`POST {url}/v1/text-to-speech/{音色id}` + xi-api-key），
    // local 走本机自建 breeze_infer（`POST {url}/v1/audio/speech` 的 multipart 表单）；语气写在 instructions 里（中文）。
    breeze: {
      mode: 'cloud',
      url: 'https://api.breeze.blue',
      // 站点：登录 / 领每日额度走这里（跟合成接口不是同一个域名）
      siteUrl: 'https://breezeblue.ai',
      key: '',
      // 云端额度：填了邮箱密码 + 打开自动领取，就每小时醒一次去领（一天最多一次）
      email: '',
      password: '',
      autoClaim: true,
      voiceId: '',
      model: 'breeze-tts-2',
      languageCode: 'zh',
      instructions: '',
      outputFormat: 'mp3_24000_128',
      guidanceScale: 0,
      timeoutMs: 60000,
    },
    // MiniMax 语音：开放平台「接口密钥」+ 音色库里的 Voice ID（也能填声音设计 / 复刻的自定义 id）；
    // emotion 留 auto 就不传，交给模型按文字自己匹配
    minimax: { apiKey: '', baseUrl: 'https://api.minimax.cn', voiceId: 'Chinese (Mandarin)_Soft_Girl', model: 'speech-2.8-turbo', emotion: 'auto', speed: 1, pitch: 0 },
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    autoChance: 0.15, // 短回复自动变语音的概率
    autoMaxChars: 80,
    asr: true, // 听语音
    // 云端语音识别（可选）：OpenAI 兼容 /audio/transcriptions；provider 为空 = 不用。
    // prefer=qq 时顺序是 本地 → QQ 自带 → 云端 → DSH；prefer=cloud 时云端提前到 QQ 前面。
    asrApi: { provider: '', baseUrl: '', model: '', apiKey: '', language: '', prefer: 'qq' },
    emojiSeparate: true, // 语音条里的表情/emoji 不念出来，单独补一条文字发出去
    // 语音条变声：用翻唱里导入的 RVC 音色模型（先 TTS 念，再变声）。留空 = 不变声
    songVoice: '',
    songPitch: 0, // 变调半音：男声模型转女声一般 +12
  },
  stickers: {
    enabled: true,
    faces: true, // 回复里能夹 QQ 自带的小黄脸（<face:名字>）
    autoChance: 0.35, // 自动配表情的概率；limitTagged 开启时也限制回复自带的表情
    limitTagged: false, // 升级保持原行为；开启后按 autoChance 限制回复中的表情，不再叠加心情倍率
    keywordExemption: false, // 实验性：正文命中配图关键词时保留已有表情，只在 limitTagged 开启时生效
    // 主动给对方的原消息贴 QQ 表情：这是新行为，默认关；开了之后按自己的概率算，
    // 不从 autoChance 取值（两者是不同动作，隐式联动会让升级后的人莫名其妙被贴表情，#216 review）
    react: false, // 主动贴表情总开关，默认关
    reactChance: 0.15, // 主动贴表情的概率，独立默认值
    reactMaxPerHour: 10, // 每个会话每小时最多主动贴几次
    collect: true, // 偷表情
    // 怎么偷：auto = 看到就收（默认，保持原行为）；ask = 她挑（先记着，喜欢才凭编号收）；owner = 只听主人的（只有主人语境下才提示/允许收）
    collectMode: 'ask',
    fromGroups: true,
    fromPrivate: true,
    maxPerHour: 20,
    maxLibrary: 300, // 表情库最多存多少张（QQ 收藏表情有上限），超了就清掉最少用的
    maxSide: 520, // 收进来的图最长的边（像素）：QQ 表情本身就不大，再大只是白占内存
    caption: true, // 用视觉模型起备注
    // 起名单独挑的模型：{ provider, model }；留空 = 跟随聊天用的模型
    captionModel: { provider: '', model: '' },
  },
  diary: {
    enabled: true,
    timesPerDay: 2,
    windowStart: '10:00',
    windowEnd: '23:30',
    minGapMinutes: 180,
    attachImage: true, // 写日记时配一张图（优先今天她画的，其次今天收的表情包）
    // 可选图文日记：关着时沿用原来的聊天摘录和配图流程；本地目录必须由主人填写。
    rich: { enabled: false, stickers: false, browsing: false, local: false, folder: '', maxImages: 2 },
    archive: { enabled: false, folder: '' }, // 已有公开浏览图按浏览日期归档；必须由主人指定输出目录
    minChars: 60,
    maxChars: 140,
    visibility: 'all', // all | friends | selected | self | excluded，和 QQ 空间自身的可见范围一致
    audienceQQs: '', // selected / excluded 时可见（或不可见）的好友 QQ 号，换行或逗号分隔
  },
  // 本地接口：数据目录 local/ 里的脚本接管这几项（文件要在、开关要开）
  local: { tts: false, image: false, song: false, asr: false, video: false, videoTimeoutMin: 20 },
  bili: {
    enabled: false,
    sessdata: '', // B 站 Cookie 里的 SESSDATA（登录凭证）
    biliJct: '', // B 站 Cookie 里的 bili_jct（发评论要用）。两个都不填也能看视频，只是不能评论
    buvid3: '', // 设备指纹之一：扫码登录时跟票一起发下来，重启后要沿用同一个，不然容易被风控
    buvid4: '', // 设备指纹之一：跟 buvid3 配套，一起发下来、一起保存
    dedeUserId: '', // 这个号自己的 UID（Cookie 里的 DedeUserID），跟票绑在一起
    ownerName: '', // 主人的 B 站昵称：她写 @主人 时 @ 这个号
    cookie: '', // 由上面几个拼出来给接口用；老配置的整串会自动拆到上面几个里
    autoBrowse: true, // 定时自己去刷
    offpeak: false, // 只在谷时刷：默认关；峰时跳过定时刷和看回复（省 token）
    intervalHours: 4, // 多久刷一轮
    maxRunsPerDay: 3,
    perRun: 3, // 一轮看几个视频
    keywords: [] as string[], // 额外想让她搜的方向（另外还会参考她的兴趣和记忆里你喜欢的东西）
    minViews: 5000, // 播放量门槛
    maxAgeDays: 60, // 只看最近多少天发的
    comment: true, // 自己发评论
    maxCommentsPerDay: 3,
    reply: true, // 回别人回她的评论
    maxRepliesPerDay: 6,
    danmakuEnabled: false, // 主人主动打开后才允许发送弹幕
    autoDanmaku: false, // 刷完自己发弹幕，另行开启
    maxDanmakuPerDay: 3, // 手动和自动共用提交上限（失败也计数）
    shareToOwner: true, // 看到好玩的私聊分享给主人
    like: false, // 顺手点赞
    vision: false, // 可选：ffmpeg 抽帧交给视觉模型
    visionFrames: 6,
    ffmpegPath: '', // 留空从 PATH 查找
    shotChance: 0.35, // 刷完发截图给主人；0 = 不自动发
    shotLibrary: 300,
    // 想发到群里的时候不直接发：先攒成待批，私聊问主人「发几号」。默认关，开了才考虑。
    groupShare: {
      enabled: false, // 默认关：开了才会把想发群的攒起来问主人
      groupId: '', // 目标群号；空 = 不生效。生产群号留在部署侧 config.json，不进默认值（上游开源）
      groups: [] as string[], // 攒好待批的分享按群分开排队
      dailyLimit: 3, // 每天最多真发几条到群
      pendingTtlHours: 24, // 待批多久没回就当不发
      queueLimit: 1, // 一次最多攒几条待批：默认 1，一次只问一条、只发一条（发多了像刷屏）
    },
  },
  // 刷抖音：专用浏览器（独立登录资料，不碰你平时的浏览器），经 CDP 控制。浏览 / 点赞 / 评论 / 分享各项权限在 profilePerms.douyin*。
  douyin: {
    enabled: false, // 总开关：默认关，先在面板里扫码登录再打开
    autoBrowse: true, // 定时自己去刷
    intervalHours: 4,
    maxRunsPerDay: 3,
    perRun: 5, // 一轮看几个视频
    maxWatchPerDay: 30, // 每天最多看几个（手动让她刷也算；主人亲口让她找视频时不受这个限制）
    dwellMin: 8, // 每个视频停留的秒数（随机取一个）
    dwellMax: 40,
    browserPath: '', // 留空 = 自动找 Edge（找不到再找 Chrome / Chromium）；也可填完整路径
    shareBias: 'proactive', // stingy | normal | proactive：刷到好看的视频，分享给主人的积极程度
    ownerDm: true, // 主人在抖音上私信她时回（只认核对过的主人抖音号）
    dmPollMinutes: 3, // 隔几分钟看一次主人的抖音私信
    shareTo: 'douyin', // douyin = 在抖音里私信分享给主人（要先核对主人抖音号，没核对 / 发不出去就改发 QQ）| qq = QQ 私聊发链接 | both = 两边都发
    owner: { input: '', secUid: '', uid: '', nickname: '', confirmedInput: '' }, // 主人的抖音号：面板填抖音号 / 主页链接，「核对」后才写入 secUid（真·@主人只认它）
    caps: { like: 30, comment: 3, share: 5, atOwner: 3 }, // 每天上限（登录后前 newAccountDays 天减半）；atOwner = 评论里真·@主人
    gate: {
      maxWritesPerDay: 40, // 点赞 + 评论合计上限
      minWriteGapSec: 20, // 两次点赞 / 评论之间至少隔这么多秒
      newAccountDays: 3, // 首次登录起这么多天内，上限都减半
    },
  },
  // 刷小黑盒：用主人的账号逛游戏社区（读多写少）。点赞 / 评论 / 发帖各项权限在 profilePerms.heybox*。
  heybox: {
    enabled: false, // 总开关：默认关，先在面板里填 Cookie 再打开
    cookie: '', // 整串 Cookie（pkey 必须有；要写操作还得有 x_xhh_tokenid）
    autoBrowse: true, // 定时自己去逛（只读）
    intervalHours: 4, // 多久逛一圈
    maxRunsPerDay: 6, // 每天最多逛几轮
    perRun: 3, // 一圈看几条
    likeDaily: 10, // 每天最多点赞
    commentDaily: 3, // 每天最多评论
    maxPostsPerDay: 3, // 每天最多发帖（硬上限，多了容易被限）
    defaultTopic: 7214, // 发帖默认分区：7214 盒友杂谈 / 18745 数码硬件 / 806933 AI
    postStyle: 'mix', // 发帖风格：diary 大肥鱼日记 / news 热搜文 / mix 肥鱼热搜
    shareToOwner: true, // 逛到有意思的帖子，私聊分享给主人（和 B 站同一个思路）
    shareBias: 'normal', // stingy | normal | proactive：分享给主人的积极程度
    shareDaily: 3, // 每天最多分享几条（避免刷屏）
    // 谷时逛：只在非峰时跑自动逛，避开工作日 9-12 / 14-18 的高峰，省 token
    // 分区：manual = 总是用默认分区；auto = 按正文内容自动挑（挑不到回落默认）
    topicMode: 'manual',
    // 发帖字数范围：0 = 用风格自带的；填了就覆盖（对所有风格生效）
    postWordsMin: 0,
    postWordsMax: 0,
    // 每天每篇的排期：空数组 = 用全局设置；填几项就按几篇发，每篇用自己的配置
    dailyPosts: [] as HeyboxDailyPost[],
    offPeakOnly: false, // 开关：默认关（行为不变）
    peakStartAM: 9, // 上午峰时开始（含）
    peakEndAM: 12, // 上午峰时结束（不含）
    peakStartPM: 14, // 下午峰时开始（含）
    peakEndPM: 18, // 下午峰时结束（不含）
    peakWeekend: false, // 周末是否也算峰时（默认不算，周末全天可逛）
  },
  qzoneSocial: {
    enabled: true,
    replyOwn: true, // 回复自己说说下别人的新评论
    commentFriends: true, // 逛好友动态，偶尔评论
    friendChance: 0.3, // 看到一条好友说说时互动（点赞 + 可能评论）的概率
    ownerChance: 0.7, // 主人的说说互动概率
    like: true, // 互动时顺手点赞
    maxPerDay: 8, // 每天最多评论几条（点赞不算）
    intervalMin: 30, // 多久逛一次空间
  },
  speakUp: {
    // ⚠ 语义归属（Q3/Q4 拍板，P5 注记）：主动搭话已并入目的引擎（ext.purpose，P1 起默认开），
    // speakup 模块已退场，但本段的醒着窗口/白名单/小闹钟等键**冻结在 speakUp.* 命名空间**，
    // 由目的引擎维护——qzone-social/bili/douyin/heybox/xhs/phone/pet 等多处直读，改键会连坐。
    enabled: true, // 只在和主人的私聊里主动找你，群里不会
    idleMinutes: 40,
    minIntervalMinutes: 60,
    maxIntervalMinutes: 180,
    maxPerDay: 20, // 每个人每天最多几次；留空就是 20
    allow: [] as string[], // 主动搭话白名单：除主人外还会主动找谁（QQ 号）——目的引擎 friends 线与 memory 相识判定同读此键
    nudge: true, // 她问了你一句、你一直没回时，偶尔轻轻追一句（purpose 侧读 ext.purpose.nudge ?? speakUp.nudge）
    reminderEnabled: false, // 允许她在主人私聊里给自己设小闹钟（小闹钟 P2b 起由 purpose 承接）
    reminderLimit: 5, // 最多同时保留几条未过期的提醒（硬上限 10）
    reminderRetry: true, // 触发失败后 15 分钟内每 5 分钟重试
    awakeFrom: 8, // 醒着窗口起点（全天自动任务共用的作息真相；终点 awakeTo 默认 23）
    awakeTo: 23, // 醒着窗口终点：可设 24 = 到当天结束；from===to 视为全天（不启用安静时段）
  },
  // 心情：单标量 0~100（base/半衰期/模型判定）+ 情绪向量（emotions 心情项可配，见 features/mood-emotions.js）。
  // 向量 2026-11-17 从目的引擎下沉到这里：它是「她的心情」，不是「这一轮的目的」，也不该在目的引擎关掉时消失。
  // judge：每轮聊完用模型判一次心情（更准，每轮多一次很短的调用）。默认开——关键词判断分不清「对别人说的」和
  // 「对她说的」（群成员互相表白也会让她心情上涨），关掉会明显不准。base：心情基线（0~100 里算「平常」的值）。
  mood: { enabled: true, halfLifeHours: 3, judge: true, base: 60, emotions: defaultEmotions() },
  // seedHistory：新会话第一次说话时先补最近几条历史（默认关）
  // everyStep：一轮里她分几段说就发几条（默认关 = 只发最后一段）。私聊多是闲聊，连着说的几句可能是不同话题，
  //   只发最后一段会让人以为她只回了一个话题；干活时前面多是工具调用前后的过程话，开着会显得啰嗦
  // rescueFromThinking：整轮一段正文都没写时，从思考里捞出她自己定稿的那段（默认关，捞不到就不发）
  // turnTimeoutMinutes：一轮跑超过这么多分钟就强制放开（模型/工具卡死时 turn/end 永远不来，
  // 私聊新消息会被一直当成 steer 塞进那一轮，看上去就是「不理人」）。填 0 关掉兜底。
  // thinkingGuard：出站前的正文污染闸。模型偶尔把思考直接写进正文（英文判断 + 中文真话），
  //   或者思考塌缩成「做。做。做。…」。开着就切掉思考前缀、拦住退化内容；拦下就当她这轮没说话（默认开）。
  // replyMarker：代码注入格式要求，模型必须用 ⟦REPLY⟧ 包住要发的话；没有标记就要求重写一次，
  //   重写后仍然没有就不发。默认关：打开会改变所有会话的输出格式，先在面板/配置里手动开。
  // acpSanitize：DSH 上下文代理的 ACP 包装标记（<acp tokens="…" …>mNNNNN</acp>）被模型复述时漏进正文。
  //   enabled：正则剥离，默认开——纯字符串处理，零延迟零成本，必须默认生效；
  //   modelFallback：正则剥完仍像有标签残渣时，再问一次模型兜底改写（要花 token 与延迟，默认关）；
  //   modelMaxChars / modelTimeoutMs：兜底的文本长度上限与单次超时；超时或失败一律退回正则结果。
  chat: { seedHistory: false, seedHistoryCount: 20, everyStep: false, dupSimilarity: 0.45, rescueFromThinking: false, turnTimeoutMinutes: 30, thinkingGuard: { enabled: true }, replyMarker: { enabled: false }, acpSanitize: { enabled: true, modelFallback: false, modelMaxChars: 800, modelTimeoutMs: 4000 } },
  // 原话档案独立于摘要记忆；默认关闭，由使用者明确开启并管理保留期限。
  conversationContext: { enabled: false },
  memory: {
    adaptStyle: true, // 允许从旧记忆注入说话方式/相处建议；关闭不删除记忆
    passiveGroups: [] as string[], // 非白名单群：仅记录文字供记忆整理，不开放聊天；留空不旁听
    enabled: true, recallCount: 6, recallMinRelevance: 0, recallMode: 'always', recallTriggers: ['上次', '上回', '之前', '以前', '那天', '那次', '还记得', '记不记得', '说过', '提过', '答应', '约好', '那时候'],
    dailyConsolidate: true, consolidateTimes: ['04:00', '16:00'], keepChatlogDays: 7, keepChatlogSet: false, mergeGroups: false, compress: true, compressAfterDays: 14, instantCommands: true, groupMemory: true, searchRrf: true,
    profileOnlyAcquainted: true, profileFieldChars: 40, profilePeople: 2, profileChars: 240, chatImpression: true, chatImpressionChars: 120, dislikeSilence: 0.85,
    followUp: true, // 惦记尚无结果的重要事，主动聊天时顺口问问
    shortTerm: true, shortTermHours: 2, shortTermIdleMinutes: 3, shortTermChars: 150,
    recallHintMaxChars: 900, // 每轮召回提示的总字数上限：它留在会话历史里，不限长会越滚越大
    gistEnabled: true, gistDays: 180, impressionDays: 365, gistDailyBatches: 6, tierDays: { ...DEFAULT_TIER_DAYS },
    extractIdleMinutes: 30, extractMinLines: 20, extractDailyBatches: 24, capacity: { auto: 2000, event: 600, diary: 400 }, eventExpireDays: 90, vector: {
      enabled: false,
      // mode 不写进 DEFAULTS：它是派生值（见下方 normalize 的 defineProperty），
      // 写进来会变成「用户显式选择」，害得老客户端只传地址时切不到在线服务（#520）。
      // provider 只影响面板预置的地址/模型；请求统一走 OpenAI 兼容的 {baseUrl}/embeddings
      provider: 'siliconflow',
      baseUrl: '',
      model: '',
      apiKey: '',
      dimensions: 0, // 0 = 不传；Qwen3 / OpenAI 的 MRL 模型可以截断
      batchSize: 10, // 方舟等单次 input 上限小，10 最稳
      queryTimeoutMs: 3000,
      headers: '', // 自定义请求头，一行一个；有 Authorization 时不再自动加 Bearer
    },
    // 可选精排：对已经过滤好的候选重新打分；失败/超时回退原顺序
    rerank: {
      enabled: false,
      baseUrl: '', // 留空复用 vector.baseUrl
      model: 'BAAI/bge-reranker-v2-m3',
      apiKey: '', // 留空复用 vector.apiKey
      topN: 20,
      timeoutMs: 2000,
    },
    // 向量联想（记忆联想）：按意思给记忆建边，召回时最多带 3 条；支持多跳（A→B→C）但封顶。
    assoc: { enabled: true, minSim: 0.45, limit: 4, recall: 3, hops: 2, hopDecay: 0.55 },
    // 真正交给模型的记忆条数：直接命中几条 + 联想几条（各自独立上限，最后合起来进上下文）。
    // recallCount 是「直接命中」的上限；recallTotal 是总数护栏（0 = 不额外限制）。
    recallTotal: 0,
    // 行为驱动的档位升档：被想起的天数 + 时间把 importance 慢慢涨上去，够门槛就升档。
    // assocPerHitDay：几次联想折算成「想起来一天」（联想也算加深，但比直接命中轻）。
    tierGrow: { enabled: true, perDay: 0.02, minHitDays: 3, cap: 0.85, assocPerHitDay: 2, tier2: { hitDays: 5, imp: 0.6 }, tier3: { hitDays: 10, imp: 0.75 } },
    // 遗忘曲线的时间基数（天）。默认 20：普通记忆约 60 天才淡忘，长期用不容易「刚说过就忘」。
    // 调到 8 左右更像人类（1 天后剩 75%、1 个月后剩 5%），但记住的东西会明显变少。
    retentionBase: 20,
    // beta 侧新增：本地保留配置 + 面板折叠状态
    residentMaxChars: 1200, preferPersonal: true,
    // 面板「记忆库」里四组进阶设置的折叠状态（true = 收起）；改动会立即写回配置文件
    uiCollapsed: { people: true, tiers: true, vector: true, rerank: true },
  }, // residentMaxChars / preferPersonal 为本地保留配置；extractIdleMinutes 为 0 时关闭空闲提炼；手动记忆不受容量限制
  song: {
    enabled: false,
    root: '', // 翻唱环境目录，留空 = 自动（老安装 C:\Aurabot\rvc，新安装在用户目录下）
    voice: '', // 用哪个音色（models 目录里的 .pth 文件名），留空 = 第一个
    pitch: 0, // 默认变调（半音）：自动定变调关着、或者测不出原唱音高时用
    autoPitch: true, // 没指定变调时，分离出人声后按原唱男声 / 女声自动定 0 / +12 / -12
    selfVoice: 'female', // 她当前音色的声线：female / male
    neteaseCookie: '', // 网易云 Cookie（MUSIC_U），下会员歌用
    separatorModel: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt', // 人声分离模型
    maxVoiceSec: 120, // 语音条最长多少秒，歌更长就截一段
    clipStart: 'auto', // auto = 自动分析音频定位副歌入口（分析失败回退 30%）；head = 从头截
    vocalVolume: 1,
    instVolume: 0.8,
    ownerOnly: true, // 只有主人能点歌
    keepWork: false, // 留着中间文件（调试用）
    pypiMirror: 'auto', // 安装时用的下载源：auto = 先测一下，官方源慢就用国内镜像；cn = 一直用国内镜像；off = 只用官方源
  },
  // 云备份：每天到点自动打包并把最新备份推到 Gitee 私有仓库（走本机 git）或 WebDAV
  backup: {
    remote: {
      enabled: false, // 到点自动「打包 + 推送」；关了就只剩面板手动推
      provider: 'gitee', // gitee | webdav
      // WebDAV：填服务器地址（自动建 aurabot-backups），密码按密钥处理
      webdav: { url: '', username: '', password: '', configOnly: true },
      owner: '', // Gitee 用户名
      repo: '', // 仓库名（没有的话推送时按 autoCreate 自动建私有的）
      token: '', // 私人令牌（要 projects + repo 权限），存配置时按密钥处理
      branch: 'master', // 推到哪个分支
      time: '03:30', // 每天几点自动备份并推送
      keep: 7, // 远端保留最近几份
      autoCreate: true, // 远端没有这个仓库时自动建一个私有的
      forceOverwrite: false, // 允许覆盖「已有内容但不是本工具推的」仓库（清空远端历史重推）：面板显式勾选才开
    },
  },
  tabs: {} as TabPrefs, // 面板记住的小偏好
  // 模块：内置的和数据目录 modules/ 里自己写的。{ 模块id: { enabled, useBuiltin } }，没写的算开着
  // useBuiltin：自己写了同名模块，但想先用回内置的
  // 聊天沙盒会开一个本地端口，默认关着；要用的时候在面板模块列表里打开。
  modules: { sandbox: { enabled: false } } as ModuleSwitchTable,
  safeMode: false, // 安全模式：自己写的模块一个都不加载（排查问题用）
  ext: {} as ModuleSettings, // 自己写的模块的设置：{ 模块id: {...} }
  // 自定义渠道费率按渠道和完整模型名匹配，与内置的官方美元参考价分开。
  usage: { pricing: {} as UsagePricing },
  // 联动：让别的程序、DSH 里别的会话和插件也能用她
  bridge: {
    dshTools: false, // DSH 里别的会话（比如你平时写代码的会话）能用工具让她发 QQ、查记忆
    http: false, // 开放 HTTP 接口（要带密钥）
    token: '', // 第一次打开时自动生成
    allowTargets: 'whitelist', // 外部能发给谁：whitelist = 白名单里的人和群；owner = 只能发给主人
  },
}

/** 用 U 覆盖 T 上的同名字段。 */
type Replace<T, U> = Omit<T, keyof U> & U

/** 群聊策略：DEFAULTS 的形状 + normalize 派生/兼容的字段。 */
type GroupConfig = Replace<typeof DEFAULTS.group, {
  moduleOnlyGroups?: string[]
  ignoreAtOthers?: boolean
  crossRead?: 'off' | 'group' | 'private'
  /** 旧版的对外静默窗口（单个字符串），载入时删掉。 */
  guestQuietHours?: unknown
}>

/** 心情：旧版的「每天最多提醒几次」已退场，只在老配置里出现。 */
type MoodConfig = Replace<typeof DEFAULTS.mood, { maxInjectPerDay?: number }>

/** 聊天行为：everyStep 允许 'auto'，dupSimilarity 是面板可调的阈值。 */
type ChatConfig = Replace<typeof DEFAULTS.chat, { everyStep: boolean | 'auto'; dupSimilarity: number }>

/** 记忆：向量配置有非枚举的派生字段 mode / modeExplicit。 */
type MemoryConfig = Replace<typeof DEFAULTS.memory, {
  crossContext?: boolean
  /** 旧版的单个整理时刻，载入时换成 consolidateTimes。 */
  consolidateAt?: string
  vector: Replace<typeof DEFAULTS.memory.vector, { mode?: string; modeExplicit?: boolean }>
}>

/** 日记：rich.cards 是旧字段，载入时删掉。 */
type DiaryConfig = Replace<typeof DEFAULTS.diary, {
  rich: Replace<typeof DEFAULTS.diary.rich, { cards?: unknown }>
}>

/**
 * 插件配置的唯一形状来源：DEFAULTS 定全集，这里补上 normalize 派生出来的字段。
 * 要加配置项就加到 DEFAULTS 上，类型自动跟上（不用两份清单各写一遍再对不上）。
 */
export type AurabotConfig = Replace<typeof DEFAULTS, {
  communityMigrated: Record<string, string>
  /** 主人授权修订号：只有落盘的权威配置才带，用来判「换了主人」。 */
  ownerAuthorization?: { owner: string; revision: string }
  group: GroupConfig
  mood: MoodConfig
  chat: ChatConfig
  memory: MemoryConfig
  diary: DiaryConfig
  bili: Replace<typeof DEFAULTS.bili, { groupShare: Replace<typeof DEFAULTS.bili.groupShare, { groups: string[] }> }>
  voice: Replace<typeof DEFAULTS.voice, { keyPools?: KeyPools }>
}>

