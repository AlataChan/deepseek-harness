/** sqlite3 version and independent safe-mode startup probes. */

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import CommerceMode from '@deepseek-ai/dsh-experimental-commerce-mode'
import { writeFakeSqlite } from './helpers/fake-sqlite.ts'

const roots: string[] = []
const fibers: Array<ReturnType<Context['plugin']>> = []

afterEach(async () => {
  await Promise.allSettled(fibers.splice(0).map(fiber => fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fakeSqlite(version: string, unsafeProbe?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'commerce-sqlite-probe-'))
  roots.push(root)
  return writeFakeSqlite(root, version, unsafeProbe)
}

async function expectLoadFailure(sqlite3Path: string, ruleId: string): Promise<void> {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'commerce-probe-root-'))
  roots.push(sourceRoot)
  const ctx = new Context()
  const projection = ctx.plugin(SessionProjectionRegistry)
  const subprocess = ctx.plugin(LocalSubprocessRuntime)
  fibers.push(projection, subprocess)
  await projection.await()
  await subprocess.await()
  const fiber = ctx.plugin(CommerceMode, {
    sourcesRoot: sourceRoot,
    platforms: { sample: {} },
    analysis: { maxRows: 1, maxOutputBytes: 4096, timeoutMs: 1_000, graceMs: 100 },
    lockWaitMs: 5_000,
    sqlite3Path,
  })
  fibers.push(fiber)
  await expect(fiber).rejects.toMatchObject({
    code: 'sqlite3-unavailable', details: { ruleId },
  })
  expect(await readdir(sourceRoot)).toEqual([])
}

describe('sqlite3 load-time safety probe', () => {
  it('rejects sqlite3 3.41.1', async () => {
    await expectLoadFailure(await fakeSqlite('3.41.1'), 'sqlite3-version')
  })

  it.each([
    ['readfile', 'sqlite3-safe-readfile'],
    ['writefile', 'sqlite3-safe-writefile'],
    ['ATTACH', 'sqlite3-safe-attach'],
  ] as const)('rejects a sqlite3 whose %s probe succeeds', async (probe, ruleId) => {
    await expectLoadFailure(await fakeSqlite('3.51.0', probe), ruleId)
  })
})
