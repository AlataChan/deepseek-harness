import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { machOFiles, nestedCodeBundles, prepareDesktopMachO, signDesktopMachO } from './sign-desktop-macos.ts'

const native = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawnSync: native }))
afterEach(() => { native.mockReset() })

it('prepares embedded addons and helpers while retaining the downloaded Node signature', () => {
  const app = mkdtempSync(join(tmpdir(), 'desktop-preparation-signatures-'))
  try {
    const resources = join(app, 'Contents/Resources/resources')
    mkdirSync(resources, { recursive: true })
    const node = join(resources, 'node')
    const addon = join(resources, 'addon.node')
    const helper = join(resources, 'helper')
    for (const path of [node, addon, helper]) writeFileSync(path, Buffer.from('cffaedfe00000000', 'hex'))
    native.mockReturnValue({ status: 0, stderr: '' })
    prepareDesktopMachO(app)
    expect(native.mock.calls[0]?.[1]).toEqual(['--verify', '--strict', node])
    const signed = native.mock.calls.filter(call => call[1].includes('--force')).map(call => call[1].at(-1))
    expect(signed).toEqual([addon, helper])
    native.mockImplementation((_command, args) => ({
      status: args.includes('--verify') && args.at(-1) === addon ? 1 : 0,
      stderr: 'invalid addon signature',
    }))
    expect(() => { prepareDesktopMachO(app) }).toThrow(/verify prepared native code/)
  } finally { rmSync(app, { recursive: true, force: true }) }
})

describe('native desktop signing inventory', () => {
  it('includes extensionless helpers and dylibs while skipping aliases and data', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-native-code-'))
    try {
      mkdirSync(join(root, 'nested'))
      for (const name of ['rg', 'spawn-helper', 'nested/libvips.dylib', 'nested/libsherpa.dylib', 'addon.node']) {
        writeFileSync(join(root, name), Buffer.from('cffaedfe00000000', 'hex'))
      }
      writeFileSync(join(root, 'universal'), Buffer.from('cafebabe00000002', 'hex'))
      writeFileSync(join(root, 'Java.class'), Buffer.from('cafebabe00000042', 'hex'))
      writeFileSync(join(root, 'data.json'), '{}')
      symlinkSync('nested', join(root, 'alias'))
      expect(machOFiles(root).map(path => path.slice(root.length + 1)).sort()).toEqual([
        'addon.node', 'nested/libsherpa.dylib', 'nested/libvips.dylib', 'rg', 'spawn-helper', 'universal',
      ])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

it('signs nested app and framework containers after their contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-native-bundles-'))
  try {
    mkdirSync(join(root, 'Office.app/Contents/Frameworks/Native.framework'), { recursive: true })
    symlinkSync('Office.app', join(root, 'Alias.app'))
    expect(nestedCodeBundles(root).map(path => path.slice(root.length + 1))).toEqual([
      'Office.app/Contents/Frameworks/Native.framework', 'Office.app',
    ])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('refuses a native signer failure and verifies runtime, timestamp and team on every signed file', () => {
  const app = mkdtempSync(join(tmpdir(), 'desktop-signatures-'))
  try {
    mkdirSync(join(app, 'Contents/Resources/resources'), { recursive: true })
    const node = join(app, 'Contents/Resources/resources/node')
    writeFileSync(node, Buffer.from('cffaedfe00000000', 'hex'))
    native.mockReturnValue({ status: 1, stderr: 'injected signing failure' })
    expect(() => { signDesktopMachO(app, 'Developer ID', 'TEAM', 'node.plist') }).toThrow(/Signing native code failed/)
    expect(native).toHaveBeenCalledTimes(1)
    native.mockReset().mockReturnValue({ status: 0, stderr: 'TeamIdentifier=TEAM\nflags=0x10000(runtime)\nTimestamp=Oct 18\n' })
    signDesktopMachO(app, 'Developer ID', 'TEAM', 'node.plist')
    expect(native.mock.calls.every(call => call[0] === '/usr/bin/codesign')).toBe(true)
    expect(native.mock.calls[0]?.[1]).toContain('--entitlements')
    expect(native.mock.calls[0]?.[1]).toContain('node.plist')
    expect(native.mock.calls[1]?.[1]).toEqual(['--verify', '--strict', node])
    for (const stderr of ['TeamIdentifier=OTHER\nflags=runtime\nTimestamp=t', 'TeamIdentifier=TEAM\nTimestamp=t', 'TeamIdentifier=TEAM\nflags=runtime']) {
      native.mockReturnValue({ status: 0, stderr })
      expect(() => { signDesktopMachO(app, 'Developer ID', 'TEAM', 'node.plist') }).toThrow(/lacks the required Developer ID/)
    }
  } finally { rmSync(app, { recursive: true, force: true }) }
})
