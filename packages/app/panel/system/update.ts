import {
  createUpdateChecker,
  hostEnv,
  updatePlan,
  repoOf,
  changelogSection,
} from '../../../../src/core/runtime/update.ts'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { updateExec, runUpdate } from '../../support.ts'
import { moveWorkspace, grantOwner } from '../../../../src/core/runtime/workspace-move.ts'
import { workspaceDirOf } from '../../../../src/chat/hub/index.ts'

export function registerUpdateRoutes({ PKG, log, getConfig, http, ROOT, VERSION }) {
  const { route, query, readBody } = http

  // 更新：检查 GitHub 上有没有新版本；这次更新了什么
  const checkUpdate = createUpdateChecker({ pkg: PKG, log, unstable: () => getConfig().update.unstable })
  // 宿主环境（Windows/macOS/Linux + 桌面版/网页版）决定更新命令怎么写、发布页指向哪
  const updateEnv = hostEnv()
  const updatePlanOf = (result) =>
    updatePlan({
      repo: result.repo || repoOf(PKG),
      channel: result.channel || 'main',
      latest: result.latest || '',
      tag: result.tag || '',
      env: updateEnv,
    })
  route('/update/check', async (req) => {
    const r = await checkUpdate({ force: query(req).force === '1' })
    if (!r || !r.ok) return { ...r, env: updateEnv }
    const plan = updatePlanOf(r)
    return { ...r, ...plan, env: updateEnv, plan }
  })
  let applyingUpdate = false
  route('/update/apply', async () => {
    if (applyingUpdate) return { ok: false, message: '正在更新，稍等一下' }
    const repo = repoOf(PKG)
    if (!repo) return { ok: false, message: '不知道插件从哪安装的，没法自动更新' }
    const checked = await checkUpdate({ force: true })
    if (!checked || !checked.ok || !checked.tag)
      return { ok: false, message: checked?.message || '还没有发布过可安装的版本，等作者发 Release 后再试' }
    if (!checked.newer) return { ok: false, message: '当前没有比已安装版本更新的 Release' }
    const channel = checked.channel === 'beta' ? 'beta' : 'main'
    const plan = updatePlan({ repo, channel, latest: checked.latest, tag: checked.tag, env: updateEnv })
    // 本地 link 安装（开发模式）不能被 CLI 覆盖，否则会把链接换成仓库副本
    try {
      const pkgFile = join(process.env.DSH_PROFILE_DIR || '', 'package.json')
      const dep = JSON.parse(readFileSync(pkgFile, 'utf8'))?.dependencies?.[String(PKG.name)]
      if (dep && String(dep).startsWith('link:')) {
        return {
          ok: false,
          message:
            '当前是本地链接安装（开发模式），自动更新会把它换成仓库副本；请用 git 更新，或手动执行下面这条命令。',
          command: plan.command,
        }
      }
    } catch (error) {}
    applyingUpdate = true
    try {
      const arg = `github:${repo}#${checked.tag}`
      const args = ['plugin', '--profile', updateEnv.profile, 'add', arg]
      const exec = updateExec(updateEnv, args)
      const r = await runUpdate(exec.cmd, exec.cmdArgs, exec.env, exec.shell)
      return { ...r, command: plan.command, env: updateEnv }
    } finally {
      applyingUpdate = false
    }
  })
  route('/changelog', async () => {
    let text = ''
    try {
      text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
    } catch (error) {}
    return { ok: true, version: VERSION, notes: changelogSection(text, VERSION) }
  })
  route('/workspace/move', async (req) => {
    const r = moveWorkspace(workspaceDirOf(getConfig()), (await readBody(req)).to)
    if (r.ok) {
      await grantOwner(r.target, log)
      log.info(r.message)
    }
    return r
  })
}
