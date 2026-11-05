/**
 * Shared-desktop flock: contention, startup failure, reacquisition, and a
 * supervisor that dies while its child still holds fd 3.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDesktopLease, DesktopLeaseBusyError, SHARED_DESKTOP_LEASE_HELD } from '../src/lease.ts'
import { startSupervisor } from '../src/supervisor.ts'

const supervisorUrl = new URL('../src/supervisor.ts', import.meta.url).href
const holders: { pid: number | undefined; childPid: number | undefined }[] = []

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    if (holder.pid !== undefined) kill(holder.pid)
    if (holder.childPid !== undefined) kill(holder.childPid)
  }
})

describe('desktop lease', () => {
  it('keeps the same inode and refuses a second descriptor', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const first = await acquireDesktopLease(lock)
    const before = await stat(lock)
    const stderr: string[] = []
    const busy = await startSupervisor(options(dir, { stderr: { write: (chunk) => { stderr.push(chunk) } } }))
    expect(await busy.exited).toBe(2)
    expect(stderr.join('')).toBe(`${SHARED_DESKTOP_LEASE_HELD}\n`)
    await first.release()
    await first.release()
    const second = await acquireDesktopLease(lock)
    expect((await stat(lock)).ino).toBe(before.ino)
    await second.release()
    await rm(dir, { recursive: true })
  })

  it('closes the descriptor when spawn fails and leaves the lock file', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const run = await startSupervisor(options(dir, { binary: join(dir, 'missing-binary') }))
    expect(await run.exited).toBe(1)
    expect((await stat(lock)).isFile()).toBe(true)
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true })
  })

  it('releases a lock that is stopped before spawn', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const run = await startSupervisor(options(dir, { spawn: false }))
    await run.stop()
    await run.stop()
    expect(await run.exited).toBe(0)
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true })
  })

  it('lets the next supervisor acquire after the child exits', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const run = await startSupervisor(options(dir, {
      binary: process.execPath,
      args: ['-e', 'process.exit(0)'],
    }))
    expect(await run.exited).toBe(0)
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true })
  })

  it('keeps the lock after the supervisor is killed while the child lives', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const ready = join(dir, 'ready')
    const pidFile = join(dir, 'child.pid')
    const holder = await spawnHolder(dir, {
      binary: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
      ready,
      pidFile,
    })
    holders.push(holder)
    kill(holder.pid)
    await holder.exited
    await expect(acquireDesktopLease(lock)).rejects.toBeInstanceOf(DesktopLeaseBusyError)
    const childPid = Number(await readFile(pidFile, 'utf8'))
    holder.childPid = childPid
    kill(childPid)
    await waitForExit(childPid)
    const again = await acquireDesktopLease(lock)
    await again.release()
    expect((await stat(lock)).isFile()).toBe(true)
    await rm(dir, { recursive: true })
  })

  it('refuses a second process while the first holds the lock', async () => {
    const dir = await temp()
    const ready = join(dir, 'ready')
    const holder = await spawnHolder(dir, {
      binary: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
      ready,
      pidFile: join(dir, 'child.pid'),
    })
    holders.push(holder)
    const second = await runOnce(dir, { binary: process.execPath, args: ['-e', 'process.exit(0)'] })
    expect(second.code).toBe(2)
    expect(second.stderr).toBe(`${SHARED_DESKTOP_LEASE_HELD}\n`)
    await rm(dir, { recursive: true, force: true })
  })
})

function options(dir: string, extra: Partial<Parameters<typeof startSupervisor>[0]> = {}) {
  return {
    platform: 'darwin' as const,
    arch: 'arm64',
    home: dir,
    lockPath: join(dir, 'agent-desktop.lock'),
    binary: process.execPath,
    helper: join(dir, 'helper'),
    args: ['mcp'],
    stdio: 'ignore' as const,
    ...extra,
  }
}

async function temp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ad01-lease-'))
}

function kill(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error: unknown) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

async function spawnHolder(dir: string, input: {
  binary: string
  args: readonly string[]
  ready: string
  pidFile: string
}): Promise<{ pid: number | undefined; childPid: number | undefined; exited: Promise<void> }> {
  const script = join(dir, 'hold.mts')
  await writeFile(script, holderSource())
  const child = spawn(process.execPath, ['--import', 'tsx/esm', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: holderEnv(dir, input),
  })
  await waitFor(input.ready)
  let resolve: () => void = () => {}
  const exited = new Promise<void>((done) => { resolve = done })
  child.once('exit', () => { resolve() })
  return { pid: child.pid, childPid: undefined, exited }
}

async function runOnce(dir: string, input: { binary: string; args: readonly string[] }): Promise<{ code: number | null; stderr: string }> {
  const script = join(dir, 'once.mts')
  await writeFile(script, holderSource())
  const child = spawn(process.execPath, ['--import', 'tsx/esm', script], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...holderEnv(dir, { ...input, ready: join(dir, 'unused'), pidFile: '' }), AD_CHILD_PID_FILE: '' },
  })
  const stderr: Buffer[] = []
  child.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk) })
  const code = await new Promise<number | null>((resolve) => { child.once('exit', resolve) })
  return { code, stderr: Buffer.concat(stderr).toString('utf8') }
}

function holderEnv(dir: string, input: { binary: string; args: readonly string[]; ready: string; pidFile: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AD_HOME: dir,
    AD_LOCK: join(dir, 'agent-desktop.lock'),
    AD_BINARY: input.binary,
    AD_HELPER: join(dir, 'helper'),
    AD_ARGS: JSON.stringify(input.args),
    AD_READY: input.ready,
    AD_CHILD_PID_FILE: input.pidFile,
  }
}

function holderSource(): string {
  return `
import { writeFile } from 'node:fs/promises'
import { startSupervisor } from ${JSON.stringify(supervisorUrl)}
const run = await startSupervisor({
  platform: 'darwin',
  arch: 'arm64',
  home: process.env.AD_HOME,
  lockPath: process.env.AD_LOCK,
  binary: process.env.AD_BINARY,
  helper: process.env.AD_HELPER,
  args: JSON.parse(process.env.AD_ARGS),
  stdio: 'ignore',
  signals: true,
})
const pid = run.childPid()
if (process.env.AD_CHILD_PID_FILE && pid !== undefined) await writeFile(process.env.AD_CHILD_PID_FILE, String(pid))
await writeFile(process.env.AD_READY, 'ready')
process.exit(await run.exited)
`
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await readFile(path)
      return
    } catch (error: unknown) {
      if (errorCode(error) !== 'ENOENT') throw error
      await new Promise((resolve) => { setTimeout(resolve, 20) })
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (errorCode(error) === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
  throw new Error(`pid ${String(pid)} stayed alive`)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
