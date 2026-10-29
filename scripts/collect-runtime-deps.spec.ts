/** Installed closures preserve incompatible transitive modules and cyclic dependency lookup. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, lstat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const collector = fileURLToPath(new URL('./collect-runtime-deps.mjs', import.meta.url))

it('retains a CommonJS dependency alongside an incompatible root ESM version without symlinks or cycle expansion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-collector-versions-'))
  async function module(path: string, metadata: Record<string, unknown>, code: string): Promise<void> {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify({ ...metadata, main: 'index.js' }))
    await writeFile(join(path, 'index.js'), code)
  }
  try {
    const anchor = join(root, 'source/package.json')
    await mkdir(join(root, 'source'), { recursive: true })
    await writeFile(anchor, JSON.stringify({ dependencies: { common: '4.0.0', a: '1.0.0' } }))
    await module(join(root, 'source/node_modules/common'), { name: 'common', version: '4.0.0', type: 'module' }, 'export default "esm-four"')
    await module(join(root, 'source/node_modules/a'), { name: 'a', version: '1.0.0', dependencies: { common: '3.0.0' } },
      'exports.name = "a"; exports.value = () => require("common")()')
    await module(join(root, 'source/node_modules/a/node_modules/common'), { name: 'common', version: '3.0.0', dependencies: { a: '1.0.0' } },
      'module.exports = () => "cjs-three-via-" + require("a").name')
    const flat = join(root, 'flat/node_modules')
    execFileSync(process.execPath, [collector, anchor, flat])
    const probe = 'import {createRequire}from"node:module";const r=createRequire(process.argv[1]+"/package.json");console.log(r("a").value())'
    const control = spawnSync(process.execPath, ['--input-type=module', '-e', probe, join(root, 'flat')], { encoding: 'utf8' })
    expect(control.status).not.toBe(0)
    const retained = join(root, 'retained/node_modules')
    execFileSync(process.execPath, [collector, '--preserve-dependency-versions', anchor, retained])
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', probe, join(root, 'retained')], { encoding: 'utf8' }).trim())
      .toBe('cjs-three-via-a')
    expect(execFileSync(process.execPath, ['--input-type=module', '-e',
      'console.log((await import(process.argv[1])).default)', join(retained, 'common/index.js')], { encoding: 'utf8' }).trim()).toBe('esm-four')
    for (const path of await readdir(retained, { recursive: true })) {
      expect((await lstat(join(retained, path))).isSymbolicLink()).toBe(false)
    }
    expect((await readdir(join(retained, 'a/node_modules')))).toEqual(['common'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
