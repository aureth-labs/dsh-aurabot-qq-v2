import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function bundleAdapters(root, output) {
  for (const folder of ['qq/onebot-v11', 'qq/qq-official', 'satori']) {
    const source = join(root, 'packages', 'adapters', folder)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const target = join(output, manifest.name)
    await mkdir(target, { recursive: true })
    await build({
      entryPoints: [join(source, manifest.main)],
      outfile: join(target, 'index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      legalComments: 'none',
    })
    await writeFile(join(target, 'package.json'), JSON.stringify({ ...manifest, main: './index.js' }, null, 2) + '\n')
    await copyFile(join(root, 'LICENSE'), join(target, 'LICENSE'))
  }
}
