import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function bundleSdk(root, target) {
  await mkdir(target, { recursive: true })
  await build({
    entryPoints: [join(root, 'packages/sdk/index.ts')],
    outfile: join(target, 'index.mjs'),
    bundle: true, platform: 'node', target: 'node22', format: 'esm', legalComments: 'none',
  })
  for (const file of ['aurabot.d.ts', 'package.json', 'API.md']) {
    await copyFile(join(root, 'packages/sdk', file), join(target, file))
  }
  await copyFile(join(root, 'LICENSE'), join(target, 'LICENSE'))
}
