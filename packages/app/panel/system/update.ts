import { createUpdateChecker, changelogSection } from '../../../../src/core/runtime/update.ts'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { moveWorkspace, grantOwner } from '../../../../src/core/runtime/workspace-move.ts'
import { workspaceDirOf } from '../../../modules/chat-bridge/qq/index.ts'

export function registerUpdateRoutes({ PKG, log, getConfig, http, ROOT, VERSION }) {
  const { route, query, readBody } = http

  const check = createUpdateChecker({ pkg: PKG, log, unstable: () => getConfig().update.unstable })
  route('/update/check', req => check({ force: query(req).force === '1' }))
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
