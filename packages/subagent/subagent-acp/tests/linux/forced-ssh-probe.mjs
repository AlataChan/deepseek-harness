/** Installed strict SSH positive, channel-denial and independent server-deadline controls. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execute = promisify(execFile)
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'))
const resolve = createRequire(fixture.artifact + '/package.json').resolve
const load = name => import(pathToFileURL(resolve(name)).href)
const [{ Context }, { SessionProjectionRegistry }, { SubagentRuntime }, { LocalSubprocessRuntime }, acp] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-subagent-acp',
].map(load))
const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10',
  '-o', 'ServerAliveCountMax=3', 'dsh-acp-worker', 'dsh-acp']
async function inside(...command) {
  return (await execute('docker', ['--context', fixture.context, 'exec', fixture.container, ...command], { timeout: 10000 })).stdout.trim()
}
async function state() {
  return JSON.parse(await inside('node', '-e', `const fs=require('node:fs');const root=process.argv[1];
const get=p=>{try{return JSON.parse(fs.readFileSync(root+'/'+p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
const alive=pid=>{if(!pid)return false;try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0]!=='Z'}catch(e){if(e.code==='ENOENT')return false;throw e}};
const main=get('main.json'),child=get('descendant.json');console.log(JSON.stringify({main,child,mainAlive:alive(main?.pid),childAlive:alive(child?.pid)}));`, fixture.home))
}
async function waitFor(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (true) {
    const value = await state()
    if (predicate(value)) return value
    if (Date.now() >= deadline) throw new Error('Strict remote process condition timed out: ' + JSON.stringify(value))
    await delay(100)
  }
}
async function requiresRejection(arguments_, pattern) {
  let error
  try { await execute('ssh', arguments_, { timeout: 10000 }) } catch (failure) { error = failure }
  assert.ok(error, 'Forbidden SSH operation unexpectedly succeeded')
  assert.equal(error.killed, false, 'A timeout is not proof that the server refused a channel')
  assert.match(error.stderr, pattern)
}
const root = new Context()
let run
try {
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SubagentRuntime)
  await root.plugin(LocalSubprocessRuntime)
  await root.plugin(acp, { providerName: 'strict', command: 'ssh', args, cwd: process.cwd(),
    sessionCwd: fixture.home + '/workspace', validateCwd: false, permission: 'reject',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: process.env.DOCKER_CONFIG },
    disposeEofGraceMs: 8000, disposeGraceMs: 3000 })
  run = await root.subagents.start('strict', {
    parent: { id: 'strict-parent', session: { header: { cwd: process.cwd() } } },
    prompt: [{ type: 'text', text: 'Reply with exactly the word: PONG. Do not use any tools.' }], signal: AbortSignal.timeout(30000),
  })
  assert.deepEqual(await run.result, { output: [{ type: 'text', text: 'PONG' }], stopReason: 'completed' })
  const live = await waitFor(value => value.mainAlive && value.childAlive)
  assert.match(live.main.cgroup, /dsh-acp-[a-f0-9-]+\.service/)
  console.log('PASS: strict forced-command installed ACP PONG in an owned systemd user service')
  await run.dispose()
  await waitFor(value => !value.mainAlive && !value.childAlive)
  console.log('PASS: strict ACP normal disposal removes an uncooperative descendant')
} finally { await root.fiber.dispose() }

await inside('chmod', '0666', '/etc/dsh-acp-worker.env')
try {
  await requiresRejection(['-T', '-o', 'BatchMode=yes', 'dsh-acp-worker', 'dsh-acp'], /configuration must not be writable/)
} finally { await inside('chmod', '0644', '/etc/dsh-acp-worker.env') }
const originalConfiguration = await inside('cat', '/etc/dsh-acp-worker.env')
const overflowConfiguration = originalConfiguration.replace(/^DSH_ACP_MAX_RUNTIME_SECONDS=.*$/m,
  'DSH_ACP_MAX_RUNTIME_SECONDS=999999999999999999999999999')
assert.notEqual(overflowConfiguration, originalConfiguration)
const replaceConfiguration = text => inside('node', '-e',
  "require('node:fs').writeFileSync('/etc/dsh-acp-worker.env',process.argv[1])", text)
await replaceConfiguration(overflowConfiguration)
try {
  await requiresRejection(['-T', '-o', 'BatchMode=yes', 'dsh-acp-worker', 'dsh-acp'], /deadline is outside/)
} finally { await replaceConfiguration(originalConfiguration) }
console.log('PASS: writable configuration and oversized deadlines fail before starting a runtime')
await requiresRejection(['-T', '-o', 'BatchMode=yes', '-W', '127.0.0.1:2222', 'dsh-acp-worker'], /administratively prohibited|open failed/i)
await requiresRejection(['-T', '-o', 'BatchMode=yes', 'dsh-acp-worker', 'id'], /Only the fixed ACP command is accepted/)
console.log('PASS: server refuses arbitrary TCP forwarding and arbitrary remote commands')
await inside('rm', '-f', fixture.home + '/main.json', fixture.home + '/descendant.json')
const transport = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
let diagnostic = ''
transport.stderr.on('data', chunk => { diagnostic += chunk })
transport.stdout.resume()
const closed = once(transport, 'close')
try {
  await waitFor(value => value.mainAlive && value.childAlive)
  assert.equal(transport.exitCode, null, diagnostic)
  assert.equal(transport.kill('SIGSTOP'), true)
  await waitFor(value => !value.mainAlive && !value.childAlive, (fixture.maximumSeconds + 8) * 1000)
  console.log('PASS: server RuntimeMaxSec removes ACP and descendants while the exact owned SSH transport is stopped')
} finally {
  if (transport.exitCode === null && transport.signalCode === null) {
    transport.kill('SIGCONT')
    transport.kill('SIGKILL')
  }
  await closed
}
