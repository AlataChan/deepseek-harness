/** Negative installer protocol fixtures; these do not qualify any runtime, dependency or operating system. */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const bytes = Buffer.from('installer protocol artifact')
const digest = createHash('sha256').update(bytes).digest('hex')
const actualPlatform = process.platform
let ctx: Context
let directory: string
let server: http.Server
let baseUrl: string
let point = ''
let fixtureQualified = true
let protectedTarget: string

function completion(stdout = '', stderr = '', exitCode = 0): SubprocessHandle {
  return { stdin: undefined, stdout: Readable.from([stdout]), stderr: Readable.from([stderr]), control: undefined,
    collected: {}, done: Promise.resolve({ exitCode, signal: null }), terminate() {}, waitForExit: async () => true }
}
async function protocol(spec: SubprocessSpawnSpec): Promise<SubprocessHandle> {
  const argv = spec.argv
  const cwd = spec.cwd
  if (!cwd) throw new Error('Missing fixture cwd')
  const args = argv.slice(1)
  if (args[0] === '--version') {
    if (point.startsWith('cleanup-')) return completion('', 'fixture command failed', 1)
    if (point === 'command-error') return completion('', 'fixture command rejected', 1)
    if (point === 'empty-command-error') return completion('', '', 1)
    if (point === 'generation-disappeared') { await fs.rm(cwd, { recursive: true }); return completion('', 'removed generation', 1) }
    if (point === 'generation-replaced') {
      await fs.rm(cwd, { recursive: true })
      await fs.symlink(protectedTarget, cwd, process.platform === 'win32' ? 'junction' : 'dir')
      return completion('', 'replaced generation', 1)
    }
    return completion(point === 'uv-version' ? 'uv 99.0 fixture' : 'uv 0.10.8 fixture')
  }
  if (args[0] === 'python' && args[1] === 'find') {
    return completion(point === 'python-escape' ? path.dirname(cwd) : path.join(cwd, 'python', 'python'))
  }
  if (args[0] === 'venv') {
    const venv = args.at(-1)
    if (!venv) throw new Error('Missing venv destination')
    await fs.mkdir(venv, { recursive: true })
  }
  if (args[0] === 'build') {
    const output = args[args.indexOf('--out-dir') + 1]
    if (!output) throw new Error('Missing wheel destination')
    const supplemental = args.at(-1)?.endsWith('supplement')
    const bad = point === (supplemental ? 'supplemental-wheel' : 'source-wheel')
    await fs.writeFile(path.join(output, supplemental ? 'supplement.whl' : 'agent_reach.whl'), bad ? 'unqualified build' : bytes)
  }
  if (args[0] === '-c') {
    if (args[1]?.includes('from agent_reach.runtime.tools')) {
      if (point === 'resolver-null') return completion('null')
      return completion(JSON.stringify({
        'yt-dlp': point === 'resolver-kind' ? 12 : point === 'resolver-path' ? path.dirname(cwd) : path.join(cwd, 'core', 'bin', 'yt-dlp'),
        bili: path.join(cwd, 'tools', 'bin', 'bili'),
      }))
    }
  }
  if (args[0] === '--help') {
    await fs.mkdir(path.dirname(argv[0]!), { recursive: true })
    await fs.writeFile(argv[0]!, 'protocol fixture launcher', { mode: 0o700 })
  }
  if (args[0] === 'version') {
    if (point === 'success') {
      await fs.mkdir(path.dirname(argv[0]!), { recursive: true })
      await fs.writeFile(argv[0]!, 'protocol fixture launcher', { mode: 0o700 })
      return completion(JSON.stringify({ result: { version: '1.6.1' } }))
    }
    const outputs: Record<string, unknown> = {
      'version-null': null, 'version-root': 1, 'version-no-result': {}, 'version-result-null': { result: null },
      'version-result-kind': { result: 1 }, 'version-no-number': { result: {} }, 'version-mismatch': { result: { version: '99' } },
    }
    return completion(JSON.stringify(outputs[point]))
  }
  return completion()
}

beforeEach(async () => {
  point = ''
  fixtureQualified = true
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reach-protocol-failure-'))
  protectedTarget = path.join(directory, 'protected')
  await fs.mkdir(protectedTarget)
  await fs.writeFile(path.join(protectedTarget, 'marker'), 'preserve')
  server = http.createServer((_request, response) => { response.end(bytes) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture HTTP listener')
  baseUrl = `http://127.0.0.1:${address.port}`
  const wheel = { name: 'fixture', version: '1', filename: 'fixture.whl', url: baseUrl + '/wheel', sha256: digest, license: 'MIT' }
  const manifest = { schemaVersion: 1, uvVersion: '0.10.8', pythonVersion: '3.12.12',
    source: { url: baseUrl + '/source', sha256: digest, directory: 'source', wheelFilename: 'agent_reach.whl', wheelSha256: digest, sourceDateEpoch: '315532800' },
    platforms: { 'darwin-arm64': { uv: { url: baseUrl + '/uv', filename: 'uv.tar.gz', executable: 'uv', sha256: digest },
      python: { key: 'fixture-python', metadata: {} }, wheels: { build: [wheel], core: [wheel], bili: [{ ...wheel, name: 'bilibili-cli' }] } } },
    supplementalSources: [{ name: 'supplement', version: '1', license: 'MIT', url: baseUrl + '/supplement', sha256: digest,
      directory: 'supplement', wheelFilename: 'supplement.whl', wheelSha256: digest, sourceDateEpoch: '315532800' }],
  }
  vi.doMock('../dependency-lock.json', () => ({ default: manifest }))
  vi.doMock('../src/runtime-lock.ts', async importOriginal => ({
    ...await importOriginal<typeof import('../src/runtime-lock.ts')>(),
    // Protocol fixtures never start actual processes; real OS qualification uses the unmocked tests.
    runtimePlatformQualified: () => fixtureQualified,
  }))
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    return { ...actual,
      access: async (...args: Parameters<typeof fs.access>) => {
        if (point === 'sensitive-access') throw new Error('token=synthetic-token')
        if (point === 'access-error') throw Object.assign(new Error('fixture access failed'), { code: 'EIO' })
        return actual.access(...args)
      },
      lstat: async (file: Parameters<typeof fs.lstat>[0]) => {
        if (point === 'cleanup-error') throw Object.assign(new Error('fixture lstat failed'), { code: 'EIO' })
        if (point === 'cleanup-no-code') throw new Error('fixture lstat failed without code')
        if (point === 'cleanup-primitive') throw 'fixture lstat non-error'
        return actual.lstat(file)
      },
    }
  })
  vi.resetModules()
  ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime).await()
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    // The public provider has a synchronous handle API; filesystem work completes before its done outcome.
    const output = new Readable({ read() {} })
    const error = new Readable({ read() {} })
    const done = protocol(spec).then(async (handle) => {
      if (handle.stdout) for await (const chunk of handle.stdout) output.push(chunk)
      if (handle.stderr) for await (const chunk of handle.stderr) error.push(chunk)
      output.push(null); error.push(null)
      return handle.done
    })
    return { stdin: undefined, stdout: output, stderr: error, control: undefined, collected: {}, done,
      terminate() {}, waitForExit: async () => { await done; return true } }
  })
})
afterEach(async () => {
  await ctx.fiber.dispose()
  Object.defineProperty(process, 'platform', { value: actualPlatform })
  vi.restoreAllMocks()
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../dependency-lock.json')
  vi.doUnmock('../src/runtime-lock.ts')
  vi.resetModules()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  await fs.rm(directory, { recursive: true, force: true })
})

for (const [failure, message] of [
  ['access-error', 'fixture access failed'], ['cleanup-error', 'fixture lstat failed'], ['cleanup-no-code', 'fixture lstat failed without code'],
  ['command-error', 'fixture command rejected'], ['empty-command-error', 'Installation command failed'],
  ['generation-disappeared', 'removed generation'], ['generation-replaced', 'replaced generation'],
  ['uv-version', 'uv version mismatch'], ['python-escape', 'Python escaped private generation'],
  ['source-wheel', 'Reproduced Agent-Reach wheel'], ['supplemental-wheel', 'Reproduced supplemental wheel'],
  ['resolver-null', 'Invalid resolver response'], ['resolver-kind', 'shadows'], ['resolver-path', 'shadows'],
  ['version-null', 'version mismatch'], ['version-root', 'version mismatch'], ['version-no-result', 'version mismatch'],
  ['version-result-null', 'version mismatch'], ['version-result-kind', 'version mismatch'],
  ['version-no-number', 'version mismatch'], ['version-mismatch', 'version mismatch'],
] as const) {
  it(`rejects ${failure} at the external installer protocol and does not promote it`, async () => {
    point = failure
    const { ReachInstaller } = await import('../src/installer.ts')
    const { computeSetupPlan } = await import('../src/setup-plan.ts')
    const planned = computeSetupPlan('bilibili', 'read', 'bili-cli', {}, directory)
    if (!planned.ok) throw new Error(planned.error)
    await expect(new ReachInstaller(ctx).install(planned.plan, 10000)).rejects.toThrow(message)
    expect(await fs.readdir(planned.plan.releaseRoot)).not.toContain('installation-record.json')
    expect(await fs.readdir(planned.plan.releaseRoot)).not.toContain('.setup.lock')
    expect(await fs.readFile(path.join(protectedTarget, 'marker'), 'utf8')).toBe('preserve')
  })
}

for (const channel of ['v2ex', 'bilibili']) {
  it(`promotes an owner record after valid ${channel} protocol responses (not runtime qualification)`, async () => {
    point = 'success'
    const { ReachInstaller } = await import('../src/installer.ts')
    const { computeSetupPlan } = await import('../src/setup-plan.ts')
    const { readInstallationRecordDetailed } = await import('../src/installation-record.ts')
    const plan = computeSetupPlan(channel, channel === 'v2ex' ? 'hot' : 'read', undefined, {}, directory)
    if (!plan.ok) throw new Error(plan.error)
    const installer = new ReachInstaller(ctx)
    const record = await installer.install(plan.plan, 10000)
    const ownerFile = path.join(plan.plan.releaseRoot, 'installation-record.json')
    expect(readInstallationRecordDetailed(ownerFile)).toMatchObject({ status: 'present', record })
    expect(record.toolVenvPath !== undefined).toBe(channel === 'bilibili')
    point = 'source-wheel'
    await expect(installer.install(plan.plan, 10000)).rejects.toThrow('Reproduced Agent-Reach wheel')
    expect(readInstallationRecordDetailed(ownerFile).record).toEqual(record)
    expect((await fs.stat(record.tools['agent-reach']!.executablePath)).isFile()).toBe(true)
  })
}

it('rejects an unqualified host before creating the approved plan directory', async () => {
  const { ReachInstaller } = await import('../src/installer.ts')
  const { computeSetupPlan } = await import('../src/setup-plan.ts')
  const planned = computeSetupPlan('v2ex', 'hot', undefined, {}, directory)
  if (!planned.ok) throw new Error(planned.error)
  fixtureQualified = false
  await expect(new ReachInstaller(ctx).install(planned.plan, 10000)).rejects.toThrow('no qualified artifact recipe')
  await expect(fs.stat(planned.plan.releaseRoot)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('propagates a non-Error cleanup failure while releasing the setup lock', async () => {
  point = 'cleanup-primitive'
  const { ReachInstaller } = await import('../src/installer.ts')
  const { computeSetupPlan } = await import('../src/setup-plan.ts')
  const planned = computeSetupPlan('v2ex', 'hot', undefined, {}, directory)
  if (!planned.ok) throw new Error(planned.error)
  await expect(new ReachInstaller(ctx).install(planned.plan, 10000)).rejects.toBe('fixture lstat non-error')
  expect(await fs.readdir(planned.plan.releaseRoot)).not.toContain('.setup.lock')
})
it('returns installed only after a real approval and owner-record publication using the protocol fixture', async () => {
  point = 'success'
  const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await import('@deepseek-ai/dsh-agent-loop-testkit')
  const { default: ApprovalService } = await import('@deepseek-ai/dsh-user-approval')
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const { AgentReachSetupService } = await import('../src/setup.ts')
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
  const owner = await ctx.agents.create({ sessionId: SessionId('reach-protocol-setup') })
  owner.agent.session.append('turn/start', { turn: 1 })
  ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  const { ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const service = new AgentReachSetupService(ctx, {}, directory)
  const result = await service.runSetup('v2ex', 'hot', undefined, { agent: owner.agent, callId: ToolCallId('protocol-setup') })
  expect(result.status).toBe('installed')
  expect(result.plan).toBeDefined()
  expect((await service.runSetup('v2ex', 'hot')).status).toBe('not_needed')
  expect(owner.agent.session.snapshotEvents().filter(event => event.type === 'approval/asked')).toHaveLength(1)
  await owner.dispose()
})

it('scrubs filesystem acquisition errors in both setup diagnostic fields', async () => {
  point = 'sensitive-access'
  const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await import('@deepseek-ai/dsh-agent-loop-testkit')
  const { default: ApprovalService } = await import('@deepseek-ai/dsh-user-approval')
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const { AgentReachSetupService } = await import('../src/setup.ts')
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
  const owner = await ctx.agents.create({ sessionId: SessionId('reach-protocol-redaction') })
  owner.agent.session.append('turn/start', { turn: 1 })
  ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  const result = await new AgentReachSetupService(ctx, {}, directory).runSetup('v2ex', 'hot', undefined, { agent: owner.agent })
  expect(result.error?.code).toBe('INSTALL_FAILED')
  expect(result.message).not.toContain('synthetic-token')
  expect(result.error?.message).not.toContain('synthetic-token')
  expect(result.message).toMatch(/redact/i)
  await owner.dispose()
})
