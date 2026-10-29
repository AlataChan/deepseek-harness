/** Create a disposable SSH target and qualify installed ACP plus source-owned failure controls. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'
import { qualifyForcedSsh } from './qualify-forced-ssh.ts'

const execute = promisify(execFile)
const context = z.string().min(1).parse(process.argv[2])
const image = z.string().min(1).parse(process.argv[3])
const artifact = z.string().min(1).parse(process.argv[4])
const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dsh-installed-ssh-'))
const name = `dsh-expansion-ssh-${randomUUID().slice(0, 8)}`
const network = name + '-network'
const remoteRoot = '/opt/dsh-installed'
const env = { PATH: process.env.PATH, HOME: temporary, TMPDIR: process.env.TMPDIR, NO_PROXY: '*', DSH_TELEMETRY_DISABLED: '1' }
let networkCreated = false
let container: string | undefined
let failure: unknown

async function docker(args: string[], timeout = 30000): Promise<string> {
  return (await execute('docker', ['--context', context, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME },
    timeout, maxBuffer: 2 * 1024 * 1024 })).stdout.trim()
}
async function inside(...args: string[]): Promise<string> {
  if (!container) throw new Error('SSH fixture container is not owned')
  return docker(['exec', container, ...args])
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

try {
  const endpoints = z.object({ docker: z.object({ Host: z.string().startsWith('unix://') }) })
    .parse(JSON.parse(await docker(['context', 'inspect', context, '--format', '{{json .Endpoints}}'])))
  assert.ok(endpoints.docker.Host)
  await readFile(join(artifact, 'node_modules/.collect-manifest.json'))
  await docker(['network', 'create', '--internal', '--label', 'dsh.expansion.run=run_defe54996fc5', network])
  networkCreated = true
  container = await docker(['run', '-d', '--name', name, '--label', 'dsh.expansion.run=run_defe54996fc5',
    '--network', network, '--privileged', '--cgroupns=private', '--tmpfs', '/run',
    '--tmpfs', '/run/lock', '--tmpfs', '/tmp', image])
  assert.match(container, /^[a-f0-9]{64}$/)
  await docker(['cp', `${artifact}/.`, `${container}:${remoteRoot}`], 180000)
  await execute('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(temporary, 'client-key')], { env })
  await execute('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(temporary, 'wrong-host-key')], { env })
  const bootDeadline = Date.now() + 30000
  while ((await inside('systemctl', 'show', 'systemd-tmpfiles-setup.service', '--property=ActiveState', '--value')) !== 'active') {
    if (Date.now() >= bootDeadline) throw new Error('Disposable SSH systemd boot did not settle')
    await delay(100)
  }
  await inside('mkdir', '-p', '/opt/qualification')
  await docker(['cp', join(temporary, 'client-key.pub'), `${container}:/opt/qualification/client-key.pub`])
  await docker(['cp', join(repo, 'packages/subagent/subagent-acp/examples/sshd_config.worker'),
    `${container}:/opt/qualification/sshd_config.worker`])
  await inside('bash', '-eu', '-c', `
    useradd --create-home --shell /bin/bash dsh-worker
    passwd -d dsh-worker >/dev/null
    mkdir -p /run/sshd /home/dsh-worker/.ssh /home/dsh-worker/workspace/session-cwd /home/dsh-worker/tmp /opt/qualification
    cp /opt/qualification/client-key.pub /home/dsh-worker/.ssh/authorized_keys
    chmod 0700 /home/dsh-worker /home/dsh-worker/.ssh /home/dsh-worker/tmp
    chmod 0600 /home/dsh-worker/.ssh/authorized_keys
    chown -R dsh-worker:dsh-worker /home/dsh-worker
    chmod -R a+rX ${remoteRoot}
    mkdir -p /etc/ssh/authorized_keys.d
    cp /opt/qualification/client-key.pub /etc/ssh/authorized_keys.d/dsh-worker
    chmod 0644 /etc/ssh/authorized_keys.d/dsh-worker
    ssh-keygen -A
    cat > /etc/ssh/sshd_config_test <<'CONFIG'
Port 2222
HostKey /etc/ssh/ssh_host_ed25519_key
AuthorizedKeysFile /home/dsh-worker/.ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
UsePAM no
AllowUsers dsh-worker
ClientAliveInterval 10
ClientAliveCountMax 3
AllowTcpForwarding local
AllowStreamLocalForwarding yes
PermitTunnel no
X11Forwarding no
CONFIG
    cat /opt/qualification/sshd_config.worker >> /etc/ssh/sshd_config_test
    /usr/sbin/sshd -t -f /etc/ssh/sshd_config_test
    /usr/sbin/sshd -E /tmp/dsh-sshd.log -f /etc/ssh/sshd_config_test
    printf '%s\\n' '#!/bin/sh' 'exec /usr/local/bin/node ${remoteRoot}/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"' > /usr/local/bin/dsh
    chmod 0755 /usr/local/bin/dsh
  `)
  const effective = await inside('/usr/sbin/sshd', '-T', '-f', '/etc/ssh/sshd_config_test',
    '-C', 'user=dsh-worker,host=localhost,addr=127.0.0.1')
  for (const setting of ['clientaliveinterval 10', 'clientalivecountmax 3', 'allowstreamlocalforwarding yes']) assert.ok(effective.includes(setting))
  const port = 2222
  await writeFile(join(temporary, 'tcp-bridge.mjs'), `import{createConnection}from'node:net';
const socket=createConnection({host:'127.0.0.1',port:2222,allowHalfOpen:true});
socket.on('error',error=>{process.stderr.write(String(error));process.exitCode=1;socket.destroy();process.stdin.destroy()});
process.stdin.pipe(socket);socket.pipe(process.stdout);socket.on('close',()=>process.stdin.destroy());\n`)
  await docker(['cp', join(temporary, 'tcp-bridge.mjs'), `${container}:/opt/qualification/tcp-bridge.mjs`])
  const hostKey = (await inside('cat', '/etc/ssh/ssh_host_ed25519_key.pub')).split(' ').slice(0, 2).join(' ')
  const wrongKey = (await readFile(join(temporary, 'wrong-host-key.pub'), 'utf8')).split(' ').slice(0, 2).join(' ')
  for (const [filename, key] of [['known-hosts', hostKey], ['wrong-known-hosts', wrongKey]] as const) {
    await writeFile(join(temporary, filename), `[127.0.0.1]:${port} ${key}\n`, { mode: 0o600 })
  }
  const sshConfig = ['dsh-worker', 'dsh-bad-worker'].map(host => `Host ${host}
  HostName 127.0.0.1
  Port ${port}
  ProxyCommand docker --host ${quote(endpoints.docker.Host)} exec -i ${container} /usr/local/bin/node /opt/qualification/tcp-bridge.mjs
  User dsh-worker
  IdentityFile ${join(temporary, 'client-key')}
  IdentitiesOnly yes
  IdentityAgent none
  UserKnownHostsFile ${join(temporary, host === 'dsh-worker' ? 'known-hosts' : 'wrong-known-hosts')}
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 5
`).join('\n')
  await writeFile(join(temporary, 'ssh-config'), sshConfig, { mode: 0o600 })
  await mkdir(join(temporary, 'bin'))
  await writeFile(join(temporary, 'bin/ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F ${quote(join(temporary, 'ssh-config'))} "$@"\n`, { mode: 0o700 })
  const helper = 'node_modules/@deepseek-ai/dsh-ssh/lib/helper.js'
  const configPath = join(temporary, 'test-config.json')
  await writeFile(configPath, JSON.stringify({ host: 'dsh-worker', badHost: 'dsh-bad-worker', node: '/usr/local/bin/node',
    helper: `${remoteRoot}/${helper}`, helperHash: createHash('sha256').update(await readFile(join(artifact, helper))).digest('hex'),
    workspace: '/home/dsh-worker/workspace', requestTimeoutMs: 10000, maxFrameBytes: 1048576, maxPending: 32, leaseMs: 3000,
  }), { mode: 0o600 })
  const patch = [
    ...['llm-deepseek', 'plugin-package-inventory-deepseek', 'session-title-llm'].map(id => ({ id, disabled: true })),
    { id: 'session-persistence-jsonl', config: { root: '/home/dsh-worker/sessions', compression: 'none' } },
    { insert: [{ id: 'fixture-replay', name: `${remoteRoot}/node_modules/@deepseek-ai/dsh-llm-replay/lib/index.js`,
      config: { file: '/opt/qualification/session.v4.jsonl', providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] } }] },
  ]
  await writeFile(join(temporary, 'acp.patch.yml'), JSON.stringify(patch))
  await docker(['cp', join(repo, 'snapshots/im/human-turn/session.v4.jsonl'), `${container}:/opt/qualification/session.v4.jsonl`])
  await docker(['cp', join(temporary, 'acp.patch.yml'), `${container}:/opt/qualification/acp.patch.yml`])
  const metadata = join(temporary, 'fixture.json')
  await writeFile(metadata, JSON.stringify({ artifact, configPath }), { mode: 0o600 })
  const probe = join(temporary, 'installed-probe.mjs')
  await writeFile(probe, `
import {readFileSync} from 'node:fs';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'));const resolve=createRequire(fixture.artifact+'/package.json').resolve;
const load=name=>import(pathToFileURL(resolve(name)).href);
const[{Context},{SessionProjectionRegistry},{SubagentRuntime},{LocalSubprocessRuntime},{SshConnection},{SshSubprocessRuntime},acp]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-subagent','@deepseek-ai/dsh-subprocess-local','@deepseek-ai/dsh-ssh','@deepseek-ai/dsh-subprocess-ssh','@deepseek-ai/dsh-subagent-acp'].map(load));
const root=new Context();let run;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
try{await root.plugin(SessionProjectionRegistry);await root.plugin(SubagentRuntime);await root.plugin(LocalSubprocessRuntime);
const group=root.isolate('subprocess').isolate('ssh');await group.plugin(SshConnection,JSON.parse(readFileSync(fixture.configPath,'utf8')));await group.plugin(SshSubprocessRuntime);const hello=await group.ssh.ready;
await group.plugin(acp,{providerName:'installed-qualified',command:hello.node,args:['${remoteRoot}/node_modules/@deepseek-ai/dsh/lib/bin.js','--profile','acp','--patch','/opt/qualification/acp.patch.yml'],cwd:hello.workspace,sessionCwd:hello.workspace+'/session-cwd',validateCwd:false,permission:'reject',env:{HOME:'/home/dsh-worker',DSH_HOME:'/home/dsh-worker/.dsh',TMPDIR:'/home/dsh-worker/tmp',DSH_TELEMETRY_DISABLED:'1',NO_PROXY:'*'}});
run=await root.subagents.start('installed-qualified',{prompt:[{type:'text',text:'Reply with exactly the word: PONG. Do not use any tools.'}],parent:{id:'fixture-parent',session:{header:{cwd:process.cwd()}}},signal:controller.signal});
const result=await run.result;assert.equal(result.stopReason,'completed');assert.deepEqual(result.output,[{type:'text',text:'PONG'}]);console.log('PASS: built coordinator and installed remote dsh ACP PONG');
}finally{clearTimeout(timer);if(run)await run.dispose();await root.fiber.dispose()}
`)
  const childEnv = { ...env, PATH: `${join(temporary, 'bin')}:${process.env.PATH ?? ''}`,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(z.string().min(1).parse(process.env.HOME), '.docker') }
  const installedResult = await execute(process.execPath, [probe, metadata], { cwd: temporary, env: childEnv, timeout: 45000 })
  process.stdout.write(installedResult.stdout)
  const require = createRequire(join(repo, 'package.json'))
  const configFile = join(temporary, 'vitest.config.mjs')
  await writeFile(configFile, `import{defineConfig}from${JSON.stringify(pathToFileURL(require.resolve('vitest/config')).href)};
import tsconfigPaths from${JSON.stringify(pathToFileURL(require.resolve('vite-tsconfig-paths')).href)};
import{standardDecoratorPlugin,vitestExecArgv}from${JSON.stringify(pathToFileURL(join(repo, 'vitest.shared.ts')).href)};
export default defineConfig({root:${JSON.stringify(repo)},plugins:[tsconfigPaths({projects:[${JSON.stringify(join(repo, 'tsconfig.base.json'))}]}),standardDecoratorPlugin()],test:{execArgv:vitestExecArgv,include:['packages/subagent/subagent-acp/tests/live-ssh.e2e.ts'],testTimeout:45000,hookTimeout:30000,retry:0,maxWorkers:1,fileParallelism:false}});`)
  if (!process.argv.includes('--strict-only')) {
    const resultsFile = join(temporary, 'live-results.json')
    const suite = await execute(process.execPath, [join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
      'run', '--config', configFile, '--configLoader', 'native', '--reporter', 'default', '--reporter', 'json',
      '--outputFile.json', resultsFile], { cwd: repo, env: { ...childEnv, DSH_SSH_TEST_CONFIG: configPath,
      DSH_SSH_TEST_DOCKER_CONTEXT: context, DSH_SSH_TEST_DOCKER_CONTAINER: container,
      DSH_SSH_TEST_REMOTE_PATCH: '/opt/qualification/acp.patch.yml', DSH_SSH_TEST_REMOTE_TMPDIR: '/home/dsh-worker/tmp',
      DSH_TEST_ENABLE_REMOTE_DSH: '1',
    }, timeout: 300000, maxBuffer: 2 * 1024 * 1024 })
    process.stdout.write(suite.stdout)
    const results = z.object({ success: z.literal(true), numTotalTests: z.number().int().min(9),
      numPassedTests: z.number().int(), numPendingTests: z.literal(0), numFailedTests: z.literal(0),
    }).parse(JSON.parse(await readFile(resultsFile, 'utf8')))
    assert.equal(results.numPassedTests, results.numTotalTests, 'Required SSH controls must all execute and pass')
  }
  await qualifyForcedSsh({ docker, container, context, temporary, artifact, env: childEnv })
  console.log(process.argv.includes('--strict-only')
    ? 'PASS: strict fallback diagnostic; Path A controls explicitly not run; physical two-host acceptance remains separate'
    : 'PASS: full disposable installed SSH qualification including strict no-forwarding fallback; physical two-host acceptance remains separate')
} catch (error) { failure = error }
finally {
  const errors: unknown[] = failure ? [failure] : []
  if (container) { try { await docker(['rm', '-f', container]) } catch (error) { errors.push(error) } }
  if (networkCreated) { try { await docker(['network', 'rm', network]) } catch (error) { errors.push(error) } }
  await rm(temporary, { recursive: true, force: true })
  if (errors.length) throw new AggregateError(errors, 'Disposable SSH qualification failed')
}
