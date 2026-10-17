/** Companion liveness checks await shutdown before the caller removes its profile. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function runCompanion(earlyExit: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'companion-shutdown-'))
  roots.push(root)
  const resources = join(root, 'resources')
  const harness = join(resources, 'harness', 'lib')
  mkdirSync(harness, { recursive: true })
  symlinkSync(process.execPath, join(resources, 'node'))
  const marker = join(root, 'shutdown-complete')
  writeFileSync(join(harness, 'desktop-companion.js'), `
const { writeFileSync } = require('node:fs')
process.stdin.resume()
process.stdin.once('data', () => {
  process.stdout.write(JSON.stringify({ type: 'wire/message', encoded: JSON.stringify({ type: 'control/ready', runtimeVersion: 'fixture' }) }) + '\\n')
  ${earlyExit ? 'setTimeout(() => process.exit(0), 50)' : ''}
})
process.on('SIGTERM', () => {
  setTimeout(() => { writeFileSync(${JSON.stringify(marker)}, 'closed'); process.exit(0) }, 250)
})
`)
  const result = spawnSync(process.execPath, [resolve('scripts/smoke-companion-lifecycle.mjs'), root, '300'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: root, DSH_HOME: join(root, '.dsh') },
  })
  return { result, marker }
}

it.skipIf(process.platform === 'win32')('waits for POSIX companion teardown before reporting success', () => {
  const { result, marker } = runCompanion(false)
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('alive with an open pipe')
  expect(existsSync(marker)).toBe(true)
})

it.skipIf(process.platform === 'win32')('rejects a companion that exits during the liveness hold', () => {
  const { result } = runCompanion(true)
  expect(result.status).toBe(1)
  expect(result.stdout).toMatch(/exited before ready|answered ready then EXITED/)
})
