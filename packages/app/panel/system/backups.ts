import {
  listBackups,
  pendingRestore,
  pendingModules,
  createBackup,
  stageReceivedBackup,
  stageRestore,
  cancelRestore,
} from '../../../../src/core/runtime/backup/backup.ts'
import { dataDir } from '../../../../src/core/store/index.ts'
import { workspaceDirOf } from '../../../../src/chat/hub/index.ts'
import { mergeFromPanel } from '../../../../src/core/config/index.ts'
import {
  pushBackup,
  listWebdavBackups,
  downloadWebdavBackup,
} from '../../../../src/core/runtime/backup/backup-push.ts'

export function registerBackups({ http, VERSION, getConfig, log, openFolder, isUnloaded, setConfig }) {
  const { route, readRaw, readBody } = http
  let backupJob = null,
    pushJob = null,
    pushTimer: ReturnType<typeof setTimeout> | undefined
  const dispose = () => {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = undefined
  }

  // 备份：文件里有账号凭证，只存在本机文件夹，不提供网页下载（backupJob 声明在文件顶部，云备份的定时器要提前用到）
  const backupAction = (run) => async (req) => {
    if (req.method !== 'POST' || req.headers?.['x-aurabot-backup'] !== '1')
      return { ok: false, message: '请从面板发起操作' }
    return run(req)
  }
  route('/backup/state', async () => ({
    ok: true,
    job: backupJob,
    list: listBackups(),
    pending: pendingRestore(),
    modules: pendingModules(),
    dir: dataDir('backups'),
  }))
  route(
    '/backup/create',
    backupAction(async () => {
      if (backupJob?.running) return { ok: false, message: '上一个备份还在打包' }
      backupJob = { running: true, done: 0, total: 0 }
      createBackup({
        version: VERSION,
        workspaceDir: workspaceDirOf(getConfig()),
        onProgress: (p) => {
          backupJob = { ...backupJob, ...p }
        },
      })
        .then((result) => {
          backupJob = { running: false, result }
          log.info(`备份完成：${result.name}，${result.files} 个文件`)
        })
        .catch((error) => {
          backupJob = { running: false, error: error.message }
          log.error('备份失败：', error.message)
        })
      return { ok: true, message: '开始打包了' }
    }),
  )
  route(
    '/backup/open',
    backupAction(async () => openFolder(dataDir('backups'))),
  )
  route(
    '/backup/upload',
    backupAction(async (req) => {
      const buf = await readRaw(req, 2 * 1024 * 1024 * 1024 - 1)
      if (!buf.length) return { ok: false, message: '文件是空的' }
      try {
        return await stageReceivedBackup(buf)
      } catch (error) {
        return { ok: false, message: error.message }
      }
    }),
  )
  route(
    '/backup/restore-path',
    backupAction(async (req) => {
      const path = String((await readBody(req)).path || '')
        .trim()
        .replace(/^"|"$/g, '')
      if (!path) return { ok: false, message: '填备份文件的完整路径' }
      try {
        return await stageRestore(path)
      } catch (error) {
        return { ok: false, message: error.message }
      }
    }),
  )
  route(
    '/backup/cancel',
    backupAction(async () => {
      try {
        cancelRestore()
        return { ok: true, message: '取消了' }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    }),
  )
  // ---------- 云备份：每天到点自动打包，并把最新备份推到 Gitee 私有仓库（走本机 git）----------
  const alive = () => {
    try {
      return !isUnloaded()
    } catch {
      return true
    }
  }
  const nextRemoteAt = () => {
    const r = getConfig().backup?.remote
    if (!r?.enabled) return null
    const [hh, mm] = String(r.time || '03:30')
      .split(':')
      .map(Number)
    const next = new Date()
    next.setHours(hh, mm, 0, 0)
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  const remoteView = (r: Record<string, any> = getConfig().backup?.remote || {}) => ({
    enabled: !!r.enabled,
    provider: r.provider === 'webdav' ? 'webdav' : 'gitee',
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    time: r.time,
    keep: r.keep,
    autoCreate: r.autoCreate !== false,
    forceOverwrite: !!r.forceOverwrite,
    hasToken: Boolean(r.token),
    configOnly: r.webdav?.configOnly === true,
    webdav: {
      url: r.webdav?.url || '',
      username: r.webdav?.username || '',
      hasPassword: Boolean(r.webdav?.password),
      configOnly: r.webdav?.configOnly === true,
    },
  })
  route('/backup/remote/state', async () => ({
    ok: true,
    remote: remoteView(),
    job: pushJob,
    nextAt: nextRemoteAt(),
  }))
  route(
    '/backup/remote/config',
    backupAction(async (req) => {
      const patch = { ...(await readBody(req)) }
      if (!patch.token) delete patch.token // 令牌留空 = 沿用旧值，别把配好的抹掉
      if (patch.webdav && !patch.webdav.password) delete patch.webdav.password // WebDAV 密码同理
      setConfig(mergeFromPanel(getConfig(), { backup: { remote: patch } })) // setConfig 里会重排定时器
      const r = getConfig().backup.remote
      const where = r.provider === 'webdav' ? r.webdav?.url || 'WebDAV' : `${r.owner}/${r.repo}`
      log.info(`云备份设置已更新｜${r.enabled ? `每天 ${r.time} 推 ${where}，留 ${r.keep} 份` : '关'}`)
      return { ok: true, message: '存好了', remote: remoteView() }
    }),
  )
  const doPush = async (pack) => {
    if (pushJob?.running) return { ok: false, message: '上一次推送还没跑完' }
    if (backupJob?.running) return { ok: false, message: '正在打包，等这轮打包完再推' }
    pushJob = { running: true, pack: !!pack, at: Date.now() }
    try {
      const remote: Record<string, any> = getConfig().backup?.remote || {}
      const configOnly = remote.provider === 'webdav' && remote.webdav?.configOnly === true
      let sourceName = ''
      if (pack || configOnly) {
        const result = await createBackup({
          version: VERSION,
          workspaceDir: workspaceDirOf(getConfig()),
          configOnly,
        })
        sourceName = result.name
        log.info(`${configOnly ? '仅配置' : ''}云备份打包完成：${result.name}，${result.files} 个文件`)
      }
      const r = await pushBackup(remote, { version: VERSION, sourceName })
      pushJob = { running: false, ok: true, result: r, at: Date.now() }
      log.info(`云备份推送完成：${r.message}`)
    } catch (error) {
      pushJob = { running: false, ok: false, error: error.message, at: Date.now() }
      log.error('云备份推送失败：', error.message)
    } finally {
      scheduleRemoteBackup() // 打包+推送耗时不定，跑完重排到下一天
    }
    return { ok: true, message: '推送流程跑完了，结果看状态' }
  }
  route(
    '/backup/push',
    backupAction(async () => doPush(false)),
  )
  route(
    '/backup/remote/list',
    backupAction(async () => {
      const r: any = getConfig().backup?.remote || {}
      if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
      try {
        return await listWebdavBackups(r)
      } catch (error) {
        return { ok: false, message: error.message }
      }
    }),
  )
  route(
    '/backup/remote/restore',
    backupAction(async (req) => {
      const r: any = getConfig().backup?.remote || {}
      if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
      const name = String((await readBody(req)).name || '')
      if (!/^aurabot-(?:backup|config)-\d{8}-\d{4}\.zip$/.test(name))
        return { ok: false, message: '备份文件名不对' }
      try {
        const got = await downloadWebdavBackup(r, name)
        const result = await stageReceivedBackup(got.buffer, name)
        log.info(`已从 WebDAV 拉回备份：${name}（${got.buffer.length} 字节）`)
        return result
      } catch (error) {
        return { ok: false, message: error.message }
      }
    }),
  )
  const scheduleRemoteBackup = () => {
    if (pushTimer) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
    const r = getConfig().backup?.remote
    if (!r?.enabled || !alive()) return
    const [hh, mm] = String(r.time || '03:30')
      .split(':')
      .map(Number)
    const next = new Date()
    next.setHours(hh, mm, 0, 0)
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    pushTimer = setTimeout(() => {
      pushTimer = null
      if (alive()) doPush(true)
    }, next.getTime() - Date.now())
    pushTimer.unref?.()
  }
  return { scheduleRemoteBackup, dispose }
}
