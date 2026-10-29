/** Qualify installed dsh tenant profiles under distinct Linux UIDs and real systemd socket activation. */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { parseSessionLog, deriveReplayScript } from '@deepseek-ai/dsh-llm-replay'
import { ipcServerMessageSchema, type IpcClientMessage, type IpcServerMessage } from '../../src/ipc.ts'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const execute = promisify(execFile)
const context = z.string().min(1).parse(process.argv[2])
const image = z.string().min(1).parse(process.argv[3])
const artifact = z.string().min(1).parse(process.argv[4])
const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dsh-linux-real-tenants-'))
const name = `dsh-expansion-tenants-${randomUUID().slice(0, 8)}`
const cli = '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'
const checks: string[] = []
let container: string | undefined
let originalFailure: unknown
let unitsMounted = false
const clients: TenantProbe[] = []
type RequestFields<T> = T extends { id: string } ? Omit<T, 'id'> : never

async function docker(args: readonly string[], timeout = 30000): Promise<string> {
  return (await execute('docker', ['--context', context, ...args], {
    env: scrubbedParentEnv(), timeout, maxBuffer: 2 * 1024 * 1024,
  })).stdout.trim()
}
async function inside(...args: string[]): Promise<string> {
  if (!container) throw new Error('Missing owned container')
  return docker(['exec', container, ...args])
}
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(250)
  }
  throw new Error('Installed tenant condition did not become true')
}
function requireCondition(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message)
}

class TenantProbe {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly exited: Promise<void>
  private readonly pending = new Map<string, {
    resolve: (row: IpcServerMessage) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private sequence = 0
  private stderr = ''
  private ended = false
  private closing: Promise<void> | undefined

  constructor(tenant: 'a' | 'b') {
    if (!container) throw new Error('Missing owned container')
    this.child = spawn('docker', ['--context', context, 'exec', '-i', '-u', 'dsh-im-ingress', container,
      'node', '/opt/qualification/bridge.mjs', `/run/dsh-im/${tenant}/rpc.sock`], {
      env: scrubbedParentEnv(), stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString() })
    this.child.stdin.on('error', (error) => { this.rejectPending(error) })
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      try {
        const row = ipcServerMessageSchema.parse(JSON.parse(line))
        const pending = this.pending.get(row.id)
        if (!pending) throw new Error('Unsolicited tenant response')
        this.pending.delete(row.id)
        clearTimeout(pending.timer)
        pending.resolve(row)
      } catch (error) { this.rejectPending(error instanceof Error ? error : new Error(String(error))) }
    })
    this.exited = new Promise((resolve) => {
      this.child.once('exit', () => {
        this.ended = true
        this.rejectPending(new Error(`Tenant probe exited: ${this.stderr}`))
        lines.close()
        resolve()
      })
      this.child.once('error', (error) => { this.ended = true; this.rejectPending(error); lines.close(); resolve() })
    })
    clients.push(this)
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
  }
  request(fields: RequestFields<IpcClientMessage>): Promise<IpcServerMessage> {
    if (this.ended) return Promise.reject(new Error('Tenant probe is closed'))
    const id = String(++this.sequence)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Tenant request deadline exceeded')) }, 10000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ id, ...fields })}\n`)
    })
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      this.child.stdin.end()
      const terminate = setTimeout(() => { this.child.kill('SIGTERM') }, 5000)
      const force = setTimeout(() => { this.child.kill('SIGKILL') }, 8000)
      try { await this.exited } finally { clearTimeout(terminate); clearTimeout(force) }
    })
    return this.closing
  }
}

const key = (tenant: string, event: string): string => JSON.stringify(['feishu', 'fixture-app', 'fixture-org', `chat-${tenant}`, `sender-${tenant}`, event])
async function connect(tenant: 'a' | 'b'): Promise<TenantProbe> {
  const client = new TenantProbe(tenant)
  const ack = await client.request({ type: 'init', protocolVersion: 1, ingressId: 'fixture-ingress',
    targetTenantId: `tenant-${tenant}`, workspaceId: `workspace-${tenant}` })
  requireCondition(ack.type === 'init_ack' && ack.tenantId === `tenant-${tenant}` && ack.workspaceId === `workspace-${tenant}`,
    'Installed runtime did not acknowledge exact tenant/workspace identity')
  return client
}
async function completed(client: TenantProbe, deliveryKey: string): Promise<string> {
  let sessionId: string | undefined
  await waitFor(async () => {
    const row = await client.request({ type: 'get_delivery', deliveryKey })
    requireCondition(row.type === 'get_delivery_ack', 'Missing delivery status')
    if (row.reconciliation.state === 'admitted') return false
    requireCondition(row.reconciliation.state === 'completed' && row.reconciliation.resultText === 'PONG', 'Installed Agent did not complete recorded turn')
    sessionId = row.reconciliation.sessionId
    return true
  })
  if (!sessionId) throw new Error('Missing completed Session')
  return sessionId
}
async function submit(client: TenantProbe, tenant: 'a' | 'b', event: string, sessionId: string | null = null): Promise<string> {
  const requestId = randomUUID()
  const ack = await client.request({ type: 'submit_delivery', deliveryKey: key(tenant, event), requestId,
    operatorId: `operator-${tenant}`, prompt: 'Reply with exactly the word: PONG. Do not use any tools.', sessionId })
  requireCondition(ack.type === 'submit_delivery_ack' && ack.requestId === requestId, 'Installed runtime did not admit prompt')
  return requestId
}

try {
  const endpoints: unknown = JSON.parse(await docker(['context', 'inspect', context, '--format', '{{json .Endpoints}}']))
  requireCondition(z.object({ docker: z.object({ Host: z.string() }) }).parse(endpoints).docker.Host.startsWith('unix://'),
    'Qualification requires a local Docker endpoint')
  await readFile(join(artifact, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
  const fixture = await readFile(join(repo, 'snapshots/im/human-turn/session.v4.jsonl'), 'utf8')
  const script = deriveReplayScript(parseSessionLog(fixture))
  requireCondition(script.length === 1, 'Expected one authored response for controlled repeated turns')
  await writeFile(join(temporary, 'session.v4.jsonl'), fixture)
  await writeFile(join(temporary, 'replay.json'), JSON.stringify([...script, ...script, { kind: 'hang' }]))
  await writeFile(join(temporary, 'bridge.mjs'), `import {createConnection} from 'node:net';
const socket=createConnection(process.argv[2]);
socket.on('error',error=>{process.stderr.write(error.code+'\\n');process.exitCode=1;socket.destroy();process.stdin.destroy()});
process.stdin.pipe(socket);socket.pipe(process.stdout);socket.on('close',()=>{process.stdin.destroy()});\n`)
  const id = await docker(['run', '-d', '--name', name, '--label', 'dsh.expansion.run=run_defe54996fc5',
    '--network', 'none', '--privileged', '--cgroupns=private', '--tmpfs', '/run', '--tmpfs', '/run/lock', '--tmpfs', '/tmp', image])
  requireCondition(/^[a-f0-9]{64}$/.test(id), 'Docker did not return an owned container ID')
  container = id
  await waitFor(async () => (await inside('cat', '/proc/1/comm')) === 'systemd')
  await docker(['cp', `${artifact}/.`, `${container}:/opt/dsh`], 180000)
  await docker(['cp', `${temporary}/.`, `${container}:/opt/qualification`])
  await inside('bash', '-eu', '-c', `
    groupadd --gid 22001 dsh-im-ingress
    useradd --uid 22001 --gid dsh-im-ingress --create-home --shell /usr/sbin/nologin dsh-im-ingress
    useradd --uid 22002 --create-home --shell /usr/sbin/nologin dsh-im-a
    useradd --uid 22003 --create-home --shell /usr/sbin/nologin dsh-im-b
    useradd --uid 22004 --create-home --shell /usr/sbin/nologin dsh-im-outsider
    chmod -R a+rX /opt/dsh /opt/qualification
    mkdir -p /etc/dsh-im
    for tenant in a b; do
      mkdir -p /srv/$tenant/home /srv/$tenant/workspace /srv/$tenant/state /srv/$tenant/sessions /srv/$tenant/tmp
      printf '%s' fixture-secret > /srv/$tenant/home/credential-fixture
      chmod -R 0700 /srv/$tenant
      chmod 0600 /srv/$tenant/home/credential-fixture
      chown -R dsh-im-$tenant:dsh-im-$tenant /srv/$tenant
    done
  `)
  await inside('runuser', '-u', 'dsh-im-a', '--', 'env', 'TMPDIR=/srv/a/tmp', 'node', '-e',
    "try { require('/opt/dsh/node_modules/node-addon-require-builtin') } catch(error) { console.error(require('node:util').inspect(error,{depth:12}));process.exitCode=1 }")
  for (const tenant of ['a', 'b'] as const) {
    const patches = [
      { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
      { id: 'llm-deepseek', disabled: true }, { id: 'plugin-package-inventory-deepseek', disabled: true },
      { id: 'session-title-llm', disabled: true },
      { id: 'session-persistence-jsonl', config: { root: `/srv/${tenant}/sessions`, compression: 'none' } },
      { insert: [
        { id: 'fixture-replay', name: '/opt/dsh/node_modules/@deepseek-ai/dsh-llm-replay/lib/index.js', config: {
          file: '/opt/qualification/session.v4.jsonl', overrideFile: '/opt/qualification/replay.json',
          providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }],
        } },
        { id: 'im-runtime', name: '/opt/dsh/node_modules/@deepseek-ai/dsh-experimental-im-feishu/lib/runtime-plugin.js', config: {
          tenantId: `tenant-${tenant}`, operatorIds: [`operator-${tenant}`], workspaceId: `workspace-${tenant}`,
          stateDirectory: `/srv/${tenant}/state`, cwd: `/srv/${tenant}/workspace`, useSystemdStdio: true,
          modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        } },
      ] },
    ]
    await writeFile(join(temporary, `${tenant}.patch.yml`), JSON.stringify(patches))
    await docker(['cp', join(temporary, `${tenant}.patch.yml`), `${container}:/etc/dsh-im/${tenant}.patch.yml`])
    const assetRoot = join(repo, 'packages/experimental/im-feishu/examples/systemd/system')
    const socketAsset = await readFile(join(assetRoot, `dsh-im-${tenant}.socket`), 'utf8')
    const serviceAsset = (await readFile(join(assetRoot, `dsh-im-${tenant}@.service`), 'utf8'))
      .replaceAll(`/var/lib/dsh-im/${tenant}`, `/srv/${tenant}`)
      .replace(`/usr/local/bin/dsh --profile tenant-${tenant}`,
        `/usr/local/bin/node ${cli} --profile headless --patch /etc/dsh-im/${tenant}.patch.yml`)
    await writeFile(join(temporary, `${tenant}.socket`), socketAsset)
    await writeFile(join(temporary, `${tenant}.service`), serviceAsset)
    await docker(['cp', join(temporary, `${tenant}.socket`), `${container}:/etc/systemd/system/dsh-im-${tenant}.socket`])
    await docker(['cp', join(temporary, `${tenant}.service`), `${container}:/etc/systemd/system/dsh-im-${tenant}@.service`])
  }
  const tmpfiles = (await readFile(join(repo, 'packages/experimental/im-feishu/examples/tmpfiles.d/dsh-im.conf'), 'utf8'))
    .replaceAll('/var/lib/dsh-im', '/srv')
  await writeFile(join(temporary, 'dsh-im-real.conf'), tmpfiles)
  await docker(['cp', join(temporary, 'dsh-im-real.conf'), `${container}:/etc/tmpfiles.d/dsh-im-real.conf`])
  await inside('bash', '-eu', '-c', 'systemd-tmpfiles --create /etc/tmpfiles.d/dsh-im-real.conf; systemctl daemon-reload; systemctl enable --now dsh-im-a.socket dsh-im-b.socket')
  unitsMounted = true
  for (const tenant of ['a', 'b']) {
    for (const user of ['dsh-im-outsider', 'dsh-im-a', 'dsh-im-b']) {
      const result = await inside('runuser', '-u', user, '--', 'node', '--input-type=module', '-e',
        `import{createConnection}from'node:net';const s=createConnection('/run/dsh-im/${tenant}/rpc.sock');s.on('connect',()=>{s.destroy();process.exitCode=1});s.on('error',e=>{if(e.code!=='EACCES')process.exitCode=1;else console.log('EACCES')});`)
      requireCondition(result === 'EACCES', 'Foreign UID connected before kernel authorization')
    }
  }
  checks.push('Both real tenant sockets refuse all tenant/outsider UIDs before protocol access')
  const a = await connect('a')
  const b = await connect('b')
  for (const [tenant, uid] of [['a', 22002], ['b', 22003]] as const) {
    const instances = (await inside('systemctl', 'list-units', '--type=service', '--state=running', '--plain', '--no-legend',
      `dsh-im-${tenant}@*.service`)).split('\n').filter(Boolean)
    requireCondition(instances.length === 1, 'Expected one live tenant instance')
    const unit = instances[0]!.trim().split(/\s+/)[0]!
    const pid = await inside('systemctl', 'show', '--value', '--property=MainPID', unit)
    const status = await inside('cat', `/proc/${pid}/status`)
    requireCondition(status.includes(`Uid:\t${uid}\t${uid}\t${uid}\t${uid}`) && status.includes('NoNewPrivs:\t1'),
      'Runtime effective identity or no-new-privileges policy differs')
    const group = await inside('systemctl', 'show', '--value', '--property=ControlGroup', unit)
    requireCondition(await inside('cat', `/sys/fs/cgroup${group}/memory.max`) === String(768 * 1024 * 1024), 'Memory limit not applied')
    requireCondition(await inside('cat', `/sys/fs/cgroup${group}/pids.max`) === '96', 'Process limit not applied')
    requireCondition(await inside('cat', `/sys/fs/cgroup${group}/cpu.max`) === '200000 100000', 'CPU limit not applied')
    const modes = await inside('stat', '-c', '%U:%G:%a', `/run/dsh-im/${tenant}`, `/run/dsh-im/${tenant}/rpc.sock`)
    requireCondition(modes === 'root:dsh-im-ingress:750\nroot:dsh-im-ingress:660', 'Tenant socket inventory permissions differ')
  }
  checks.push('Actual runtime UID, no-new-privileges, kernel CPU/memory/process limits and protected socket inventory')
  const requestA = await submit(a, 'a', 'one')
  const requestB = await submit(b, 'b', 'one')
  const sessionA = await completed(a, key('a', 'one'))
  const sessionB = await completed(b, key('b', 'one'))
  requireCondition(sessionA !== sessionB, 'Tenant Sessions were shared')
  checks.push('Two installed CLI profiles complete real persisted Agent turns under separate UIDs')
  const duplicate = await a.request({ type: 'submit_delivery', deliveryKey: key('a', 'one'), requestId: requestA,
    operatorId: 'operator-a', prompt: 'Reply with exactly the word: PONG. Do not use any tools.', sessionId: sessionA })
  requireCondition(duplicate.type === 'submit_delivery_ack' && duplicate.status === 'completed', 'Completed duplicate was readmitted')
  await submit(a, 'a', 'two', sessionA)
  requireCondition(await completed(a, key('a', 'two')) === sessionA, 'Conversation did not retain its Session')
  const foreign = await a.request({ type: 'submit_delivery', deliveryKey: key('a', 'foreign'), requestId: randomUUID(),
    operatorId: 'operator-a', prompt: 'must not execute', sessionId: sessionB })
  requireCondition(foreign.type === 'error', 'Foreign Session was admitted')
  checks.push('Durable duplicate suppression, multi-turn Session continuity and foreign Session refusal')
  const second = new TenantProbe('a')
  let refused = false
  try { await second.request({ type: 'init', protocolVersion: 1, ingressId: 'fixture-ingress', targetTenantId: 'tenant-a' }) }
  catch (error) { refused = error instanceof Error }
  await second.close()
  requireCondition(refused, 'Second concurrent writer was admitted')
  const ping = await a.request({ type: 'ping' })
  requireCondition(ping.type === 'pong', 'Second-writer control disrupted the original connection')
  checks.push('MaxConnections refuses a second real runtime while the original remains responsive')
  await submit(a, 'a', 'cancel', sessionA)
  await delay(250)
  await a.close()
  await waitFor(async () => !(await inside('systemctl', 'list-units', '--type=service', '--state=running', '--plain', '--no-legend', 'dsh-im-a@*.service')).trim())
  const resumed = await connect('a')
  const cancelled = await resumed.request({ type: 'get_delivery', deliveryKey: key('a', 'cancel') })
  requireCondition(cancelled.type === 'get_delivery_ack' && cancelled.reconciliation.state === 'cancelled', `EOF did not cancel and persist the active turn: ${JSON.stringify(cancelled)}`)
  checks.push('EOF drains real Agent cancellation, releases the runtime and cold reconnect reads durable cancellation')
  await resumed.close()
  await b.close()
  await waitFor(async () => !(await inside('systemctl', 'list-units', '--type=service', '--state=running', '--plain', '--no-legend', 'dsh-im-a@*.service')).trim())
  const wrongWorkspace = new TenantProbe('a')
  const workspaceRefusal = await wrongWorkspace.request({ type: 'init', protocolVersion: 1, ingressId: 'fixture-ingress',
    targetTenantId: 'tenant-a', workspaceId: 'workspace-b' })
  requireCondition(workspaceRefusal.type === 'error' && workspaceRefusal.code === 'ERR_WORKSPACE_MISMATCH', 'Wrong workspace handshake was accepted')
  await wrongWorkspace.close()
  checks.push('Real socket-activated runtime refuses a foreign workspace handshake before Agent admission')
  for (const [tenant, other] of [['a', 'b'], ['b', 'a']]) {
    const denied = await inside('runuser', '-u', `dsh-im-${tenant}`, '--', 'bash', '-c',
      `test ! -r /srv/${other}/home/credential-fixture && test ! -r /srv/${other}/sessions && test ! -w /srv/${other}/workspace && test ! -w /etc/dsh-im/${other}.patch.yml && printf denied`)
    requireCondition(denied === 'denied', 'Cross-UID files, credentials or deployment configuration were accessible')
  }
  checks.push('Both tenant UIDs cannot read foreign credentials/sessions or write foreign workspace/root-owned profile')
  const tcp = await inside('ss', '-ltnH')
  requireCondition(tcp === '', 'Unexpected TCP control listener')
  checks.push('Network-disabled container has no tenant TCP control listener')
  await docker(['restart', container])
  await waitFor(async () => (await inside('bash', '-c', 'systemctl is-active dsh-im-a.socket 2>/dev/null || true')) === 'active')
  const cold = await connect('a')
  const prior = await cold.request({ type: 'get_delivery', deliveryKey: key('a', 'one') })
  requireCondition(prior.type === 'get_delivery_ack' && prior.reconciliation.state === 'completed' && prior.reconciliation.sessionId === sessionA,
    'Cold restart lost the completed receipt')
  await cold.close()
  checks.push('Cold container restart recreates protected socket directories and preserves completed receipt/Session identity')
  console.log(JSON.stringify({ result: 'passed', scope: 'Disposable local Linux installed-Harness qualification', checks,
    kernel: await inside('uname', '-sr'), systemd: await inside('systemd', '--version'), requestIds: [requestA, requestB],
    livePlatformAcceptance: 'not run', physicalTwoHostAcceptance: 'not run' }, null, 2))
} catch (error) {
  originalFailure = error
  if (container) {
    try {
      await delay(1000)
      process.stderr.write(await inside('systemctl', 'list-units', '--all', '--no-pager', 'dsh-im-*.service') + '\n')
      process.stderr.write(await inside('journalctl', '--no-pager', '-n', '160') + '\n')
      process.stderr.write(await inside('node', '--input-type=module', '-e',
        "import{readdirSync,readFileSync}from'node:fs';import{join}from'node:path';for(const f of readdirSync('/srv/a/sessions',{recursive:true})){if(typeof f==='string'&&f.endsWith('.jsonl')){const rows=readFileSync(join('/srv/a/sessions',f),'utf8').trim().split('\\n').map(l=>JSON.parse(l));console.log(JSON.stringify(rows.filter(e=>['turn/end','turn/start','user/message'].includes(e.type)).map(e=>({type:e.type,turn:e.data?.turn,reason:e.data?.reason,source:e.data?.source}))))}}") + '\n')
    }
    catch (diagnosticError) { process.stderr.write(`Journal unavailable: ${String(diagnosticError)}\n`) }
  }
} finally {
  const failures: unknown[] = []
  if (container && unitsMounted) {
    try { await inside('bash', '-c', 'systemctl stop "dsh-im-a@*.service" "dsh-im-b@*.service" dsh-im-a.socket dsh-im-b.socket') }
    catch (error) { failures.push(error) }
  }
  for (const client of clients) {
    try { await client.close() } catch (error) { failures.push(error) }
  }
  if (container) {
    try { await docker(['stop', '-t', '8', container]) } catch (error) { failures.push(error) }
    try { await docker(['rm', '-f', container]) } catch (error) { failures.push(error) }
  }
  await rm(temporary, { recursive: true, force: true })
  if (originalFailure) failures.unshift(originalFailure)
  if (failures.length) throw new AggregateError(failures, 'Installed Linux tenant qualification failed')
}
