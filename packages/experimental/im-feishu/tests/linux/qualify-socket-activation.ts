/** Disposable Linux kernel/systemd qualification, explicitly separate from Harness-profile acceptance. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'

const execute = promisify(execFile)
const context = z.string().min(1).parse(process.argv[2])
const image = z.string().min(1).parse(process.argv[3])
const name = `dsh-expansion-im-${randomUUID().slice(0, 8)}`
let container: string | undefined
const clients: ChildProcessWithoutNullStreams[] = []
const clientExits: Promise<unknown[]>[] = []
const artifacts = await mkdtemp(join(tmpdir(), 'dsh-linux-im-artifacts-'))

async function docker(args: readonly string[], timeout = 30000): Promise<string> {
  const result = await execute('docker', ['--context', context, ...args], {
    env: scrubbedParentEnv(), timeout, maxBuffer: 1024 * 1024,
  })
  return result.stdout.trim()
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
  throw new Error('Linux qualification condition did not become true')
}
async function holder(): Promise<{ uid: number; pid: number; childPid: number }> {
  if (!container) throw new Error('Missing owned container')
  const child = spawn('docker', ['--context', context, 'exec', '-i', '-u', 'dsh-im-ingress', container,
    'node', '/opt/dsh-im-qualification/socket-client.mjs', '/run/dsh-im/a/rpc.sock', 'hold', '22002'], {
    env: scrubbedParentEnv(), stdio: ['pipe', 'pipe', 'pipe'],
  })
  clients.push(child)
  const exited = once(child, 'exit')
  clientExits.push(exited)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  if (!child.stdout) throw new Error('Missing client stdout')
  const lines = createInterface({ input: child.stdout })
  try {
    const row = await Promise.race([
      once(lines, 'line', { signal: AbortSignal.timeout(10000) }).then((args: unknown[]) => z.string().parse(args[0])),
      exited.then(() => { throw new Error(`Client exited before readiness: ${stderr}`) }),
    ])
    const identity = z.object({
      uid: z.literal(22002), pid: z.number().int().positive(), childPid: z.number().int().positive(),
    })
    return identity.parse(JSON.parse(row))
  } finally { lines.close() }
}

try {
  const endpoints: unknown = JSON.parse(await docker(['context', 'inspect', context, '--format', '{{json .Endpoints}}']))
  const endpoint = z.object({ docker: z.object({ Host: z.string() }) }).parse(endpoints).docker.Host
  if (!endpoint.startsWith('unix://')) throw new Error('Qualification requires an explicitly local Docker endpoint')
  const id = await docker(['run', '-d', '--name', name, '--label', 'dsh.expansion.run=run_defe54996fc5',
    '--privileged', '--cgroupns=private', '--tmpfs', '/run', '--tmpfs', '/run/lock', '--tmpfs', '/tmp', image])
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Docker did not return a container ID')
  container = id
  await waitFor(async () => (await inside('cat', '/proc/1/comm')).trim() === 'systemd')
  await docker(['cp', `${fileURLToPath(new URL('.', import.meta.url))}.`, `${container}:/opt/dsh-im-qualification`])
  const authenticationSource = await readFile(new URL('../../src/socket-authentication.ts', import.meta.url), 'utf8')
  const emitted = ts.transpileModule(authenticationSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 },
  })
  const authenticationModule = join(artifacts, 'socket-authentication.mjs')
  await writeFile(authenticationModule, emitted.outputText, { mode: 0o444 })
  await docker(['cp', authenticationModule, `${container}:/opt/dsh-im-qualification/socket-authentication.mjs`])
  await inside('bash', '-eu', '-c', `
    groupadd --gid 22001 dsh-im-ingress
    useradd --uid 22001 --gid dsh-im-ingress --create-home --shell /usr/sbin/nologin dsh-im-ingress
    useradd --uid 22002 --create-home --shell /usr/sbin/nologin dsh-im-a
    useradd --uid 22003 --create-home --shell /usr/sbin/nologin dsh-im-b
    useradd --uid 22004 --create-home --shell /usr/sbin/nologin dsh-im-outsider
    chmod 0755 /opt/dsh-im-qualification
    chmod 0444 /opt/dsh-im-qualification/echo-runtime.sh /opt/dsh-im-qualification/socket-client.mjs
    printf '%s\n' 'd /run/dsh-im 0750 root dsh-im-ingress -' 'd /run/dsh-im/a 0750 root dsh-im-ingress -' > /etc/tmpfiles.d/dsh-im-qualification.conf
    cat > /etc/systemd/system/dsh-im-a.socket <<'UNIT'
[Unit]
Requires=systemd-tmpfiles-setup.service
After=systemd-tmpfiles-setup.service
[Socket]
ListenStream=/run/dsh-im/a/rpc.sock
Accept=yes
MaxConnections=1
SocketUser=root
SocketGroup=dsh-im-ingress
SocketMode=0660
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
UNIT
    cat > /etc/systemd/system/dsh-im-a@.service <<'UNIT'
[Service]
User=dsh-im-a
Group=dsh-im-a
ExecStart=/bin/sh /opt/dsh-im-qualification/echo-runtime.sh
StandardInput=socket
StandardOutput=socket
StandardError=journal
KillMode=control-group
TimeoutStopSec=5s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
UNIT
    systemd-tmpfiles --create /etc/tmpfiles.d/dsh-im-qualification.conf
    systemctl daemon-reload
    systemctl enable --now dsh-im-a.socket
  `)
  for (const user of ['dsh-im-outsider', 'dsh-im-b', 'dsh-im-a']) {
    const denied = await inside('runuser', '-u', user, '--', 'node', '/opt/dsh-im-qualification/socket-client.mjs', '/run/dsh-im/a/rpc.sock', 'deny')
    if (denied !== 'denied:EACCES') throw new Error('Missing kernel UID refusal')
  }
  const authCheck = `import { verifySystemdTenantSocket } from '/opt/dsh-im-qualification/socket-authentication.mjs';
    await verifySystemdTenantSocket({socketPath:'/run/dsh-im/a/rpc.sock',root:'/run/dsh-im',groupId:22001});`
  await inside('runuser', '-u', 'dsh-im-ingress', '--', 'node', '--input-type=module', '-e', authCheck)
  await inside('chmod', '0666', '/run/dsh-im/a/rpc.sock')
  let badModeRejected = false
  try { await inside('runuser', '-u', 'dsh-im-ingress', '--', 'node', '--input-type=module', '-e', authCheck) }
  catch (error) { badModeRejected = error instanceof Error }
  finally { await inside('chmod', '0660', '/run/dsh-im/a/rpc.sock') }
  if (!badModeRejected) throw new Error('The actual production path policy accepted mode 0666')
  const first = await holder()
  const refused = await inside('runuser', '-u', 'dsh-im-ingress', '--', 'node', '/opt/dsh-im-qualification/socket-client.mjs',
    '/run/dsh-im/a/rpc.sock', 'second', '22002')
  if (refused !== 'second:refused') throw new Error('Missing concurrent-writer refusal')
  const units = await inside('systemctl', 'list-units', '--type=service', '--state=running', '--plain', '--no-legend', 'dsh-im-a@*.service')
  if (units.split('\n').filter(Boolean).length !== 1) throw new Error('More than one tenant service instance is running')
  const group = await inside('stat', '-c', '%U:%G:%a', '/run/dsh-im/a', '/run/dsh-im/a/rpc.sock')
  if (group !== 'root:dsh-im-ingress:750\nroot:dsh-im-ingress:660') throw new Error('Socket ownership/mode mismatch')
  await inside('kill', '-KILL', String(first.pid))
  await waitFor(async () => !(await inside('bash', '-c', `test -e /proc/${first.childPid} && printf alive || printf gone`)).includes('alive'))
  clients[0]?.stdin?.end()
  await clientExits[0]
  await docker(['restart', container])
  await waitFor(async () => (await inside('bash', '-c', 'systemctl is-active dsh-im-a.socket 2>/dev/null || true')) === 'active')
  const second = await holder()
  clients[1]?.stdin?.end()
  const secondExit = await clientExits[1]
  if (secondExit?.[0] !== 0 || secondExit[1] !== null) throw new Error('Normal EOF client did not exit cleanly')
  await inside('runuser', '-u', 'dsh-im-ingress', '--', 'node', '--input-type=module', '-e', authCheck)
  await waitFor(async () => !(await inside('bash', '-c', `test -e /proc/${second.pid} -o -e /proc/${second.childPid} && printf alive || printf gone`)).includes('alive'))
  console.log(JSON.stringify({ result: 'passed', scope: 'Linux systemd descriptor/UID probe only',
    systemd: await inside('systemd', '--version'), kernel: await inside('uname', '-sr'),
    checks: ['unrelated UID refused', 'tenant A/B refused', 'accepted socket runs as tenant UID', '0660 socket/0750 parent',
      'actual production path policy rejects mode 0666', 'concurrent writer refused',
      'control-group child cleanup after main SIGKILL', 'tmpfiles cold restart', 'EOF cleanup'],
    harnessProfileAcceptance: 'not run' }, null, 2))
} finally {
  const cleanupFailures: unknown[] = []
  for (const child of clients) child.stdin?.end()
  if (container) {
    try { await docker(['stop', '-t', '5', container]) } catch (error) { cleanupFailures.push(error) }
    try { await docker(['rm', '-f', container]) } catch (error) { cleanupFailures.push(error) }
  }
  for (let index = 0; index < clients.length; index++) {
    const child = clients[index]
    const exited = clientExits[index]
    if (!child || !exited) continue
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('Docker client did not exit')) }, 5000)
      })])
    } catch (error) {
      child.kill('SIGKILL')
      await exited
      cleanupFailures.push(error)
    } finally { clearTimeout(timer) }
  }
  await rm(artifacts, { recursive: true, force: true })
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Linux fixture cleanup failed')
}
