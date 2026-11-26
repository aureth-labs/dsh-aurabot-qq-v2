// 给写模块的人的两份文件：接口说明（API.md）与类型提示（aurabot.d.ts），每次启动覆盖成当前版本。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_VERSION, BUILTIN_DIR, DOC, DOC_SRC, TYPES, TYPES_SRC, libKeys } from './loader.ts'
import { selfName } from '../../persona/personas.ts'

export interface CreateDocsOptions {
  userDir: () => string
  version: string
  getConfig: () => Record<string, any>
}

export function createDocs({ userDir, version, getConfig }: CreateDocsOptions) {
  /** 接口说明和类型提示放进 modules/（插件的东西，每次启动都覆盖成当前版本）。 */
  function installDocs(): void {
    try {
      mkdirSync(userDir(), { recursive: true })
      const doc = readFileSync(join(BUILTIN_DIR, DOC_SRC), 'utf8')
        .replaceAll('{{VERSION}}', version)
        .replaceAll('{{API}}', String(API_VERSION))
        .replace('{{LIB}}', libKeys().map((k) => '- `' + k + '`').join('\n'))
      const dest = join(userDir(), DOC)
      if (!existsSync(dest) || readFileSync(dest, 'utf8') !== doc) writeFileSync(dest, doc, 'utf8')
      // 类型提示：模块开头写 /** @type {import('../aurabot').AurabotModule} */，编辑器就有补全
      const types = readFileSync(join(BUILTIN_DIR, TYPES_SRC), 'utf8')
      const tdest = join(userDir(), TYPES)
      if (!existsSync(tdest) || readFileSync(tdest, 'utf8') !== types) writeFileSync(tdest, types, 'utf8')
    } catch (error) {}
  }

  function promptFor(id?: string): string {
    const dir = id ? join(userDir(), id) : userDir()
    return `帮我修改 Aurabot（${selfName(getConfig())} QQ 插件）的扩展模块：${dir}\n`
      + `先完整读一遍「${join(userDir(), DOC)}」了解模块怎么写、能用哪些接口，再按我的要求改：\n`
      + '【这里写你想让她多会什么、改成什么样】\n'
      + `只改 ${userDir()} 里的文件，不要动插件本身的代码；改完保存会自动重新加载，到面板「已安装」页看有没有报错，再告诉我怎么试。`
  }

  return { installDocs, promptFor }
}
