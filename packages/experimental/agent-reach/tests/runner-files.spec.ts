/** Durable lookup and filesystem faults; launcher-layout fixtures do not qualify execution on that OS. */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { writeInstallationRecordAtomic, type InstallationRecord } from '../src/installation-record.ts'
import { RUNTIME_LOCK_ID, RUNTIME_MANIFEST_DIGEST } from '../src/runtime-lock.ts'
let directory: string
let ctx: Context
let point = ''
let launcher = ''
const actualPlatform = process.platform
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-lookup-'))
  ctx = new Context()
  point = ''; launcher = ''
  vi.stubEnv('HOME', directory)
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()
    return { ...actual,
      statSync: (file: fs.PathLike) => {
        if (point === 'candidate-access' && file === path.join(directory, '.agent-reach', 'tools', 'bili')) {
          throw Object.assign(new Error('Native tool inspection denied'), { code: 'EACCES' })
        }
        return actual.statSync(file)
      },
      existsSync: (file: fs.PathLike) => {
        if (point === 'launcher-disappeared' && file === launcher) actual.rmSync(launcher)
        return actual.existsSync(file)
      },
    }
  })
  vi.resetModules()
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: actualPlatform })
  await ctx.fiber.dispose()
  vi.doUnmock('node:fs')
  vi.resetModules()
  vi.unstubAllEnvs()
  fs.rmSync(directory, { recursive: true, force: true })
})
function ownedRecord(withTool = false): { record: InstallationRecord; file: string } {
  const releaseRoot = path.join(directory, 'runtimes', 'agent-reach', 'releases', RUNTIME_LOCK_ID)
  const core = path.join(releaseRoot, 'generations', 'fixture', 'core')
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
  launcher = path.join(core, bin, process.platform === 'win32' ? 'agent-reach.exe' : 'agent-reach')
  fs.mkdirSync(path.dirname(launcher), { recursive: true })
  fs.writeFileSync(launcher, 'layout fixture', { mode: 0o700 })
  const record: InstallationRecord = { schemaVersion: 1, manifestDigest: RUNTIME_MANIFEST_DIGEST, lockId: RUNTIME_LOCK_ID,
    upstreamRevision: 'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284', installedAt: '2026-11-08T00:00:00.000Z', releaseRoot,
    coreVenvPath: core, tools: { 'agent-reach': { version: '1.6.1', executablePath: launcher,
      installedAt: '2026-11-08T00:00:00.000Z', digest: createHash('sha256').update('layout fixture').digest('hex') } },
    ...(withTool ? { toolVenvPath: path.join(releaseRoot, 'generations', 'fixture', 'tools') } : {}),
  }
  if (record.toolVenvPath) fs.mkdirSync(record.toolVenvPath, { recursive: true })
  const file = path.join(releaseRoot, 'installation-record.json')
  writeInstallationRecordAtomic(file, record)
  return { record, file }
}
it.each(['darwin', 'win32'])('resolves the %s durable launcher layout without executing it', async (platform) => {
  Object.defineProperty(process, 'platform', { value: platform })
  const { record } = ownedRecord(platform === 'darwin')
  const { AgentReachRunner } = await import('../src/runner.ts')
  const result = new AgentReachRunner(ctx, {}, { dshHome: directory }).resolveCliExecutable()
  expect(result).toMatchObject({ found: true, executable: launcher, venvBinDir: path.dirname(launcher) })
  if (!result.found) throw new Error(result.reason)
  expect(result.toolVenvBinDir).toBe(record.toolVenvPath ? path.join(record.toolVenvPath, 'bin') : undefined)
})
it('refuses a changed upstream revision even when the owner record and launcher digest validate', async () => {
  const { record, file } = ownedRecord()
  writeInstallationRecordAtomic(file, { ...record, upstreamRevision: '0'.repeat(40) })
  const { AgentReachRunner } = await import('../src/runner.ts')
  const result = new AgentReachRunner(ctx, {}, { dshHome: directory }).resolveCliExecutable()
  expect(result.found).toBe(false)
  if (result.found) throw new Error('Unexpected accepted revision')
  expect(result.reason).toContain('revision')
})
it('refuses a launcher removed after record validation', async () => {
  ownedRecord()
  point = 'launcher-disappeared'
  const { AgentReachRunner } = await import('../src/runner.ts')
  const result = new AgentReachRunner(ctx, {}, { dshHome: directory }).resolveCliExecutable()
  expect(result.found).toBe(false)
  if (result.found) throw new Error('Unexpected accepted missing launcher')
  expect(result.reason).toContain('Promoted executable missing')
  expect(fs.existsSync(launcher)).toBe(false)
})
it('inspects unknown tool command names in an existing empty private directory', async () => {
  fs.mkdirSync(path.join(directory, '.agent-reach', 'tools'), { recursive: true })
  const { checkShadowedTools } = await import('../src/runner.ts')
  expect(checkShadowedTools(['fixture-unknown-tool'], directory)).toEqual({ found: false })
})
it('refuses a non-directory private tools path before invoking a query backend', async () => {
  const root = path.join(directory, '.agent-reach')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'tools'), 'file')
  const { AgentReachRunner, checkShadowedTools } = await import('../src/runner.ts')
  expect(checkShadowedTools(['bili-cli'], directory)).toMatchObject({ inspectionError: true })
  const result = await new AgentReachRunner(ctx, {}, { dshHome: directory }).query({ channel: 'bilibili', action: 'read', params: { target: 'BV1GJ411x7h7' } })
  expect(result.error?.code).toBe('INSPECTION_FAILED')
})
it('refuses an unreadable native tool candidate rather than treating it as absent', async () => {
  fs.mkdirSync(path.join(directory, '.agent-reach', 'tools'), { recursive: true })
  point = 'candidate-access'
  const { checkShadowedTools } = await import('../src/runner.ts')
  expect(checkShadowedTools(['bili-cli'], directory)).toMatchObject({ inspectionError: true, error: 'Inspection failed: Native tool inspection denied' })
})

it('scrubs credential-shaped text in a malformed durable record diagnostic', async () => {
  const { file } = ownedRecord()
  fs.writeFileSync(file, 'token=shh')
  const { AgentReachRunner } = await import('../src/runner.ts')
  const result = new AgentReachRunner(ctx, {}, { dshHome: directory }).resolveCliExecutable()
  expect(result.found).toBe(false)
  expect(JSON.stringify(result)).not.toContain('shh')
})
