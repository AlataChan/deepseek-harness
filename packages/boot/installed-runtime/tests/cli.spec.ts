/** Installed-runtime CLI prints one JSON object and fails closed. */

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function stageDesktopPackage(): { companion: string; packageRoot: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-cli-')))
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const companion = join(packageRoot, 'lib', 'desktop-companion.js')
  mkdirSync(dirname(companion), { recursive: true })
  writeFileSync(companion, '#!/usr/bin/env node\n')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.1.0-rc.5',
    dsh: { companions: { desktop: './lib/desktop-companion.js' } },
  }))
  return { packageRoot, companion }
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', cli, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout, stderr }) })
  })
}

describe('installed-runtime CLI', () => {
  it('prints one JSON runtime object on stdout', async () => {
    const runtime = stageDesktopPackage()
    const result = await run([
      '--companion', 'desktop',
      '--accepted', '@deepseek-ai/dsh',
      '--runtime-path', runtime.packageRoot,
      '--node-path', process.execPath,
    ])
    expect(result.code).toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      companionEntry: runtime.companion,
      runtimeVersion: '0.1.0-rc.5',
    })
  })

  it('exits non-zero with one JSON error object when the package is missing', async () => {
    const result = await run([
      '--companion', 'vscode',
      '--accepted', '@deepseek-ai/dsh',
      '--runtime-path', join(tmpdir(), 'missing-dsh-runtime'),
      '--node-path', process.execPath,
    ])
    expect(result.code).not.toBe(0)
    const payload = result.stdout.trim() || result.stderr.trim()
    const lines = payload.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string) as { error?: unknown }
    expect(typeof parsed.error).toBe('string')
    expect(parsed.error).toMatch(/does not exist|not found/i)
  })

  function stageNodeStub(version: string): string {
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`refusing stub version ${version}`)
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-node-stub-')))
    const path = join(root, 'node')
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`)
    chmodSync(path, 0o755)
    return path
  }

  it.runIf(process.platform !== 'win32').each([
    'v22.19.0',
    'v22.23.2',
    'v23.11.0',
    'v24.0.0',
    'v24.8.0',
  ])('public CLI process rejects a version stub that prints %s', async (version) => {
    const runtime = stageDesktopPackage()
    const result = await run([
      '--companion', 'desktop',
      '--accepted', '@deepseek-ai/dsh',
      '--runtime-path', runtime.packageRoot,
      '--node-path', stageNodeStub(version),
    ])
    expect(result.code).not.toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string) as { error?: unknown }
    expect(parsed.error).toBe(
      `Node ${version} is not a supported Harness runtime (>=24.9.0). Install Node.js 24.9.0 or newer (current 24 or 26). Node.js 22, 23, and 24.0.0 through 24.8.x are rejected. The packaged desktop app provisions Node.js 24.14.0. Verify with node --version.`,
    )
  })

  it.runIf(process.platform !== 'win32').each([
    'v24.9.0',
    'v24.14.0',
  ])('public CLI process accepts a version stub that prints %s', async (version) => {
    const runtime = stageDesktopPackage()
    const result = await run([
      '--companion', 'desktop',
      '--accepted', '@deepseek-ai/dsh',
      '--runtime-path', runtime.packageRoot,
      '--node-path', stageNodeStub(version),
    ])
    expect(result.code, result.stdout || result.stderr).toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      companionEntry: runtime.companion,
      runtimeVersion: '0.1.0-rc.5',
    })
  })
})
