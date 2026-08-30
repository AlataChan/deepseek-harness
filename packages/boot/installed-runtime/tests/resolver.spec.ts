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

const nodeProbe = async (): Promise<string> => 'v24.1.0'
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
