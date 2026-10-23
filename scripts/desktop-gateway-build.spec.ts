/** Desktop Host linking must consume emitted inputs, never a concurrently rebuilt library. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type TsdownBundle, type UserConfig } from 'tsdown'
import { expect, it } from 'vitest'

it('ignores a stale process-carrier library while linking the desktop Host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-gateway-build-'))
  let bundles: TsdownBundle[] = []
  try {
    const write = (path: string, text: string): void => {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    const packageRoot = 'packages/client/connection-desktop'
    const processRoot = 'packages/client/connection-process'
    const preset = pathToFileURL(join(import.meta.dirname, '../packages/client/tsdown.client.ts')).href
    const config = readFileSync(join(import.meta.dirname, '../packages/client/connection-desktop/tsdown.config.ts'), 'utf8')
      .replace("'../tsdown.client.ts'", JSON.stringify(preset))
      .replace('inline: { env?: { DSH_BUILD_FACE?: string } }', 'inline')
      .replace('resolveId(source: string)', 'resolveId(source)')
    write(`${packageRoot}/tsdown.config.mjs`, config)
    write(`${packageRoot}/package.json`, '{"name":"@deepseek-ai/dsh-client-connection-desktop","type":"module"}')
    write(`${packageRoot}/lib/types/index.js`, 'export { revision } from "@deepseek-ai/dsh-client-connection-process"')
    write(`${processRoot}/lib/types/index.js`, 'export const revision = "current-emitted-gateway"')
    write(`${packageRoot}/node_modules/@deepseek-ai/dsh-client-connection-process/package.json`, '{"type":"module","exports":"./index.js"}')
    write(`${packageRoot}/node_modules/@deepseek-ai/dsh-client-connection-process/index.js`, 'export const revision = "stale-published-gateway"')
    const loaded = await import(pathToFileURL(join(root, packageRoot, 'tsdown.config.mjs')).href) as {
      default: (options: { env: { DSH_BUILD_FACE: string } }) => UserConfig[]
    }
    const configNode = loaded.default({ env: { DSH_BUILD_FACE: 'client' } })
      .find(item => item?.platform === 'node')
    if (configNode === undefined) throw new Error('Desktop Host config missing')
    bundles = await build({
      ...configNode, cwd: join(root, packageRoot), config: false, tsconfig: false,
      write: false, clean: false, exports: false, report: false, logLevel: 'silent',
    })
    const output = bundles.flatMap(bundle => bundle.chunks)
      .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n')
    expect(output).toContain('current-emitted-gateway')
    expect(output).not.toContain('stale-published-gateway')
  } finally {
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
    rmSync(root, { recursive: true, force: true })
  }
})
