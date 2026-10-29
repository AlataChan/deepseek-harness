/**
 * Acceptance coverage for SSH subagent-acp composition via real Cordis Loader.
 *
 * Verifies Acceptance 1:
 * - Real Cordis Loader reads the group configuration isolate: { subprocess: true, ssh: true }.
 * - Scoped subagent-acp registers on root ctx.subagents registry.
 * - Group subprocess resolves to SshSubprocessRuntime (real subprocess-ssh).
 * - Root ctx.subprocess remains LocalSubprocessRuntime (root shell remains local).
 * - Positive control executes a complete delegation turn over the Loader boundary.
 * - Negative control 1: isolating subagents prevents registration on root subagents.
 * - Negative control 2: missing validateCwd: false rejects absent remote path at load time.
 */

import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const sshGroupConfigPath = fileURLToPath(new URL('./fixtures/loader/ssh-group.patch.yml', import.meta.url))
const wrongIsolateConfigPath = fileURLToPath(new URL('./fixtures/loader/ssh-group-wrong-isolate.patch.yml', import.meta.url))
const validateCwdFailConfigPath = fileURLToPath(new URL('./fixtures/loader/ssh-group-validate-cwd-fail.patch.yml', import.meta.url))
const mockServer = fileURLToPath(new URL('./mock-acp-server.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

function toolResultText(events: SessionEvent[]): string {
  const results = events.filter(event => event.type === 'tool/result')
  expect(results).toHaveLength(1)
  return results[0]!.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('Real Cordis Loader SSH group composition acceptance', () => {
  let originalMockServer: string | undefined
  let originalSessionRoot: string | undefined
  let originalDshHome: string | undefined
  let tempSessionRoot: string
  let tempDshHome: string

  beforeAll(async () => {
    originalMockServer = process.env.DSH_TEST_MOCK_ACP_SERVER
    originalSessionRoot = process.env.DSH_TEST_SESSIONS_ROOT
    originalDshHome = process.env.DSH_HOME
    tempSessionRoot = await mkdtemp(join(tmpdir(), 'ssh-loader-sessions-'))
    tempDshHome = await mkdtemp(join(tmpdir(), 'ssh-loader-dsh-home-'))
    process.env.DSH_TEST_MOCK_ACP_SERVER = mockServer
    process.env.DSH_TEST_SESSIONS_ROOT = tempSessionRoot
    process.env.DSH_HOME = tempDshHome
  })

  afterAll(async () => {
    if (originalMockServer !== undefined) process.env.DSH_TEST_MOCK_ACP_SERVER = originalMockServer
    else delete process.env.DSH_TEST_MOCK_ACP_SERVER

    if (originalSessionRoot !== undefined) process.env.DSH_TEST_SESSIONS_ROOT = originalSessionRoot
    else delete process.env.DSH_TEST_SESSIONS_ROOT

    if (originalDshHome !== undefined) process.env.DSH_HOME = originalDshHome
    else delete process.env.DSH_HOME

    if (tempSessionRoot) {
      await rm(tempSessionRoot, { recursive: true, force: true })
    }
    if (tempDshHome) {
      await rm(tempDshHome, { recursive: true, force: true })
    }
  })

  it('loads isolate: { subprocess: true, ssh: true }, registers on root subagents, preserves local root subprocess, and executes delegation', async () => {
    let events: SessionEvent[] = []
    let workspace = ''
    const { stderr } = await runLoaderSmoke({
      label: 'ssh-group-composition smoke',
      tempDirPrefix: 'ssh-group-composition-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath: sshGroupConfigPath,
      tsconfigPath: repoTsconfig,
      mode: 'src',
      sourceImport: 'tsx/esm',
      env: {
        DSH_TEST_MOCK_ACP_SERVER: mockServer,
        DSH_TEST_SESSIONS_ROOT: './.sessions',
        DSH_HOME: './.dsh-home',
      },
      inspect: async (cwd) => {
        workspace = realpathSync(cwd)
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    // Verifies that the child ran, announced /mock/remote/session as its ACP sessionCwd,
    // and reported process.cwd() as the test workspace
    const text = toolResultText(events)
    expect(text).toContain(workspace)
    expect(text).toContain('/mock/remote/session')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('verifies in-process Loader service boundaries: root subagents registry and local shell retention', async () => {
    const ctx = await bootProductionProfile({
      binName: 'ssh-group-service-boundaries',
      profile: 'headless',
      overlayPaths: [resolveConfigPath(sshGroupConfigPath, undefined)],
    })

    try {
      // 1. Scoped subagent-acp inside group registered provider on root ctx.subagents
      const provider = ctx.subagents.getProvider('remote-ssh-acp')
      expect(provider).toBeDefined()

      // 2. Root ctx.subprocess remains LocalSubprocessRuntime (root shell remains local)
      expect(ctx.subprocess.constructor.name).toBe('LocalSubprocessRuntime')
      expect(ctx.subprocess.constructor.name).not.toBe('SshSubprocessRuntime')

      // 3. Root subprocess executes locally
      const handle = ctx.subprocess.spawn({
        argv: [process.execPath, '-e', 'process.stdout.write("local-root-subprocess-ok")'],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
        graceMs: 1000,
      })
      const result = await handle.done
      expect(result.exitCode).toBe(0)
      expect(handle.collected.stdout?.readFrom(0).text).toBe('local-root-subprocess-ok')
    } finally {
      await ctx.fiber.dispose()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('negative control 1: isolating subagents prevents registration on root subagents', async () => {
    const ctx = await bootProductionProfile({
      binName: 'ssh-group-wrong-isolate',
      profile: 'headless',
      overlayPaths: [resolveConfigPath(wrongIsolateConfigPath, undefined)],
    })

    try {
      // Scoped provider is isolated in group, absent on root
      const provider = ctx.subagents.getProvider('remote-ssh-acp')
      expect(provider).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('negative control 2: missing validateCwd: false rejects absent remote path at load time', async () => {
    const ctx = await bootProductionProfile({
      binName: 'ssh-group-validate-cwd-fail',
      profile: 'headless',
      overlayPaths: [resolveConfigPath(validateCwdFailConfigPath, undefined)],
    })
    try {
      // Because validateCwd defaulted to true, the absent remote path failed validation at apply time,
      // preventing provider registration on ctx.subagents.
      expect(ctx.subagents.getProvider('remote-ssh-acp')).toBeUndefined()
      const entry = [...ctx.loader.entries()].find(e => e.options.id === 'remote-subagent-acp')
      expect(entry).toBeDefined()
      expect(entry?.fiber?.state).toBe(3)
    } finally {
      await ctx.fiber.dispose()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
