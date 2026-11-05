/**
 * Lease and supervisor failures that the host does not raise on its own:
 * a replaced inode, a missing lock path, a non-contention flock error,
 * EWOULDBLOCK, a non-Error CLI failure, and a close rejection during signal stop.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireDesktopLease, DesktopLeaseBusyError, DesktopLeaseUnstableError, SHARED_DESKTOP_LEASE_HELD } from '../src/lease.ts'
import { executeSupervisorCli, startSupervisor } from '../src/supervisor.ts'

const fault = vi.hoisted(() => ({
  kind: 'real' as 'real' | 'ewouldblock' | 'eio' | 'string' | 'numeric' | 'enoent' | 'stat-eio' | 'unstable' | 'close-error' | 'close-string',
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async stat(...args: Parameters<typeof actual.stat>) {
      if (fault.kind === 'enoent') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      if (fault.kind === 'stat-eio') throw Object.assign(new Error('EIO'), { code: 'EIO' })
      const current = await actual.stat(...args)
      if (fault.kind === 'unstable') {
        const ino = typeof current.ino === 'bigint' ? current.ino + 1n : BigInt(current.ino) + 1n
        return { ino, dev: current.dev }
      }
      return current
    },
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args)
      if (fault.kind !== 'close-error' && fault.kind !== 'close-string') return handle
      const failure: unknown = fault.kind === 'close-error' ? new Error('close failed') : 'not-an-error'
      const close = handle.close.bind(handle)
      handle.close = async () => {
        await close()
        throw failure
      }
      return handle
    },
  }
})

vi.mock('@deepseek-ai/node-addon-system/flock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/node-addon-system/flock')>()
  return {
    ...actual,
    async tryLockExclusive(fd: number) {
      if (fault.kind === 'ewouldblock') throw Object.assign(new Error('busy'), { code: 'EWOULDBLOCK' })
      if (fault.kind === 'eio') throw Object.assign(new Error('io'), { code: 'EIO' })
      if (fault.kind === 'string') throw 'lock failed'
      if (fault.kind === 'numeric') throw { code: 11 }
      return actual.tryLockExclusive(fd)
    },
  }
})

const dirs: string[] = []

afterEach(async () => {
  fault.kind = 'real'
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('desktop lease failures', () => {
  it('treats a replaced inode and a missing lock path as unstable', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    fault.kind = 'unstable'
    await expect(acquireDesktopLease(lock)).rejects.toBeInstanceOf(DesktopLeaseUnstableError)
    fault.kind = 'enoent'
    await expect(acquireDesktopLease(lock)).rejects.toBeInstanceOf(DesktopLeaseUnstableError)
    const stderr: string[] = []
    const run = await startSupervisor(options(dir, { stderr: { write: (chunk) => { stderr.push(chunk) } } }))
    expect(await run.exited).toBe(1)
    expect(run.childPid()).toBeUndefined()
    expect(stderr).toEqual([])
  })

  it('rethrows a lock error that is not contention, including a non-string code', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    fault.kind = 'eio'
    await expect(acquireDesktopLease(lock)).rejects.toMatchObject({ code: 'EIO' })
    fault.kind = 'numeric'
    await expect(acquireDesktopLease(lock)).rejects.toEqual({ code: 11 })
    fault.kind = 'stat-eio'
    await expect(acquireDesktopLease(lock)).rejects.toMatchObject({ code: 'EIO' })
  })

  it('treats EWOULDBLOCK as a held lease', async () => {
    const dir = await temp()
    fault.kind = 'ewouldblock'
    const stderr: string[] = []
    const run = await startSupervisor(options(dir, { stderr: { write: (chunk) => { stderr.push(chunk) } } }))
    expect(await run.exited).toBe(2)
    expect(stderr.join('')).toBe(`${SHARED_DESKTOP_LEASE_HELD}\n`)
    await expect(acquireDesktopLease(join(dir, 'agent-desktop.lock'))).rejects.toBeInstanceOf(DesktopLeaseBusyError)
  })

  it('writes a non-Error supervisor failure and returns 1', async () => {
    const dir = await temp()
    fault.kind = 'string'
    const stderr: string[] = []
    const code = await executeSupervisorCli(['--lock', join(dir, 'agent-desktop.lock'), '--binary', process.execPath], {
      platform: 'darwin',
      arch: 'arm64',
      env: { AGENT_DESKTOP_HOME: dir },
      stderr: { write: (chunk: string) => { stderr.push(chunk) } },
    })
    expect(code).toBe(1)
    expect(stderr.join('')).toBe('desktop-operation: lock failed\n')
  })

  it('exits the process when signal stop rejects, for an Error and for a string', async () => {
    await expect(signalStop('close-error')).resolves.toContain('close failed')
    await expect(signalStop('close-string')).resolves.toContain('not-an-error')
  })
})

async function signalStop(kind: 'close-error' | 'close-string'): Promise<string> {
  const dir = await temp()
  fault.kind = kind
  const stderr: string[] = []
  const codes: number[] = []
  // oxlint-disable-next-line typescript/unbound-method -- restore the original method reference after the test
  const write = process.stderr.write
  // oxlint-disable-next-line typescript/unbound-method -- restore the original method reference after the test
  const exit = process.exit
  const foreign = process.listeners('SIGTERM').slice()
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })
  process.exit = ((code?: number) => { codes.push(code ?? 0) }) as typeof process.exit
  let pid: number | undefined
  try {
    const run = await startSupervisor(options(dir, {
      args: ['-e', 'setInterval(() => {}, 1e9)'],
      signals: true,
    }))
    pid = run.childPid()
    for (const listener of foreign) process.off('SIGTERM', listener)
    process.emit('SIGTERM')
    const deadline = Date.now() + 5_000
    while (codes.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => { setTimeout(resolve, 20) })
    }
    expect(codes).toEqual([1])
    await expect(run.exited).rejects.toBeTruthy()
    return stderr.join('')
  } finally {
    process.stderr.write = write
    process.exit = exit
    for (const listener of foreign) process.on('SIGTERM', listener)
    if (pid !== undefined) {
      try { process.kill(pid, 'SIGKILL') } catch (error: unknown) {
        if (!isMissing(error)) throw error
      }
    }
    fault.kind = 'real'
  }
}

function options(dir: string, extra: Partial<Parameters<typeof startSupervisor>[0]> = {}) {
  return {
    platform: 'darwin' as const,
    arch: 'arm64',
    home: dir,
    lockPath: join(dir, 'agent-desktop.lock'),
    binary: process.execPath,
    helper: join(dir, 'helper'),
    args: ['mcp'] as const,
    stdio: 'ignore' as const,
    ...extra,
  }
}

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ad01-lease-fail-'))
  dirs.push(dir)
  return dir
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}
