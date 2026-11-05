/**
 * Supervisor CLI parsing, process exit, signal disposal, and lock failure.
 * The spawned process is the real supervisor module.
 */
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDesktopLease, SHARED_DESKTOP_LEASE_HELD } from '../src/lease.ts'
import { probeDesktopStatus } from '../src/index.ts'
import { resolveNativeAssets } from '../src/assets.ts'
import { resolveAppDataDirectory } from '../src/state-directory.ts'
import {
  executeSupervisorCli,
  launchSupervisorCli,
  parseSupervisorArguments,
  startSupervisor,
} from '../src/supervisor.ts'

const supervisorPath = fileURLToPath(new URL('../src/supervisor.ts', import.meta.url))
const tsxHook = fileURLToPath(import.meta.resolve('tsx/esm'))
const children: number[] = []

afterEach(() => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error: unknown) {
      if (errorCode(error) !== 'ESRCH') throw error
    }
  }
})

describe('supervisor command', () => {
  it('rejects a missing path, a flag-shaped value, and an unknown flag', () => {
    expect(parseSupervisorArguments([])).toBeUndefined()
    expect(parseSupervisorArguments(['--lock'])).toBeUndefined()
    expect(parseSupervisorArguments(['--lock', '--binary', process.execPath])).toBeUndefined()
    expect(parseSupervisorArguments(['--ignored', '--lock', '/tmp/lock', '--binary', process.execPath, '--', 'mcp'])).toEqual({
      lock: '/tmp/lock',
      binary: process.execPath,
      args: ['mcp'],
    })
  })

  it('exits 1 from the process entry when --lock or --binary is absent', async () => {
    const result = await spawnSupervisor([])
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('desktop-operation: supervisor requires --lock and --binary\n')
  })

  it('runs the child from the process entry and releases the lock', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const result = await spawnSupervisor([
      '--lock', lock,
      '--binary', process.execPath,
      '--', '-e', 'process.exit(0)',
    ], dir)
    expect(result.code).toBe(0)
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the usage exit and a child exit without leaving the test process', async () => {
    const dir = await temp()
    const stderr: string[] = []
    const io = {
      platform: 'darwin' as const,
      arch: 'arm64',
      env: { AGENT_DESKTOP_HOME: dir, AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper') },
      stderr: { write: (chunk: string) => { stderr.push(chunk) } },
    }
    expect(await executeSupervisorCli([], io)).toBe(1)
    expect(stderr.join('')).toBe('desktop-operation: supervisor requires --lock and --binary\n')
    const lock = join(dir, 'agent-desktop.lock')
    expect(await executeSupervisorCli([
      '--lock', lock,
      '--binary', process.execPath,
      '--', '-e', 'process.exit(0)',
    ], io)).toBe(0)
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })

  it('exits through process.exit when argv names the supervisor program', async () => {
    const dir = await temp()
    const previousHome = process.env.AGENT_DESKTOP_HOME
    const previousHelper = process.env.AGENT_DESKTOP_MACOS_HELPER_PATH
    process.env.AGENT_DESKTOP_HOME = dir
    process.env.AGENT_DESKTOP_MACOS_HELPER_PATH = join(dir, 'helper')
    const codes: number[] = []
    // oxlint-disable-next-line typescript/unbound-method -- restore the original method reference after the test
    const exit = process.exit
    process.exit = ((code?: number) => { codes.push(code ?? 0) }) as typeof process.exit
    try {
      launchSupervisorCli(['node', 'not-the-supervisor'])
      launchSupervisorCli([
        process.execPath,
        join(dir, 'supervisor.ts'),
        '--lock', join(dir, 'agent-desktop.lock'),
        '--binary', process.execPath,
        '--', '-e', 'process.exit(0)',
      ])
      const deadline = Date.now() + 5_000
      while (codes.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => { setTimeout(resolve, 20) })
      }
      expect(codes).toEqual([0])
    } finally {
      process.exit = exit
      if (previousHome === undefined) delete process.env.AGENT_DESKTOP_HOME
      else process.env.AGENT_DESKTOP_HOME = previousHome
      if (previousHelper === undefined) delete process.env.AGENT_DESKTOP_MACOS_HELPER_PATH
      else process.env.AGENT_DESKTOP_MACOS_HELPER_PATH = previousHelper
    }
    const again = await acquireDesktopLease(join(dir, 'agent-desktop.lock'))
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })

  it('finishes before spawn on an unsupported platform or a relative home', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const unsupported = await startSupervisor(options(dir, { platform: 'linux', arch: 'x64' }))
    expect(await unsupported.exited).toBe(0)
    expect(unsupported.childPid()).toBeUndefined()
    await unsupported.stop()
    await expect(stat(lock)).rejects.toThrow()
    const relative = await startSupervisor(options(dir, { home: 'relative' }))
    expect(await relative.exited).toBe(1)
    expect(relative.childPid()).toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the failure and returns 1 when the lock path is a directory', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    await mkdir(lock)
    const stderr: string[] = []
    const code = await executeSupervisorCli(['--lock', lock, '--binary', process.execPath, '--', '-e', 'process.exit(0)'], {
      platform: 'darwin',
      arch: 'arm64',
      env: { AGENT_DESKTOP_HOME: dir, AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper') },
      stderr: { write: (chunk: string) => { stderr.push(chunk) } },
    })
    expect(code).toBe(1)
    expect(stderr.join('')).toContain('desktop-operation:')
    expect((await stat(lock)).isDirectory()).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('stops a live child and releases the lock when SIGTERM is emitted', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const foreign = process.listeners('SIGTERM').slice()
    const run = await startSupervisor(options(dir, {
      args: ['-e', 'setInterval(() => {}, 30000)'],
      signals: true,
    }))
    const pid = run.childPid()
    expect(pid).toBeTypeOf('number')
    if (pid !== undefined) children.push(pid)
    for (const listener of foreign) process.off('SIGTERM', listener)
    try {
      process.emit('SIGTERM')
      expect(await run.exited).toBe(1)
    } finally {
      for (const listener of foreign) process.on('SIGTERM', listener)
    }
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })

  it('inherits stdio, then stop after exit leaves the lock free', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const run = await startSupervisor(options(dir, {
      args: ['-e', 'process.exit(0)'],
      stdio: 'inherit',
    }))
    expect(await run.exited).toBe(0)
    await run.stop()
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('status and asset edges', () => {
  it('rejects a relative asset directory and resolves an empty override beside the module', () => {
    expect(() => resolveNativeAssets('native', import.meta.url)).toThrow('desktop-operation: assetDirectory must be absolute')
    expect(resolveNativeAssets('  ', import.meta.url).binary).toContain(join('native', 'agent-desktop'))
  })

  it('uses an absolute OCTOPUS_APP_DATA when the config is empty', () => {
    const dir = join(tmpdir(), 'ad01-absolute')
    expect(resolveAppDataDirectory('', { OCTOPUS_APP_DATA: dir })).toBe(dir)
  })

  it('releases the lock when the home path is a file', async () => {
    const dir = await temp()
    const home = join(dir, 'home-file')
    await writeFile(home, 'not a directory')
    const lock = join(dir, 'agent-desktop.lock')
    await expect(startSupervisor(options(dir, { home }))).rejects.toThrow()
    const again = await acquireDesktopLease(lock)
    await again.release()
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the busy line to process stderr when no writer is passed', async () => {
    const dir = await temp()
    const lock = join(dir, 'agent-desktop.lock')
    const held = await acquireDesktopLease(lock)
    const chunks: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      const busy = await startSupervisor(options(dir))
      expect(await busy.exited).toBe(2)
    } finally {
      process.stderr.write = write
      await held.release()
    }
    expect(chunks.join('')).toBe(`${SHARED_DESKTOP_LEASE_HELD}\n`)
    await rm(dir, { recursive: true, force: true })
  })

  it('treats a missing home environment value as a relative home', async () => {
    const dir = await temp()
    const stderr: string[] = []
    const code = await executeSupervisorCli([
      '--lock', join(dir, 'agent-desktop.lock'),
      '--binary', process.execPath,
      '--', '-e', 'process.exit(0)',
    ], {
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      stderr: { write: (chunk: string) => { stderr.push(chunk) } },
    })
    expect(code).toBe(1)
    expect(stderr).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('treats a missing binary, empty stdout, and a timed-out status as unavailable', async () => {
    const dir = await temp()
    const helper = join(dir, 'helper')
    expect(await probeDesktopStatus(join(dir, 'missing'), dir, helper, 200)).toBe('unavailable')
    const empty = join(dir, 'empty-status')
    await writeFile(empty, '#!/bin/sh\nexit 0\n')
    await chmod(empty, 0o755)
    expect(await probeDesktopStatus(empty, dir, helper, 1000)).toBe('unavailable')
    const sleeper = join(dir, 'sleep-status')
    await writeFile(sleeper, '#!/bin/sh\nsleep 5\n')
    await chmod(sleeper, 0o755)
    expect(await probeDesktopStatus(sleeper, dir, helper, 80)).toBe('unavailable')
    expect(await pgrep(sleeper)).toEqual([])
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
    args: ['mcp'] as readonly string[],
    stdio: 'ignore' as const,
    ...extra,
  }
}

async function temp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ad01-cli-'))
}

function spawnSupervisor(args: readonly string[], home?: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxHook, supervisorPath, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ...home === undefined ? {} : { AGENT_DESKTOP_HOME: home, AGENT_DESKTOP_MACOS_HELPER_PATH: join(home, 'helper') },
      },
    })
    if (child.pid !== undefined) children.push(child.pid)
    const stderr: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.once('error', reject)
    child.once('exit', (code) => { resolve({ code, stderr: Buffer.concat(stderr).toString('utf8') }) })
  })
}

function pgrep(text: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('pgrep', ['-f', text], (error, stdout) => {
      if (error !== null && error.code === 1) { resolve([]); return }
      if (error !== null) { reject(error instanceof Error ? error : new Error(error.message, { cause: error })); return }
      resolve(stdout.split('\n').filter(line => line !== ''))
    })
  })
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
