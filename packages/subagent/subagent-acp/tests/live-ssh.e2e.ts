/** Real SSH ACP controls against an explicitly configured disposable target, with independent process observation. */
import { ChildProcess, execFile } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SshConnection } from '@deepseek-ai/dsh-ssh'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import * as acp from '../src/index.ts'

const execute = promisify(execFile)
const configPath = process.env.DSH_SSH_TEST_CONFIG
const enabled = configPath !== undefined && process.platform !== 'win32'
const configSchema = z.object({ host: z.string(), badHost: z.string(), node: z.string(), helper: z.string(),
  helperHash: z.string(), workspace: z.string(), requestTimeoutMs: z.number(), maxFrameBytes: z.number(),
  maxPending: z.number(), leaseMs: z.number().min(3000) })
const observationSchema = z.object({ alive: z.boolean(), descendantAlive: z.boolean(),
  starts: z.number().int(), prompts: z.number().int() })

function configuration() {
  return configSchema.parse(JSON.parse(readFileSync(z.string().min(1).parse(configPath), 'utf8')))
}

async function observeTarget(...args: string[]): Promise<string> {
  const context = z.string().min(1).parse(process.env.DSH_SSH_TEST_DOCKER_CONTEXT)
  const container = z.string().min(1).parse(process.env.DSH_SSH_TEST_DOCKER_CONTAINER)
  return (await execute('docker', ['--context', context, 'exec', container, ...args], { timeout: 10000 })).stdout.trim()
}

function trackedScript(marker: string, mode: 'hang' | 'complete' | 'descendant' | 'stall-init'): string {
  return `
import {appendFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const marker=${JSON.stringify(marker)};const mode=${JSON.stringify(mode)};
appendFileSync(marker+'.starts',String(process.pid)+'\\n');
const record=(prompts,descendantPid=null)=>writeFileSync(marker,JSON.stringify({pid:process.pid,descendantPid,prompts}));
let prompts=0;record(0);if(mode==='hang'||mode==='stall-init')setInterval(()=>{},1000);const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const rl=createInterface({input:process.stdin,terminal:false});
rl.on('line',async line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'){if(mode!=='stall-init')reply(m.id,{protocolVersion:1,serverCapabilities:{}})}
 else if(m.method==='session/new')reply(m.id,{sessionId:'tracked'});
 else if(m.method==='session/prompt'){
  let descendantPid=null;
  if(mode==='descendant'){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});descendantPid=child.pid;child.unref()}
  record(++prompts,descendantPid);
  if(mode==='complete'||mode==='descendant'){
   process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'tracked',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'remote ACP reply'}}}})+'\\n');
   reply(m.id,{stopReason:'end_turn'});
  }
 }
});
`
}

async function observation(marker: string) {
  const script = `const fs=require('node:fs');const p=process.argv[1];
let row;try{row=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const alive=pid=>{if(!pid)return false;try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0]!=='Z'}catch(e){if(e.code==='ENOENT')return false;throw e}};
let starts=0;try{starts=fs.readFileSync(p+'.starts','utf8').trim().split('\\n').filter(Boolean).length}catch(e){if(e.code!=='ENOENT')throw e}
console.log(JSON.stringify({alive:alive(row?.pid),descendantAlive:alive(row?.descendantPid),starts,prompts:row?.prompts??0}));`
  return observationSchema.parse(JSON.parse(await observeTarget('node', '-e', script, marker)))
}

async function waitForObservation(marker: string, predicate: (value: z.infer<typeof observationSchema>) => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (true) {
    const value = await observation(marker)
    if (predicate(value)) return value
    if (Date.now() >= deadline) throw new Error(`Remote process observation timed out: ${JSON.stringify(value)}`)
    await delay(50)
  }
}

async function setup() {
  const root = new Context()
  try {
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(SubagentRuntime)
    await root.plugin(LocalSubprocessRuntime)
    const group = root.isolate('subprocess').isolate('ssh')
    await group.plugin(SshConnection, configuration())
    await group.plugin(SshSubprocessRuntime)
    const hello = await group.ssh.ready
    return { root, group, hello }
  } catch (error) {
    await root.fiber.dispose()
    throw error
  }
}

async function startTracked(mode: Parameters<typeof trackedScript>[1]) {
  const target = await setup()
  const marker = `${target.hello.workspace}/acp-control-${randomUUID()}`
  try {
    await target.group.plugin(acp, { providerName: 'tracked', command: target.hello.node,
      args: ['--input-type=module', '-e', trackedScript(marker, mode)], cwd: target.hello.workspace,
      validateCwd: false, permission: 'reject', env: {}, disposeEofGraceMs: 200, disposeGraceMs: 1000 })
    const controller = new AbortController()
    const parent = { id: 'fixture-parent', session: { header: { cwd: process.cwd() } } }
    const starting = target.root.subagents.start('tracked', { prompt: [{ type: 'text', text: 'control' }],
      parent: parent as never, signal: controller.signal })
    // Install rejection ownership before fault injection or waiting for remote readiness.
    void starting.catch((error: unknown) => {
      // The test awaits the original promise after independent readiness observation.
      void error
    })
    return { ...target, marker, controller, starting }
  } catch (error) {
    await target.root.fiber.dispose()
    throw error
  }
}

function ownedSshChild(group: Context): ChildProcess {
  // Fault injection uses only this service's exact child; it never searches or kills host process matches.
  const child: unknown = Reflect.get(group.ssh, 'child')
  if (!(child instanceof ChildProcess) || child.exitCode !== null || child.signalCode !== null) {
    throw new Error('Expected a live owned SSH child for fault injection')
  }
  return child
}

async function killOwnedChild(child: ChildProcess): Promise<void> {
  const closed = once(child, 'close')
  expect(child.kill('SIGKILL')).toBe(true)
  await closed
}

describe.skipIf(!enabled)('Disposable SSH ACP qualification', () => {
  it('requires effective server keepalive and Unix forwarding configuration', async () => {
    const text = (await observeTarget('/usr/sbin/sshd', '-T', '-f', '/etc/ssh/sshd_config_test',
      '-C', 'user=dsh-worker,host=localhost,addr=127.0.0.1')).toLowerCase()
    for (const setting of ['clientaliveinterval 10', 'clientalivecountmax 3', 'allowstreamlocalforwarding yes']) expect(text).toContain(setting)
  })

  it('rejects a real mismatched host key', async () => {
    const config = configuration()
    const root = new Context()
    try { await expect(root.plugin(SshConnection, { ...config, host: config.badHost })).rejects.toThrow() }
    finally { await root.fiber.dispose() }
  })

  it('completes a real out-of-process ACP exchange through the isolated SSH provider', async () => {
    const target = await startTracked('complete')
    try {
      const run = await target.starting
      const result = await run.result
      expect(result.stopReason).toBe('completed')
      expect(result.output).toEqual([{ type: 'text', text: 'remote ACP reply' }])
      expect(await observation(target.marker)).toMatchObject({ starts: 1, prompts: 1 })
      await run.dispose()
    } finally { await target.root.fiber.dispose() }
  })

  it('cancels an observed active remote prompt and removes its process', async () => {
    const target = await startTracked('hang')
    try {
      const run = await target.starting
      await waitForObservation(target.marker, value => value.alive && value.prompts === 1)
      target.controller.abort()
      expect((await run.result).stopReason).toBe('aborted')
      await run.dispose()
      expect(await waitForObservation(target.marker, value => !value.alive)).toMatchObject({ starts: 1, prompts: 1 })
    } finally { await target.root.fiber.dispose() }
  })

  it('fails an observed prompt after killing only its owned SSH child without replay', async () => {
    const target = await startTracked('hang')
    try {
      const run = await target.starting
      await waitForObservation(target.marker, value => value.alive && value.prompts === 1)
      await killOwnedChild(ownedSshChild(target.group))
      const result = await run.result
      expect(result.stopReason).toBe('error')
      expect(result.diagnostic).toBeTypeOf('string')
      expect(await waitForObservation(target.marker, value => !value.alive)).toMatchObject({ starts: 1, prompts: 1 })
      await expect(run.dispose()).rejects.toThrow(/stage: teardown; category: unknown/)
    } finally { await target.root.fiber.dispose() }
  })

  it('expires the remote lease during a stopped transport before local teardown and never replays', async () => {
    const target = await startTracked('hang')
    const child = ownedSshChild(target.group)
    try {
      const run = await target.starting
      await waitForObservation(target.marker, value => value.alive && value.prompts === 1)
      const stoppedAt = Date.now()
      expect(child.kill('SIGSTOP')).toBe(true)
      expect(await waitForObservation(target.marker, value => !value.alive, configuration().leaseMs * 4))
        .toMatchObject({ starts: 1, prompts: 1 })
      expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(configuration().leaseMs / 2)
      // Independent Docker observation above happens before any local teardown can clean up the remote child.
      expect(child.kill('SIGCONT')).toBe(true)
      if (child.exitCode === null && child.signalCode === null) await killOwnedChild(child)
      const result = await run.result
      expect(result.stopReason).toBe('error')
      expect(result.diagnostic).toBeTypeOf('string')
      await expect(run.dispose()).rejects.toThrow(/stage: teardown; category: unknown/)
      expect(await observation(target.marker)).toMatchObject({ starts: 1, prompts: 1 })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGCONT')
      await target.root.fiber.dispose()
    }
  })

  it('bounds a stalled initialization with the caller deadline and observes process cleanup', async () => {
    const target = await startTracked('stall-init')
    try {
      await waitForObservation(target.marker, value => value.alive)
      const timer = setTimeout(() => { target.controller.abort() }, 250)
      try { await expect(target.starting).rejects.toThrow(/aborted/i) }
      finally { clearTimeout(timer) }
      expect(await waitForObservation(target.marker, value => !value.alive)).toMatchObject({ starts: 1, prompts: 0 })
    } finally { await target.root.fiber.dispose() }
  })

  it('removes an independently observed descendant on disposal', async () => {
    const target = await startTracked('descendant')
    try {
      const run = await target.starting
      expect((await run.result).stopReason).toBe('completed')
      await waitForObservation(target.marker, value => value.alive && value.descendantAlive)
      await run.dispose()
      expect(await waitForObservation(target.marker, value => !value.alive && !value.descendantAlive))
        .toMatchObject({ starts: 1, prompts: 1 })
    } finally { await target.root.fiber.dispose() }
  })

  it('executes installed dsh ACP with a real remote-only session directory and keyless replay', async () => {
    expect(process.env.DSH_TEST_ENABLE_REMOTE_DSH).toBe('1')
    const target = await setup()
    try {
      const sessionCwd = `${target.hello.workspace}/session-cwd`
      expect(existsSync(sessionCwd)).toBe(false)
      await target.group.plugin(acp, { providerName: 'installed', command: '/usr/local/bin/dsh',
        args: ['--profile', 'acp', '--patch', z.string().min(1).parse(process.env.DSH_SSH_TEST_REMOTE_PATCH)],
        cwd: target.hello.workspace, sessionCwd, validateCwd: false, permission: 'reject',
        env: { HOME: '/home/dsh-worker', DSH_HOME: '/home/dsh-worker/.dsh',
          TMPDIR: z.string().min(1).parse(process.env.DSH_SSH_TEST_REMOTE_TMPDIR), DSH_TELEMETRY_DISABLED: '1', NO_PROXY: '*' } })
      const parent = { id: 'fixture-parent', session: { header: { cwd: process.cwd() } } }
      const run = await target.root.subagents.start('installed', { parent: parent as never,
        prompt: [{ type: 'text', text: 'Reply with exactly the word: PONG. Do not use any tools.' }], signal: AbortSignal.timeout(30000) })
      expect(await run.result).toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: 'PONG' }] })
      await run.dispose()
    } finally { await target.root.fiber.dispose() }
  })
})
