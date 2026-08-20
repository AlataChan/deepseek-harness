/** Installed runtime discovery without executing package-manager shims. */

import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveInstalledRuntime } from '../src/runtime-resolver.ts'

const fixtures = fileURLToPath(new URL('./fixtures/runtime-shims/', import.meta.url))

interface StagedRuntime {
  bin: string
  companion: string
  packageRoot: string
  root: string
}

function stageRuntime(name = '@deepseek-ai/dsh'): StagedRuntime {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-vscode-resolver-')))
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const bin = join(packageRoot, 'lib', 'bin.js')
  const companion = join(packageRoot, 'lib', 'vscode-companion.js')
  mkdirSync(dirname(bin), { recursive: true })
  writeFileSync(bin, '#!/usr/bin/env node\n')
  writeFileSync(companion, '#!/usr/bin/env node\n')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0-rc.5',
    engines: { node: '^22.19.0 || >=24.0.0' },
    bin: { dsh: './lib/bin.js' },
    dsh: { companions: { vscode: './lib/vscode-companion.js' } },
  }))
  return { root, packageRoot, bin, companion }
}

function stageNode(root: string): string {
  const path = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
  mkdirSync(root, { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
  return path
}

function stageShim(runtime: StagedRuntime, fixture: string, name: string): string {
  const path = join(runtime.root, 'bin', name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, readFileSync(join(fixtures, fixture), 'utf8'))
  chmodSync(path, 0o755)
  return path
}

const nodeProbe = async (): Promise<string> => 'v24.1.0'

describe('installed VS Code runtime resolver', () => {
  it('accepts a package root, manifest, or published JavaScript bin and verifies the companion declaration', async () => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    for (const runtimePath of [runtime.packageRoot, join(runtime.packageRoot, 'package.json'), runtime.bin]) {
      await expect(resolveInstalledRuntime({ runtimePath, nodePath, nodeProbe })).resolves.toMatchObject({
        nodePath,
        packageRoot: runtime.packageRoot,
        companionEntry: runtime.companion,
        runtimeVersion: '0.1.0-rc.5',
      })
    }
  })

  it('resolves a POSIX symlink and recognized pnpm shell shim only as package clues', async () => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    const link = join(runtime.root, 'dsh-link')
    symlinkSync(runtime.bin, link)
    await expect(resolveInstalledRuntime({ runtimePath: link, nodePath, nodeProbe })).resolves
      .toMatchObject({ companionEntry: runtime.companion })

    const shim = stageShim(runtime, 'pnpm.sh', 'dsh')
    await expect(resolveInstalledRuntime({ runtimePath: shim, nodePath, nodeProbe })).resolves
      .toMatchObject({ companionEntry: runtime.companion })
  })

  it.each([
    { fixture: 'npm.cmd', name: 'dsh.cmd' },
    { fixture: 'pnpm.ps1', name: 'dsh.ps1' },
  ])('resolves a recognized Windows package-manager shim ($name)', async ({ fixture, name }) => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    const shim = stageShim(runtime, fixture, name)
    await expect(resolveInstalledRuntime({ runtimePath: shim, nodePath, nodeProbe, platform: 'win32' }))
      .resolves.toMatchObject({ companionEntry: runtime.companion })
  })

  it('discovers real Node and a dsh clue from PATH without executing either candidate', async () => {
    const runtime = stageRuntime()
    const binDir = join(runtime.root, 'bin')
    const nodePath = stageNode(binDir)
    const shim = stageShim(runtime, 'pnpm.sh', 'dsh')
    const result = await resolveInstalledRuntime({ pathValue: binDir, nodeProbe })
    expect(result).toMatchObject({ nodePath, companionEntry: runtime.companion, discoveryPath: shim })
  })

  it('rejects unknown shims, wrong package identities, missing companions, and incompatible Node', async () => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    const unknown = stageShim(runtime, 'unknown.cmd', 'dsh.cmd')
    await expect(resolveInstalledRuntime({ runtimePath: unknown, nodePath, nodeProbe, platform: 'win32' }))
      .rejects.toThrow(/unrecognized.*shim/i)

    const wrong = stageRuntime('@someone-else/dsh')
    await expect(resolveInstalledRuntime({ runtimePath: wrong.packageRoot, nodePath, nodeProbe }))
      .rejects.toThrow(/package name/i)

    writeFileSync(join(runtime.packageRoot, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh', version: '0.1.0', dsh: { companions: {} },
    }))
    await expect(resolveInstalledRuntime({ runtimePath: runtime.packageRoot, nodePath, nodeProbe }))
      .rejects.toThrow(/companion/i)

    await expect(resolveInstalledRuntime({
      runtimePath: wrong.bin,
      nodePath,
      nodeProbe: async () => 'v20.0.0',
    })).rejects.toThrow(/Node.*compatible/i)
  })

  it('reports actionable missing runtime and Node diagnostics', async () => {
    const runtime = stageRuntime()
    await expect(resolveInstalledRuntime({ runtimePath: runtime.packageRoot, pathValue: '', nodeProbe }))
      .rejects.toThrow(/Node executable/i)
    const nodePath = stageNode(runtime.root)
    await expect(resolveInstalledRuntime({ nodePath, pathValue: '', nodeProbe }))
      .rejects.toThrow(/Harness runtime/i)
  })

  it('requires the declared companion to be JavaScript', async () => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    const typedEntry = join(runtime.packageRoot, 'lib', 'vscode-companion.ts')
    writeFileSync(typedEntry, '')
    writeFileSync(join(runtime.packageRoot, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.0-rc.5',
      dsh: { companions: { vscode: './lib/vscode-companion.ts' } },
    }))
    await expect(resolveInstalledRuntime({ runtimePath: runtime.packageRoot, nodePath, nodeProbe }))
      .rejects.toThrow(/JavaScript/i)
  })

  it.runIf(process.platform !== 'win32')('rejects a companion symlink that escapes the installed package', async () => {
    const runtime = stageRuntime()
    const nodePath = stageNode(runtime.root)
    const outside = join(runtime.root, 'outside.js')
    writeFileSync(outside, '')
    unlinkSync(runtime.companion)
    symlinkSync(outside, runtime.companion)
    await expect(resolveInstalledRuntime({ runtimePath: runtime.packageRoot, nodePath, nodeProbe }))
      .rejects.toThrow(/inside the installed package/i)
  })
})
