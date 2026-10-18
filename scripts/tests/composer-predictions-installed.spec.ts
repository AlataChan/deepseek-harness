/** Reject incomplete installed targets before any product process can run. */
import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// This JavaScript verifier is also the supported standalone installed gate.
import { validateInstalledTarget, installedVerificationPath } from '../verify-composer-predictions-installed-flows.mjs'

function withFixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'prediction-verifier-negative-'))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('installed prediction verifier negative controls', () => {
  it('excludes developer tools even when the invoking environment exposes them', () => {
    withFixture((root) => {
      const developer = join(root, 'developer-tools'); mkdirSync(developer)
      const embedded = join(root, 'embedded'); mkdirSync(embedded)
      const command = process.platform === 'win32' ? 'prediction-developer-only.exe' : 'prediction-developer-only'
      const executable = join(developer, command)
      writeFileSync(executable, '#!/bin/sh\nexit 73\n'); chmodSync(executable, 0o755)
      vi.stubEnv('PATH', developer)
      try {
        const path = installedVerificationPath(join(embedded, process.platform === 'win32' ? 'node.exe' : 'node'))
        expect(path).not.toContain(developer)
        const result = spawnSync(command, [], { env: { ...process.env, PATH: path }, timeout: 5000 })
        expect(result.error).toMatchObject({ code: 'ENOENT' })
      } finally { vi.unstubAllEnvs() }
    })
  })
  it.skipIf(process.platform !== 'darwin')('admits macOS system sqlite without a developer installation', () => {
    withFixture((root) => {
      const path = installedVerificationPath(join(root, 'node'))
      const result = spawnSync('sqlite3', ['-safe', '-batch', ':memory:', 'SELECT 1;'], {
        env: { PATH: path }, encoding: 'utf8', timeout: 5000,
      })
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })
  })
  it('standalone command fails closed without a target', () => {
    const script = fileURLToPath(new URL('../verify-composer-predictions-installed-flows.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Explicit installed')
    expect(result.stdout).not.toContain('passed')
  })
  it('requires an explicit target instead of falling back to checkout gates', () => {
    expect(() => validateInstalledTarget()).toThrow(/Explicit installed/)
  })
  it('rejects a nonexistent target', () => {
    withFixture((root) => { expect(() => validateInstalledTarget(join(root, 'absent'))).toThrow() })
  })
  it('rejects an empty application directory', () => {
    withFixture((root) => { expect(() => validateInstalledTarget(root)).toThrow() })
  })
  it('rejects the previous false-positive fixture with just two empty plugin folders', () => {
    withFixture((root) => {
      for (const name of ['assistant-registry', 'client-ui-assistants']) {
        mkdirSync(join(root, 'Contents', 'Resources', 'resources', 'profile-plugins', '@deepseek-ai', `dsh-experimental-${name}`), { recursive: true })
      }
      expect(() => validateInstalledTarget(root)).toThrow()
    })
  })
  it('rejects an installed Node symlink escaping the supplied bundle', () => {
    withFixture((root) => {
      const bundle = join(root, 'bundle')
      mkdirSync(bundle)
      const external = join(root, 'external-node')
      writeFileSync(external, '#!/bin/sh\nexit 99\n'); chmodSync(external, 0o755)
      symlinkSync(external, join(bundle, process.platform === 'win32' ? 'node.exe' : 'node'))
      expect(() => validateInstalledTarget(bundle)).toThrow(/escaped target/)
    })
  })
  it('rejects a missing compiled companion even when an executable runtime exists', () => {
    withFixture((root) => {
      const runtime = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
      writeFileSync(runtime, '#!/bin/sh\nexit 99\n'); chmodSync(runtime, 0o755)
      expect(() => validateInstalledTarget(root)).toThrow()
    })
  })
  it('rejects a non-executable runtime before any profile launches', () => {
    if (process.platform === 'win32') return // Windows does not enforce POSIX executable bits.
    withFixture((root) => {
      writeFileSync(join(root, 'node'), 'not executable\n', { mode: 0o600 })
      expect(() => validateInstalledTarget(root)).toThrow()
    })
  })
})
