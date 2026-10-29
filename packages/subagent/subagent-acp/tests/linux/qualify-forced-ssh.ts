/** Qualify the strict forced-command alternative inside the caller's owned disposable SSH target. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

/**
 * Provision only the already-owned container and private fixture directory, then run installed strict ACP controls.
 * @param options - explicit Docker owner, installed artifact and private client paths.
 * @returns after all required controls and owned local child cleanup complete.
 */
export async function qualifyForcedSsh(options: {
  docker: (args: string[], timeout?: number) => Promise<string>
  container: string
  context: string
  temporary: string
  artifact: string
  env: NodeJS.ProcessEnv
}): Promise<void> {
  const { docker, container, temporary, artifact, env, context } = options
  const inside = (...args: string[]) => docker(['exec', container, ...args])
  for (const [source, target] of [
    ['examples/dsh-acp-forced-command.sh', '/usr/local/libexec/dsh-acp-forced-command'],
    ['examples/sshd_config.acp-forced', '/opt/qualification/sshd_config.acp-forced'],
  ]) {
    await inside('mkdir', '-p', '/usr/local/libexec')
    await docker(['cp', join(repo, 'packages/subagent/subagent-acp', source!), `${container}:${target}`])
  }
  const home = '/home/dsh-acp-worker'
  const remoteRoot = '/opt/dsh-installed'
  const configuration = {
    DSH_ACP_NODE: '/usr/local/bin/node', DSH_ACP_CLI: `${remoteRoot}/node_modules/@deepseek-ai/dsh/lib/bin.js`,
    DSH_ACP_PATCH: '/opt/qualification/strict-acp.patch.yml', DSH_ACP_WORKSPACE: home + '/workspace',
    DSH_ACP_HOME: home, DSH_ACP_DSH_HOME: home + '/.dsh', DSH_ACP_TMPDIR: home + '/tmp',
    DSH_ACP_MAX_RUNTIME_SECONDS: '20', DSH_ACP_STOP_SECONDS: '3', DSH_ACP_CLEANUP_SECONDS: '8',
  }
  await writeFile(join(temporary, 'strict-worker.env'), Object.entries(configuration).map(([key, value]) => `${key}=${quote(value)}`).join('\n') + '\n')
  await docker(['cp', join(temporary, 'strict-worker.env'), `${container}:/etc/dsh-acp-worker.env`])
  const patch = z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(await readFile(join(temporary, 'acp.patch.yml'), 'utf8')))
  const strictPatch: Record<string, unknown>[] = patch.map(row => row.id === 'session-persistence-jsonl'
    ? { ...row, config: { root: home + '/sessions', compression: 'none' } } : row)
  strictPatch.push({ insert: [{ id: 'strict-lifetime-fixture', name: '/opt/qualification/strict-lifetime.mjs' }] })
  await writeFile(join(temporary, 'strict-acp.patch.yml'), JSON.stringify(strictPatch))
  await docker(['cp', join(temporary, 'strict-acp.patch.yml'), `${container}:/opt/qualification/strict-acp.patch.yml`])
  await writeFile(join(temporary, 'strict-lifetime.mjs'), `
import {spawn} from 'node:child_process';import{writeFileSync,renameSync,readFileSync}from'node:fs';
const directory='${home}';
export function apply(ctx){ctx.effect(()=>{
const code="const fs=require('node:fs');process.on('SIGTERM',()=>{});const p=process.argv[1];fs.writeFileSync(p+'.tmp',JSON.stringify({pid:process.pid}));fs.renameSync(p+'.tmp',p);setInterval(()=>{},1000)";
const child=spawn(process.execPath,['-e',code,directory+'/descendant.json'],{stdio:'ignore'});
writeFileSync(directory+'/main.json.tmp',JSON.stringify({pid:process.pid,cgroup:readFileSync('/proc/self/cgroup','utf8')}));renameSync(directory+'/main.json.tmp',directory+'/main.json');
return()=>{child.kill('SIGTERM')};
})}
`)
  await docker(['cp', join(temporary, 'strict-lifetime.mjs'), `${container}:/opt/qualification/strict-lifetime.mjs`])
  await inside('bash', '-eu', '-c', `
    useradd --create-home --shell /bin/sh dsh-acp-worker
    passwd -d dsh-acp-worker >/dev/null
    mkdir -p ${home}/workspace ${home}/tmp
    chmod 0700 ${home} ${home}/workspace ${home}/tmp
    chown -R dsh-acp-worker:dsh-acp-worker ${home}
    sed 's/^/restrict /' /opt/qualification/client-key.pub > /etc/ssh/authorized_keys.d/dsh-acp-worker
    chown root:root /etc/dsh-acp-worker.env /usr/local/libexec/dsh-acp-forced-command /etc/ssh/authorized_keys.d/dsh-acp-worker
    chmod 0644 /etc/dsh-acp-worker.env /etc/ssh/authorized_keys.d/dsh-acp-worker
    chmod 0755 /usr/local/libexec/dsh-acp-forced-command
    sed -i 's/^AllowUsers dsh-worker$/AllowUsers dsh-worker dsh-acp-worker/' /etc/ssh/sshd_config_test
    cat /opt/qualification/sshd_config.acp-forced >> /etc/ssh/sshd_config_test
    loginctl enable-linger dsh-acp-worker
    systemctl start user@$(id -u dsh-acp-worker).service
    /usr/sbin/sshd -t -f /etc/ssh/sshd_config_test
  `)
  const uid = await inside('id', '-u', 'dsh-acp-worker')
  assert.match(uid, /^\d+$/)
  await inside('test', '-S', `/run/user/${uid}/bus`)
  await inside('node', '-e', "const fs=require('node:fs');process.kill(Number(fs.readFileSync('/run/sshd.pid','utf8')),'SIGTERM')")
  // sshd daemonization publishes a listening child before returning success.
  await inside('/usr/sbin/sshd', '-E', '/tmp/dsh-sshd-strict.log', '-f', '/etc/ssh/sshd_config_test')
  const effective = await inside('/usr/sbin/sshd', '-T', '-f', '/etc/ssh/sshd_config_test',
    '-C', 'user=dsh-acp-worker,host=localhost,addr=127.0.0.1')
  for (const setting of ['disableforwarding yes', 'allowtcpforwarding no', 'allowstreamlocalforwarding no',
    'forcecommand /usr/local/libexec/dsh-acp-forced-command']) assert.ok(effective.includes(setting), setting)
  const original = await readFile(join(temporary, 'ssh-config'), 'utf8')
  await writeFile(join(temporary, 'ssh-config'), original + '\n' + original.split('\n\n')[0]!
    .replace('Host dsh-worker', 'Host dsh-acp-worker').replace('User dsh-worker', 'User dsh-acp-worker') + '\n')
  const stderrFile = join(temporary, 'strict-ssh-stderr.log')
  await writeFile(join(temporary, 'bin/ssh'), `#!/bin/bash\nexec /usr/bin/ssh -F ${quote(join(temporary, 'ssh-config'))} "$@" 2> >(tee -a ${quote(stderrFile)} >&2)\n`, { mode: 0o700 })
  const metadata = join(temporary, 'strict-fixture.json')
  await writeFile(metadata, JSON.stringify({ artifact, context, container, uid, home, maximumSeconds: 20 }))
  try {
    const result = await execute(process.execPath, [join(repo, 'packages/subagent/subagent-acp/tests/linux/forced-ssh-probe.mjs'), metadata], {
      cwd: temporary, env, timeout: 90000, maxBuffer: 1024 * 1024,
    })
    process.stdout.write(result.stdout)
  } catch (error) {
    try { process.stderr.write('Strict SSH stderr: ' + await readFile(stderrFile, 'utf8') + '\n') }
    catch (diagnosticError) { process.stderr.write('SSH stderr unavailable: ' + String(diagnosticError) + '\n') }
    process.stderr.write(await inside('journalctl', '-b', '--no-pager', '-n', '80') + '\n')
    try {
      process.stderr.write(await docker(['exec', '--user', 'dsh-acp-worker', container, '/bin/sh', '-c',
        'SSH_ORIGINAL_COMMAND=dsh-acp /usr/local/libexec/dsh-acp-forced-command </dev/null'], 30000))
    } catch (diagnosticError) { process.stderr.write('Controlled worker startup diagnostic: ' + String(diagnosticError) + '\n') }
    throw error
  }
}
