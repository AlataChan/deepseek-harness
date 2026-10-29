/** Exercise two installed dsh profiles with real Agent, platform dispatcher, SQLite and IPC. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'

const artifact = await realpath(z.string().min(1).parse(process.argv[2]))
const channel = z.enum(['feishu', 'dingtalk']).parse(process.argv[3] ?? 'feishu')
const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const installed = (path: string) => join(artifact, 'node_modules', path)
const cli = installed('@deepseek-ai/dsh/lib/bin.js')
await stat(cli)
const root = await realpath(await mkdtemp('/tmp/dsh-im-installed-'))
await chmod(root, 0o700)
const children: ProfileProcess[] = []
let failure: unknown
const cancellation = new AbortController()
const cancel = () => { cancellation.abort(new Error('Installed ingress qualification interrupted')) }
const deadlineTimer = setTimeout(cancel, 60000)
process.once('SIGTERM', cancel)
const probeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), toolFree: z.literal(true) }).strict(),
  z.object({ type: z.literal('ack'), id: z.string(), result: z.object({ code: z.number(), msg: z.string() }), sent: z.number() }).strict(),
  z.object({ type: z.literal('sent'), count: z.number(), text: z.literal('PONG') }).strict(),
])
type ProbeRow = z.infer<typeof probeSchema>

class ProfileProcess {
  readonly rows: ProbeRow[] = []
  private readonly child: ChildProcessWithoutNullStreams
  private readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  private ended = false
  private stderr = ''
  private protocolError: unknown
  private closing: Promise<void> | undefined

  constructor(profile: string, patch: string, role: 'runtime' | 'ingress') {
    this.child = spawn(process.execPath, [cli, '--profile', profile, '--patch', patch], {
      cwd: join(root, 'workspace'), stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH, HOME: join(root, 'os-home'), TMPDIR: process.env.TMPDIR,
        DSH_HOME: join(root, role + '-home'), DSH_TELEMETRY_DISABLED: '1', NO_PROXY: '*',
        DSH_TEST_ARTIFACT_ROOT: artifact,
      },
    })
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString() })
    this.child.stdin.on('error', (error) => { this.protocolError ??= error })
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      try {
        if (role === 'runtime') throw new Error('Socket runtime emitted unexpected stdout')
        this.rows.push(probeSchema.parse(JSON.parse(line)))
      } catch (error) { this.protocolError = error }
    })
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => { this.ended = true; lines.close(); resolve({ code, signal }) })
      this.child.once('error', (error) => { this.ended = true; this.protocolError = error; lines.close(); resolve({ code: null, signal: null }) })
    })
    children.push(this)
  }

  assertRunning(): void {
    cancellation.signal.throwIfAborted()
    if (this.protocolError) throw this.protocolError
    if (this.ended) throw new Error('Installed profile exited unexpectedly: ' + this.stderr)
  }

  async waitFor(predicate: (row: ProbeRow) => boolean): Promise<ProbeRow> {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      this.assertRunning()
      const row = this.rows.find(predicate)
      if (row) return row
      await delay(20)
    }
    throw new Error('Installed profile response deadline exceeded: ' + this.stderr)
  }

  async deliver(id: string): Promise<Extract<ProbeRow, { type: 'ack' }>> {
    this.assertRunning()
    this.child.stdin.write(JSON.stringify({ type: 'deliver', id }) + '\n')
    const row = await this.waitFor(row => row.type === 'ack' && row.id === id)
    if (row.type !== 'ack') throw new Error('Missing delivery acknowledgement')
    return row
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      if (!this.ended) this.child.kill('SIGTERM')
      const force = setTimeout(() => { this.child.kill('SIGKILL') }, 10000)
      const result = await this.exited.finally(() => { clearTimeout(force) })
      if (this.protocolError) throw this.protocolError
      assert.equal(result.code, 0, `Profile cleanup failed (${result.signal}): ${this.stderr}`)
    })()
  }
}

async function boot(): Promise<{ runtime: ProfileProcess; ingress: ProfileProcess }> {
  const runtime = new ProfileProcess('im-installed-runtime', join(root, 'runtime.patch.yml'), 'runtime')
  const deadline = Date.now() + 30000
  while (true) {
    runtime.assertRunning()
    try { if ((await stat(join(root, 'tenant.sock'))).isSocket()) break }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    if (Date.now() >= deadline) throw new Error('Installed runtime socket did not appear')
    await delay(20)
  }
  const ingress = new ProfileProcess('im-installed-ingress', join(root, 'ingress.patch.yml'), 'ingress')
  await ingress.waitFor(row => row.type === 'ready')
  return { runtime, ingress }
}

try {
  for (const path of ['workspace', 'os-home', 'runtime-home', 'ingress-home', 'runtime-state', 'ingress-state']) {
    await mkdir(join(root, path), { mode: 0o700 })
  }
  const binding = {
    provider: channel, appId: 'synthetic-app', tenantId: 'synthetic-org', chatId: 'synthetic-chat', senderId: 'synthetic-user',
    bindingKey: JSON.stringify([channel, 'synthetic-app', 'synthetic-org', 'synthetic-chat', 'synthetic-user']),
    operatorId: 'synthetic-operator', targetTenantId: 'synthetic-tenant', authorizedAt: new Date().toISOString(), revokedAt: null,
  }
  const fixture = join(root, 'ingress-provider.mjs')
  await copyFile(fileURLToPath(new URL('./installed-ingress-provider.mjs', import.meta.url)), fixture)
  const profile = join(root, 'ingress-home/profiles/im-installed-ingress')
  await mkdir(profile, { recursive: true, mode: 0o700 })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-installed-ingress-test', private: true, type: 'module', dependencies: {}, dsh: { profile: { bundles: [] } } }), { mode: 0o600 })
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', { mode: 0o600 })
  const runtimeProfile = join(root, 'runtime-home/profiles/im-installed-runtime')
  await mkdir(runtimeProfile, { recursive: true, mode: 0o700 })
  await writeFile(join(runtimeProfile, 'package.json'), JSON.stringify({ name: 'dsh-installed-runtime-test', private: true,
    dependencies: { '@deepseek-ai/dsh-base': '0.2.1-alpha.1', '@deepseek-ai/dsh-experimental-im-service-bundle': '0.2.1-alpha.1' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-experimental-im-service-bundle'] } },
  }), { mode: 0o600 })
  await writeFile(join(runtimeProfile, 'cordis.patch.yml'), '[]\n', { mode: 0o600 })
  const runtimePatch = [
    ...['llm-deepseek', 'plugin-package-inventory-deepseek', 'session-title-llm'].map(id => ({ id, disabled: true })),
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { insert: [
      { id: 'model-replay', name: installed('@deepseek-ai/dsh-llm-replay/lib/index.js'), config: { file: join(repo, 'snapshots/im/human-turn/session.v4.jsonl'), providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] } },
    ] },
    { id: 'im-runtime', config: {
      tenantId: 'synthetic-tenant', operatorIds: ['synthetic-operator'], stateDirectory: join(root, 'runtime-state'), cwd: join(root, 'workspace'),
      socketPath: join(root, 'tenant.sock'), modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    } },
  ]
  const ingressPatch = [{ insert: [
    { id: 'storage', name: installed('@deepseek-ai/dsh-storage/lib/index.js') },
    { id: 'installed-ingress-qualification', name: fixture, config: {
      ingressId: 'installed-ingress', stateDirectory: join(root, 'ingress-state'), dispatchIntervalMs: 20,
      channel: channel === 'feishu' ? { kind: 'feishu', appId: 'synthetic-app', appSecret: 'synthetic-only' }
        : { kind: 'dingtalk', clientId: 'synthetic-app', clientSecret: 'synthetic-only', expectedCorpId: 'synthetic-org' },
      tenants: { 'synthetic-tenant': { socketPath: join(root, 'tenant.sock'), workspaceId: join(root, 'workspace') } },
      operatorBindings: [binding],
    } },
  ] }]
  await writeFile(join(root, 'runtime.patch.yml'), JSON.stringify(runtimePatch), { mode: 0o600 })
  await writeFile(join(root, 'ingress.patch.yml'), JSON.stringify(ingressPatch), { mode: 0o600 })
  const first = await boot()
  assert.deepEqual((await first.ingress.deliver('first')).result, { code: 0, msg: channel === 'feishu' ? 'admitted' : 'accepted' })
  assert.equal((await first.ingress.deliver('duplicate')).result.msg, channel === 'feishu' ? 'duplicate_admitted' : 'accepted')
  await first.ingress.waitFor(row => row.type === 'sent' && row.count === 1)
  assert.equal((await first.ingress.deliver('after-completed')).sent, 1)
  await first.ingress.close()
  await first.runtime.close()
  const second = await boot()
  const restored = await second.ingress.deliver('after-cold-restart')
  assert.equal(restored.result.msg, channel === 'feishu' ? 'duplicate_admitted' : 'accepted')
  await delay(150)
  assert.equal((await second.ingress.deliver('after-recovery-pump')).sent, 0)
  await second.ingress.close()
  await second.runtime.close()
  const database = new DatabaseSync(join(root, 'ingress-state/ingress.sqlite'), { readOnly: true })
  try {
    const receipts = database.prepare('SELECT value FROM u_im_ingress_deliveries').all()
    assert.equal(receipts.length, 1)
    const receipt = z.object({ value: z.string() }).parse(receipts[0])
    const durable = z.object({ status: z.literal('completed'), outboxStatus: z.literal('sent'),
      outboxMessageId: channel === 'feishu' ? z.literal('synthetic-reply-1') : z.null() }).parse(JSON.parse(receipt.value))
    assert.equal(durable.status, 'completed')
  } finally { database.close() }
  const sessionFiles = (await readdir(join(root, 'sessions'), { recursive: true })).filter(path => path.endsWith('.v4.jsonl'))
  assert.equal(sessionFiles.length, 1)
  const events = (await readFile(join(root, 'sessions', sessionFiles[0]!), 'utf8')).trim().split('\n').map((line): unknown => JSON.parse(line))
  const userSchema = z.object({ type: z.literal('user/message'), data: z.object({ role: z.literal('user'), source: z.object({ kind: z.literal('user'), rpcId: z.string().min(1) }) }) })
  assert.equal(events.filter(event => userSchema.safeParse(event).success).length, 1)
  console.log(`PASS: installed runtime + tool-free ingress (${channel}); real Agent reply, confirmed outbox, durable deduplication, cold restart and human source retained`)
} catch (error) { failure = error }
finally {
  clearTimeout(deadlineTimer)
  process.off('SIGTERM', cancel)
  const cleanup = await Promise.allSettled(children.slice().reverse().map(child => child.close()))
  const errors: unknown[] = []
  for (const result of cleanup) if (result.status === 'rejected') errors.push(result.reason)
  if (failure) errors.unshift(failure)
  if (errors.length) throw new AggregateError(errors, `Installed ingress qualification failed; synthetic artifacts retained at ${root}`)
  await rm(root, { recursive: true, force: true })
}
