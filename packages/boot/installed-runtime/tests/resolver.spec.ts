/** Installed runtime discovery for both accepted package names and companion keys. */

import {
  chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInstalledRuntime } from '../src/index.ts'

interface StagedRuntime {
  companion: string
  packageRoot: string
  root: string
}

function stageRuntime(name: string, companion: 'vscode' | 'desktop'): StagedRuntime {
  const scope = name.split('/')[0]?.slice(1)
  const pkg = name.split('/')[1]
  if (scope === undefined || pkg === undefined) throw new Error(`invalid package name: ${name}`)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-')))
  const packageRoot = join(root, 'node_modules', `@${scope}`, pkg)
  const companionFile = `${companion}-companion.js`
  const companionPath = join(packageRoot, 'lib', companionFile)
  mkdirSync(dirname(companionPath), { recursive: true })
  writeFileSync(join(packageRoot, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  writeFileSync(companionPath, '#!/usr/bin/env node\n')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0-rc.5',
    dsh: { companions: { [companion]: `./lib/${companionFile}` } },
  }))
  return { root, packageRoot, companion: companionPath }
}

function stageNode(root: string): string {
  const path = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
  mkdirSync(root, { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
  return path
}

const nodeProbe = async (): Promise<string> => 'v24.14.0'
const accepted = ['@deepseek-ai/dsh', '@alatastudio/dsh'] as const

describe('installed runtime resolver', () => {
  it.each([
    ['@deepseek-ai/dsh', 'vscode'],
    ['@deepseek-ai/dsh', 'desktop'],
    ['@alatastudio/dsh', 'vscode'],
    ['@alatastudio/dsh', 'desktop'],
  ] as const)('resolves %s for the %s companion', async (name, companion) => {
    const runtime = stageRuntime(name, companion)
    const nodePath = stageNode(runtime.root)
    await expect(resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath, nodeProbe },
      { acceptedPackageNames: accepted, companion },
    )).resolves.toMatchObject({
      nodePath,
      packageRoot: runtime.packageRoot,
      companionEntry: runtime.companion,
      runtimeVersion: '0.1.0-rc.5',
    })
  })

  it('rejects a package whose name is in neither accepted set', async () => {
    const runtime = stageRuntime('@someone-else/dsh', 'vscode')
    const nodePath = stageNode(runtime.root)
    await expect(resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath, nodeProbe },
      { acceptedPackageNames: accepted, companion: 'vscode' },
    )).rejects.toThrow(/package name/i)
  })

  it.runIf(process.platform !== 'win32')('rejects a companion entry outside the installed package', async () => {
    const runtime = stageRuntime('@deepseek-ai/dsh', 'desktop')
    const nodePath = stageNode(runtime.root)
    const outside = join(runtime.root, 'outside.js')
    writeFileSync(outside, '')
    unlinkSync(runtime.companion)
    symlinkSync(outside, runtime.companion)
    await expect(resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath, nodeProbe },
      { acceptedPackageNames: accepted, companion: 'desktop' },
    )).rejects.toThrow(/inside the installed package/i)
  })

  it('rejects a .cmd node executable', async () => {
    const runtime = stageRuntime('@deepseek-ai/dsh', 'vscode')
    await expect(resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath: join(runtime.root, 'node.cmd'), nodeProbe },
      { acceptedPackageNames: accepted, companion: 'vscode' },
    )).rejects.toThrow(/\.cmd/i)
  })

  it('rejects an unrecognized shim format', async () => {
    const runtime = stageRuntime('@deepseek-ai/dsh', 'vscode')
    const nodePath = stageNode(runtime.root)
    const shim = join(runtime.root, 'bin', 'dsh.cmd')
    mkdirSync(dirname(shim), { recursive: true })
    writeFileSync(shim, '@ECHO off\nCALL arbitrary-tool --run-dsh %*\n')
    await expect(resolveInstalledRuntime(
      { runtimePath: shim, nodePath, nodeProbe, platform: 'win32' },
      { acceptedPackageNames: accepted, companion: 'vscode' },
    )).rejects.toThrow(/unrecognized.*shim/i)
  })
})

describe('node runtime floor probes', () => {
  function resolveAt(version: string): ReturnType<typeof resolveInstalledRuntime> {
    const runtime = stageRuntime('@deepseek-ai/dsh', 'desktop')
    const nodePath = stageNode(runtime.root)
    return resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath, nodeProbe: async () => version },
      { acceptedPackageNames: accepted, companion: 'desktop' },
    )
  }

  it.each([
    'v22.0.0',
    'v22.19.0',
    'v22.23.2',
    'v23.0.0',
    'v23.11.0',
    'v24.0.0',
    'v24.1.0',
    'v24.8.0',
    'v24.8.99',
  ])('rejects probed %s and names the floor', async (version) => {
    await expect(resolveAt(version)).rejects.toThrow(
      `Node ${version} is not a supported Harness runtime (>=24.9.0). Install Node.js 24.9.0 or newer`,
    )
  })

  it.each([
    'v24.9.0',
    'v24.14.0',
    'v24.14.1',
    'v26.0.0',
    'v26.8.0',
  ])('accepts probed %s', async (version) => {
    await expect(resolveAt(version)).resolves.toMatchObject({ runtimeVersion: '0.1.0-rc.5' })
  })

  it('rejects an unparsable probe', async () => {
    await expect(resolveAt('not-a-version')).rejects.toThrow(/invalid version/)
    await expect(resolveAt('v24.9')).rejects.toThrow(/invalid version/)
  })

  it('executes node --version on this process and accepts that executable', async () => {
    const runtime = stageRuntime('@deepseek-ai/dsh', 'desktop')
    const nodePath = realpathSync(process.execPath)
    await expect(resolveInstalledRuntime(
      { runtimePath: runtime.packageRoot, nodePath: process.execPath },
      { acceptedPackageNames: accepted, companion: 'desktop' },
    )).resolves.toMatchObject({ nodePath, runtimeVersion: '0.1.0-rc.5' })
  })
})
