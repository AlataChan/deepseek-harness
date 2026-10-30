import { expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, type TsdownBundle, type UserConfig } from 'tsdown'
import { assertPortableImImports } from './verify-desktop-im-installed-flows.mjs'

const loaded = await import(new URL('../packages/experimental/desktop-im/tsdown.config.ts', import.meta.url).href) as {
  default: (options: Pick<UserConfig, 'env'>) => UserConfig[]
}
const host = loaded.default({ env: { DSH_BUILD_FACE: 'host' } })[0]!
const alwaysBundle = host.deps?.alwaysBundle
if (alwaysBundle === undefined) throw new Error('Desktop IM must inline its delivery adapters')
const external = host.deps?.neverBundle
if (typeof external !== 'function') throw new Error('Desktop IM must configure its Host dependency filter')

it('bundles filesystem imports on POSIX, Windows drives and UNC shares', () => {
  for (const path of ['/workspace/adapter.js', 'C:/workspace/adapter.js', 'C:\\workspace\\adapter.js', '\\\\server\\share\\adapter.js', './adapter.js']) {
    expect(external(path, undefined, true)).toBe(false)
  }
  expect(external('node:sqlite', undefined, false)).toBe(false)
  expect(external('@deepseek-ai/dsh-experimental-im-feishu/desktop', undefined, false)).toBe(false)
  expect(external('@deepseek-ai/dsh-agent', undefined, false)).toBe(true)
  for (const source of ["import 'C:/workspace/adapter.js'", "import('/workspace/adapter.js')", "import('file:///workspace/adapter.js')"]) {
    expect(() => { assertPortableImImports(source) }).toThrow('absolute filesystem import')
  }
})

it('inlines a resolved Windows alias and detects an external-path negative control', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-im-bundle-')))
  const bundles: TsdownBundle[] = []
  try {
    await writeFile(join(root, 'entry.mjs'), "import {value} from '@deepseek-ai/dsh-experimental-im-feishu/desktop'; export const result=value;\n")
    await writeFile(join(root, 'adapter.mjs'), 'export const value=42;\n')
    for (const broken of [false, true]) {
      const outDir = join(root, broken ? 'broken' : 'valid')
      bundles.push(...await build({ cwd: root, entry: ['entry.mjs'], outDir, format: 'esm', config: false, logLevel: 'silent',
        alias: { '@deepseek-ai/dsh-experimental-im-feishu/desktop': join(root, 'adapter.mjs') },
        deps: { alwaysBundle, neverBundle: (id, importer, resolved) => {
          const windowsId = id.startsWith(root) ? `C:${id}` : id
          if (broken && windowsId.startsWith('C:')) return true
          return external(windowsId, importer, resolved)
        } } }))
      const output = await readFile(join(outDir, 'entry.mjs'), 'utf8')
      expect(/^import /m.test(output)).toBe(broken)
      if (broken) expect(() => { assertPortableImImports(output) }).toThrow('absolute filesystem import')
      else { assertPortableImImports(output); expect(output).toContain('42') }
    }
  } finally {
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
    await rm(root, { recursive: true, force: true })
  }
})
