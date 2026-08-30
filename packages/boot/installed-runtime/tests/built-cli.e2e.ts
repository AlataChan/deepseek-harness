/** Built `lib/cli.js` must run after a native shell copies that file alone. */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const builtCli = join(pkgDir, 'lib', 'cli.js')

function stageDesktopPackage(): { companion: string; packageRoot: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-built-cli-')))
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

function run(cli: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
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

describe.skipIf(!existsSync(builtCli))('built installed-runtime CLI', () => {
  it('resolves after a directory contains only cli.js', async () => {
    const runtime = stageDesktopPackage()
    const isolated = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-relocated-')))
    const relocated = join(isolated, 'installed-runtime-cli.js')
    copyFileSync(builtCli, relocated)
    const result = await run(relocated, [
      '--companion', 'desktop',
      '--accepted', '@deepseek-ai/dsh',
      '--runtime-path', runtime.packageRoot,
      '--node-path', process.execPath,
    ])
    expect(result.stderr, result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/)
    expect(result.code, result.stderr || result.stdout).toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      companionEntry: runtime.companion,
      runtimeVersion: '0.1.0-rc.5',
    })
  })
})
