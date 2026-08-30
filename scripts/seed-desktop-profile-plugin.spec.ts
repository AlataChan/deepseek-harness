import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'
import {
  fetchWorkspacePlugin,
  installPluginIntoProfile,
  mergeProfileManifest,
  validatePluginDir,
} from './seed-desktop-profile-plugin.mjs'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

const SHIPPED = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-desktop-app',
]

function writePlugin(root: string, name = 'dsh-context', version = '0.36.0'): string {
  const dir = join(root, name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'index.js'), 'export {}\n')
  writeFileSync(join(dir, 'lib', 'client.js'), 'export {}\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-context\n      name: dsh-context\n')
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name,
    version,
    main: 'lib/index.js',
    exports: { './client': './lib/client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [] },
    },
  }, undefined, 2)}\n`)
  return dir
}

describe('seed-desktop-profile-plugin', () => {
  it('rejects a directory that is not a dsh.bundle + dsh.client package', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-bad-'))
    fixtures.push(root)
    mkdirSync(join(root, 'empty'))
    writeFileSync(join(root, 'empty', 'package.json'), '{"name":"nope","version":"1.0.0"}\n')
    expect(() => validatePluginDir(join(root, 'empty'))).toThrow('dsh.bundle.patch')
  })

  it('creates a desktop profile and appends the plugin on first install', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-first-'))
    fixtures.push(root)
    const plugin = writePlugin(root)
    const profile = join(root, 'desktop')
    const result = installPluginIntoProfile(plugin, profile, SHIPPED)
    expect(result.firstInstall).toBe(true)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toEqual([...SHIPPED, 'dsh-context'])
    expect(manifest.dependencies['dsh-context']).toBe('0.36.0')
    expect(validatePluginDir(join(profile, 'node_modules', 'dsh-context')).version).toBe('0.36.0')
  })

  it('does not re-insert a bundle the user removed when the package is already present', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-keep-'))
    fixtures.push(root)
    const plugin = writePlugin(root)
    const profile = join(root, 'desktop')
    installPluginIntoProfile(plugin, profile, SHIPPED)
    const afterRemove = mergeProfileManifest(
      JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')),
      { name: 'dsh-context', version: '0.36.0' },
      { firstInstall: false },
    )
    afterRemove.dsh.profile.bundles = [...SHIPPED]
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify(afterRemove, undefined, 2)}\n`)
    const result = installPluginIntoProfile(plugin, profile, SHIPPED)
    expect(result.firstInstall).toBe(false)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toEqual(SHIPPED)
    expect(manifest.dependencies['dsh-context']).toBe('0.36.0')
  })

  it('installs a scoped package name under node_modules/@scope/name', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-scoped-'))
    fixtures.push(root)
    const name = '@deepseek-ai/dsh-experimental-desktop-files'
    const plugin = writePlugin(root, name, '0.1.1-rc.5')
    const profile = join(root, 'desktop')
    const result = installPluginIntoProfile(plugin, profile, SHIPPED)
    expect(result.dest).toBe(join(profile, 'node_modules', '@deepseek-ai', 'dsh-experimental-desktop-files'))
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dependencies[name]).toBe('0.1.1-rc.5')
    expect(validatePluginDir(result.dest).name).toBe(name)
  })

  it('rejects a dest that is a symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-symlink-'))
    fixtures.push(root)
    const plugin = writePlugin(root)
    const profile = join(root, 'desktop')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    symlinkSync(plugin, join(profile, 'node_modules', 'dsh-context'))
    expect(() => installPluginIntoProfile(plugin, profile, SHIPPED)).toThrow('symlink')
  })

  it('copies a workspace pin under the scoped dest and skips node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-seed-workspace-'))
    fixtures.push(root)
    const name = '@deepseek-ai/dsh-experimental-desktop-files'
    const plugin = writePlugin(root, name, '0.1.1-rc.5')
    mkdirSync(join(plugin, 'node_modules', 'left-behind'), { recursive: true })
    writeFileSync(join(plugin, 'node_modules', 'left-behind', 'x'), 'nope\n')
    const dest = fetchWorkspacePlugin(
      { name, version: '0.1.1-rc.5', source: 'workspace', path: plugin },
      join(root, 'out'),
    )
    expect(dest).toBe(join(root, 'out', '@deepseek-ai', 'dsh-experimental-desktop-files'))
    expect(validatePluginDir(dest).name).toBe(name)
    expect(existsSync(join(dest, 'node_modules'))).toBe(false)
  })
})
